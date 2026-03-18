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
function tagNodeId(tag: string) { return `tag:${tag}`; }

function getDefaultVariant(recipe: RecipeObject): Variant {
  return recipe.Variants.find(v => v.Name === recipe.DefaultVariant) ?? recipe.Variants[0];
}

export function buildGraph(opts: BuildOptions): PlannerGraph {
  const { targetItem, totalAmount, recipeIndex, tagsIndex, choices, skillReduction } = opts;

  // Accumulate total requirements and byproduct supply
  const requirements = new Map<string, number>();
  const tagRequirements = new Map<string, number>();
  const byproductSupply = new Map<string, number>();

  // Track edges and nodes
  const edges: PlannerEdge[] = [];
  const edgeSet = new Set<string>();

  const visited = new Set<string>();

  function addEdge(source: string, target: string) {
    const key = `${source}->${target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ id: key, source, target });
    }
  }

  // ── Pass 1 (gross): accumulate requirements + byproduct supply ────
  // Edges are NOT built here — buildNodes handles all edge creation.
  function resolveScaled(itemName: string, amount: number): void {
    requirements.set(itemName, (requirements.get(itemName) ?? 0) + amount);

    if (visited.has(itemName)) return;
    visited.add(itemName);

    const recipes = recipeIndex.byProduct.get(itemName) ?? [];
    if (recipes.length === 0 || choices.marketItems.has(itemName)) return;

    const recipe = choices.recipeByItem.get(itemName) ?? recipes[0];
    const variant =
      choices.variantByItem.get(itemName) ??
      getDefaultVariant(recipe);

    const primaryProduct = variant.Products.find(p => p.Name === itemName) ?? variant.Products[0];
    const primaryAmmount = primaryProduct?.Ammount ?? 1;
    const cycles = Math.ceil(amount / primaryAmmount);

    // Only treat this as the "true" crafting intent when itemName is the leading product.
    // If the recipe's first product is something else (itemName is a byproduct of that recipe),
    // skip byproduct supply tracking and ingredient recursion — the item will be supplied
    // as a side effect of producing the true primary.
    const isTruePrimary = variant.Products[0]?.Name === itemName;
    if (!isTruePrimary) return;

    // Track byproduct supply from this table's runs
    for (const product of variant.Products) {
      if (product.Name === itemName) continue;
      byproductSupply.set(product.Name, (byproductSupply.get(product.Name) ?? 0) + product.Ammount * cycles);
    }

    for (const ingredient of variant.Ingredients) {
      const effectivePerCycle = ingredient.IsStatic
        ? ingredient.Ammount
        : ingredient.Ammount * (1 - skillReduction);
      const ingredientTotal = effectivePerCycle * cycles;

      if (ingredient.IsSpecificItem) {
        resolveScaled(ingredient.Name, ingredientTotal);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        tagRequirements.set(tag, (tagRequirements.get(tag) ?? 0) + ingredientTotal);
        const selectedItem = choices.itemByTag.get(tag);
        if (selectedItem) resolveScaled(selectedItem, ingredientTotal);
      }
    }
  }

  resolveScaled(targetItem, totalAmount);

  // ── Pass 2 (build): create nodes and edges ──────────────────────
  const nodes: PlannerNode[] = [];
  const builtNodes = new Set<string>();
  visited.clear();

  function buildNodes(itemName: string, amount: number): void {
    if (visited.has(itemName)) return;
    visited.add(itemName);

    const grossRequired = requirements.get(itemName) ?? amount;
    const supply = byproductSupply.get(itemName) ?? 0;
    const net = Math.max(0, grossRequired - supply);
    const itemId = itemNodeId(itemName);

    const recipes = recipeIndex.byProduct.get(itemName) ?? [];

    // Fully covered by byproducts — item node only, no crafting needed
    if (supply > 0 && net === 0) {
      if (!builtNodes.has(itemId)) {
        builtNodes.add(itemId);
        const itemNode: ItemPlannerNode = {
          type: 'item',
          id: itemId,
          itemName,
          amount: 0,
          byproductSupply: supply
        };
        nodes.push(itemNode);
      }
      return;
    }

    if (recipes.length === 0) {
      // Raw resource — leaf node
      if (!builtNodes.has(itemId)) {
        builtNodes.add(itemId);
        const rawNode: RawPlannerNode = { type: 'raw', id: itemId, itemName, amount: net };
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
          amount: net,
          availableRecipes: recipes
        };
        nodes.push(marketNode);
      }
      return;
    }

    // Craftable item node
    if (!builtNodes.has(itemId)) {
      builtNodes.add(itemId);
      const itemNode: ItemPlannerNode = {
        type: 'item',
        id: itemId,
        itemName,
        amount: net,
        byproductSupply: supply > 0 ? supply : undefined
      };
      nodes.push(itemNode);
    }

    const recipe = choices.recipeByItem.get(itemName) ?? recipes[0];
    const variant =
      choices.variantByItem.get(itemName) ??
      getDefaultVariant(recipe);

    // If this item is only a secondary product of the chosen recipe (not Products[0]),
    // treat it like a raw resource — it can only be obtained as a byproduct of other crafting.
    if (variant.Products[0]?.Name !== itemName) {
      // Replace the item node we already pushed with a raw node (same id)
      const idx = nodes.findIndex(n => n.id === itemId);
      if (idx !== -1) {
        nodes[idx] = { type: 'raw', id: itemId, itemName, amount: net } as RawPlannerNode;
      }
      return;
    }

    const primaryProduct = variant.Products.find(p => p.Name === itemName) ?? variant.Products[0];
    const primaryAmmount = primaryProduct?.Ammount ?? 1;
    const cycles = Math.ceil(net / primaryAmmount);

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
      addEdge(tableId, itemId);  // table produces primary item

      // Byproduct outputs: feed back into chain if consumed, else dead-end node
      for (const product of variant.Products) {
        if (product.Name === itemName) continue;
        const neededInChain = (requirements.get(product.Name) ?? 0) > 0;
        if (neededInChain) {
          // Connect table output directly to the byproduct's item node
          addEdge(tableId, itemNodeId(product.Name));
        } else {
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
    }

    // Recurse into ingredients, building edges as we go
    for (const ingredient of variant.Ingredients) {
      const effectivePerCycle = ingredient.IsStatic
        ? ingredient.Ammount
        : ingredient.Ammount * (1 - skillReduction);
      const ingredientTotal = effectivePerCycle * cycles;

      if (ingredient.IsSpecificItem) {
        addEdge(itemNodeId(ingredient.Name), tableId);
        buildNodes(ingredient.Name, ingredientTotal);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        const tagId = tagNodeId(tag);
        const tagTotal = tagRequirements.get(tag) ?? ingredientTotal;

        addEdge(tagId, tableId);

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
          addEdge(itemNodeId(selectedItem), tableId);
          buildNodes(selectedItem, ingredientTotal);
        }
      }
    }
  }

  buildNodes(targetItem, totalAmount);

  return { nodes, edges };
}
