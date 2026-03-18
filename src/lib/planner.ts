import type {
  RecipeObject,
  Variant,
  PlannerGraph,
  PlannerNode,
  PlannerEdge,
  TablePlannerNode,
  ItemPlannerNode,
  RawPlannerNode,
  TagPlannerNode,
  MarketPlannerNode,
  ByproductPlannerNode,
  UserChoices
} from './types.js';
import type { RecipeIndex } from './recipeIndex.js';
import type { TagsIndex } from './tagsIndex.js';

interface BuildOptions {
  targetItem: string;
  totalAmount: number;
  recipeIndex: RecipeIndex;
  tagsIndex: TagsIndex;
  choices: UserChoices;
  skillReduction: number;  // 0.0 – 1.0
}

// Node IDs are prefixed with their type to avoid collisions between,
// e.g., an item node and a table node for the same item.
function itemNodeId(name: string) { return `item:${name}`; }
function tableNodeId(name: string) { return `table:${name}`; }
function rawNodeId(name: string)   { return `raw:${name}`; }
function tagNodeId(tag: string) { return `tag:${tag}`; }

function getDefaultVariant(recipe: RecipeObject): Variant {
  return recipe.Variants.find(v => v.Name === recipe.DefaultVariant) ?? recipe.Variants[0];
}

