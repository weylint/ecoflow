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
  LoopbackPlannerNode,
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
  globalUpgrade: number;  // 0.0 – 1.0 default reduction; per-table overrides in choices.upgradeByTable
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
  const { targetItem, totalAmount, recipeIndex, tagsIndex, choices, globalUpgrade } = opts;

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

    const effectiveReduction = choices.upgradeByTable.get(recipe.CraftingTable) ?? globalUpgrade;

    const primaryProduct = variant.Products.find(p => p.Name === itemName) ?? variant.Products[0];
    const primaryAmmount = primaryProduct?.Ammount ?? 1;
    const cycles = Math.ceil(amount / primaryAmmount);

    // Only treat this as the "true" crafting intent when itemName is the leading product.
    // If the recipe's first product is something else (itemName is a byproduct of that recipe),
    // skip byproduct supply tracking and ingredient recursion — the item will be supplied
    // as a side effect of producing the true primary.
    const isTruePrimary = variant.Products[0]?.Name === itemName;
    if (!isTruePrimary) return;

    // Identify loopback items: products that also appear as IsStatic:false ingredients
    const loopbackItems = new Set(
      variant.Products
        .filter(p => p.Name !== itemName)
        .filter(p => variant.Ingredients.some(i => i.Name === p.Name && !i.IsStatic))
        .map(p => p.Name)
    );

    // Track byproduct supply from this table's runs (skip loopback items)
    for (const product of variant.Products) {
      if (product.Name === itemName) continue;
      if (loopbackItems.has(product.Name)) continue;
      byproductSupply.set(product.Name, (byproductSupply.get(product.Name) ?? 0) + product.Ammount * cycles);
    }

    for (const ingredient of variant.Ingredients) {
      if (loopbackItems.has(ingredient.Name)) {
        // Loopback: only the net loss needs to be supplied externally
        const loopbackProduct = variant.Products.find(p => p.Name === ingredient.Name)!;
        const netPerCycle = ingredient.Ammount - loopbackProduct.Ammount * (1 - effectiveReduction);
        if (netPerCycle > 0) {
          resolveScaled(ingredient.Name, netPerCycle * cycles);
        }
        continue;
      }

      const effectivePerCycle = ingredient.IsStatic
        ? ingredient.Ammount
        : ingredient.Ammount * (1 - effectiveReduction);
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

  // ── Post-pass 1: match byproduct items to tag requirements ────────
  const byproductForTag = new Map<string, string>(); // tag → byproduct item name

  for (const [itemName] of byproductSupply) {
    const tags = tagsIndex.itemToTags.get(itemName) ?? [];
    for (const tag of tags) {
      if (tagRequirements.has(tag) && !choices.itemByTag.has(tag) && !byproductForTag.has(tag)) {
        byproductForTag.set(tag, itemName);
        // Register the item as required so Pass 2 routes it (but no item node — tag IS the node)
        const tagAmt = tagRequirements.get(tag)!;
        requirements.set(itemName, (requirements.get(itemName) ?? 0) + tagAmt);
      }
    }
  }

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

    const effectiveReduction = choices.upgradeByTable.get(recipe.CraftingTable) ?? globalUpgrade;

    const primaryProduct = variant.Products.find(p => p.Name === itemName) ?? variant.Products[0];
    const primaryAmmount = primaryProduct?.Ammount ?? 1;
    const cycles = Math.ceil(net / primaryAmmount);

    // Identify loopback items for this variant
    const loopbackItems = new Set(
      variant.Products
        .filter(p => p.Name !== itemName)
        .filter(p => variant.Ingredients.some(i => i.Name === p.Name && !i.IsStatic))
        .map(p => p.Name)
    );

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

      // Byproduct outputs
      for (const product of variant.Products) {
        if (product.Name === itemName) continue;

        if (loopbackItems.has(product.Name)) {
          // Loopback node: item is both consumed and returned by this table
          const loopbackId = `loopback:${product.Name}:from:${itemName}`;
          const loopIngredient = variant.Ingredients.find(i => i.Name === product.Name && !i.IsStatic)!;
          const grossAmount = loopIngredient.Ammount * cycles;
          const returnAmount = product.Ammount * (1 - effectiveReduction) * cycles;
          const netAmount = grossAmount - returnAmount;

          if (!builtNodes.has(loopbackId)) {
            builtNodes.add(loopbackId);
            const loopbackNode: LoopbackPlannerNode = {
              type: 'loopback',
              id: loopbackId,
              itemName: product.Name,
              tableId,
              grossAmount,
              returnAmount,
              netAmount
            };
            nodes.push(loopbackNode);
          }

          addEdge(tableId, loopbackId);   // table → loopback (return flow)
          addEdge(loopbackId, tableId);   // loopback → table (input flow)

          if (netAmount > 0) {
            buildNodes(product.Name, netAmount);
            addEdge(itemNodeId(product.Name), loopbackId);
          }
          continue;
        }

        // Fix B: if this byproduct resolves a tag, route table → tag directly
        const feedsTag = [...byproductForTag.entries()].find(([, v]) => v === product.Name)?.[0];
        if (feedsTag) {
          addEdge(tableId, tagNodeId(feedsTag));
        } else {
          const neededInChain = (requirements.get(product.Name) ?? 0) > 0;
          if (neededInChain) {
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
    }

    // Recurse into ingredients, building edges as we go
    for (const ingredient of variant.Ingredients) {
      // Loopback items are handled via their loopback node, not here
      if (loopbackItems.has(ingredient.Name)) continue;

      const effectivePerCycle = ingredient.IsStatic
        ? ingredient.Ammount
        : ingredient.Ammount * (1 - effectiveReduction);
      const ingredientTotal = effectivePerCycle * cycles;

      if (ingredient.IsSpecificItem) {
        addEdge(itemNodeId(ingredient.Name), tableId);
        buildNodes(ingredient.Name, ingredientTotal);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        const tagId = tagNodeId(tag);
        const tagTotal = tagRequirements.get(tag) ?? ingredientTotal;

        addEdge(tagId, tableId);

        const resolvedItem = choices.itemByTag.get(tag) ?? byproductForTag.get(tag) ?? null;
        const isByproductResolver = resolvedItem !== null && resolvedItem === byproductForTag.get(tag);
        const bpSupply = isByproductResolver
          ? (byproductSupply.get(resolvedItem!) ?? 0)
          : 0;
        const tagNet = Math.max(0, tagTotal - bpSupply);

        if (!builtNodes.has(tagId)) {
          builtNodes.add(tagId);
          const tagNode: TagPlannerNode = {
            type: 'tag',
            id: tagId,
            tag,
            amount: tagNet,
            availableItems: tagsIndex.byTag.get(tag) ?? [],
            selectedItem: resolvedItem,
            byproductSupply: bpSupply > 0 ? bpSupply : undefined
          };
          nodes.push(tagNode);
        }

        if (resolvedItem && !isByproductResolver) {
          // Fix A: item → tag (not item → table directly)
          addEdge(itemNodeId(resolvedItem), tagId);
          buildNodes(resolvedItem, ingredientTotal);
        }
        // If byproductResolver: table→tag edge already added in byproduct loop (Fix B)
      }
    }
  }

  buildNodes(targetItem, totalAmount);

  return { nodes, edges };
}