export function buildGraph(opts: BuildOptions): PlannerGraph {
  const { targetItem, totalAmount, recipeIndex, tagsIndex, choices, skillReduction } = opts;

  // Accumulate total requirements across all branches
  const requirements = new Map<string, number>();   // item/tag key → total amount needed
  const tagRequirements = new Map<string, number>(); // tag → total amount needed

  // Track parent-child relationships for edge construction
  const edges: PlannerEdge[] = [];
  const edgeSet = new Set<string>();  // dedup

  // Visited guard — prevents infinite loops in cyclic recipe graphs
  const visited = new Set<string>();

  function addEdge(source: string, target: string) {
    const key = `${source}->${target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ id: key, source, target });
    }
  }

  // DFS: accumulate requirements
  function resolve(itemName: string, amount: number): void {
    requirements.set(itemName, (requirements.get(itemName) ?? 0) + amount);

    if (visited.has(itemName)) return;
    visited.add(itemName);

    const recipes = recipeIndex.byProduct.get(itemName) ?? [];
    if (recipes.length === 0) {
      // Raw resource — no further resolution needed
      return;
    }

    const recipe = choices.recipeByItem.get(itemName) ?? recipes[0];
    const variant =
      choices.variantByItem.get(itemName) ??
      getDefaultVariant(recipe);

    // We'll resolve ingredients with amount=1 here; actual scaled amounts
    // are computed in the second pass once cycles are known.
    for (const ingredient of variant.Ingredients) {
      const effectiveAmount = ingredient.IsStatic
        ? ingredient.Ammount
        : ingredient.Ammount * (1 - skillReduction);

      if (ingredient.IsSpecificItem) {
        resolve(ingredient.Name, effectiveAmount);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        tagRequirements.set(tag, (tagRequirements.get(tag) ?? 0) + effectiveAmount);

        const selectedItem = choices.itemByTag.get(tag);
        if (selectedItem) {
          resolve(selectedItem, effectiveAmount);
        }
      }
    }
  }

  resolve(targetItem, totalAmount);

  // ── Second pass: compute cycles and scale ingredient amounts ─────
  // We need to iterate until convergence because ingredient amounts
  // depend on cycles, which depend on accumulated requirements.
  // For v1 (tree, not shared-node DAG), one extra pass is sufficient
  // since each item only appears once in visited.

  // Reset requirements and re-resolve with proper scaling
  requirements.clear();
  tagRequirements.clear();
  edgeSet.clear();
  edges.length = 0;
  visited.clear();

  function resolveScaled(itemName: string, amount: number, parentTableId?: string): void {
    const prev = requirements.get(itemName) ?? 0;
    requirements.set(itemName, prev + amount);

    const itemId = itemNodeId(itemName);

    if (parentTableId) {
      addEdge(itemId, parentTableId);
    }

    if (visited.has(itemName)) return;
    visited.add(itemName);

    const recipes = recipeIndex.byProduct.get(itemName) ?? [];
    if (recipes.length === 0 || choices.marketItems.has(itemName)) {
      // Raw resource or bought from market — leaf node
      return;
    }

    const recipe = choices.recipeByItem.get(itemName) ?? recipes[0];
    const variant =
      choices.variantByItem.get(itemName) ??
      getDefaultVariant(recipe);

    const primaryProduct = variant.Products.find(p => p.Name === itemName) ?? variant.Products[0];
    const primaryAmmount = primaryProduct?.Ammount ?? 1;
    const cycles = Math.ceil(amount / primaryAmmount);

    const tableId = tableNodeId(itemName);
    addEdge(tableId, itemId);

    for (const ingredient of variant.Ingredients) {
      const effectivePerCycle = ingredient.IsStatic
        ? ingredient.Ammount
        : ingredient.Ammount * (1 - skillReduction);
      const ingredientTotal = effectivePerCycle * cycles;

      if (ingredient.IsSpecificItem) {
        resolveScaled(ingredient.Name, ingredientTotal, tableId);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        tagRequirements.set(tag, (tagRequirements.get(tag) ?? 0) + ingredientTotal);

        const tagId = tagNodeId(tag);
        addEdge(tagId, tableId);

        const selectedItem = choices.itemByTag.get(tag);
        if (selectedItem) {
          resolveScaled(selectedItem, ingredientTotal, tableId);
        }
      }
    }
  }

  resolveScaled(targetItem, totalAmount);

  // ── Build node list ──────────────────────────────────────────────
  const nodes: PlannerNode[] = [];
  const builtNodes = new Set<string>();

  // Re-traverse to build nodes with final cycles
  visited.clear();

  function buildNodes(itemName: string, amount: number): void {
    if (visited.has(itemName)) return;
    visited.add(itemName);

    const totalRequired = requirements.get(itemName) ?? amount;
    const itemId = itemNodeId(itemName);

    const recipes = recipeIndex.byProduct.get(itemName) ?? [];

    if (recipes.length === 0) {
      if (!builtNodes.has(itemId)) {
        builtNodes.add(itemId);
        const rawNode: RawPlannerNode = {
          type: 'raw',
          id: itemId,
          itemName,
          amount: totalRequired
        };
        nodes.push(rawNode);
      }
      return;
    }

    if (choices.marketItems.has(itemName)) {
      if (!builtNodes.has(itemId)) {
        builtNodes.add(itemId);
        const marketNode: MarketPlannerNode = {
          type: 'market',
          id: itemId,
          itemName,
          amount: totalRequired,
          availableRecipes: recipes
        };
        nodes.push(marketNode);
      }
      return;
    }

    // Item node
    if (!builtNodes.has(itemId)) {
      builtNodes.add(itemId);
      const itemNode: ItemPlannerNode = {
        type: 'item',
        id: itemId,
        itemName,
        amount: totalRequired
      };
      nodes.push(itemNode);
    }

    const recipe = choices.recipeByItem.get(itemName) ?? recipes[0];
    const variant =
      choices.variantByItem.get(itemName) ??
      getDefaultVariant(recipe);

    const primaryProduct = variant.Products.find(p => p.Name === itemName) ?? variant.Products[0];
    const primaryAmmount = primaryProduct?.Ammount ?? 1;
    const cycles = Math.ceil(totalRequired / primaryAmmount);

    const tableId = tableNodeId(itemName);
    if (!builtNodes.has(tableId)) {
      builtNodes.add(tableId);
      const tableNode: TablePlannerNode = {
        type: 'table',
        id: tableId,
        itemName,
        table: recipe.CraftingTable,
        recipe,
        variant,
        cycles,
        availableRecipes: recipes
      };
      nodes.push(tableNode);

      // Byproduct nodes: all products except the one this table is "for"
      for (const product of variant.Products) {
        if (product.Name === itemName) continue;
        const byproductId = `byproduct:${product.Name}:from:${itemName}`;
        addEdge(tableId, byproductId);
        if (!builtNodes.has(byproductId)) {
          builtNodes.add(byproductId);
          const byproductNode: ByproductPlannerNode = {
            type: 'byproduct',
            id: byproductId,
            itemName: product.Name,
            amount: product.Ammount * cycles
          };
          nodes.push(byproductNode);
        }
      }
    }

    for (const ingredient of variant.Ingredients) {
      const effectivePerCycle = ingredient.IsStatic
        ? ingredient.Ammount
        : ingredient.Ammount * (1 - skillReduction);
      const ingredientTotal = effectivePerCycle * cycles;

      if (ingredient.IsSpecificItem) {
        buildNodes(ingredient.Name, ingredientTotal);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        const tagId = tagNodeId(tag);
        const tagTotal = tagRequirements.get(tag) ?? ingredientTotal;

        if (!builtNodes.has(tagId)) {
          builtNodes.add(tagId);
          const availableItems = tagsIndex.byTag.get(tag) ?? [];
          const selectedItem = choices.itemByTag.get(tag) ?? null;
          const tagNode: TagPlannerNode = {
            type: 'tag',
            id: tagId,
            tag,
            amount: tagTotal,
            availableItems,
            selectedItem
          };
          nodes.push(tagNode);
        }

        const selectedItem = choices.itemByTag.get(tag);
        if (selectedItem) {
          buildNodes(selectedItem, ingredientTotal);
        }
      }
    }
  }

  buildNodes(targetItem, totalAmount);

  return { nodes, edges };
}
