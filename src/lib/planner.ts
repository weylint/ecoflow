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
  InlinedProduction,
  UserChoices
} from './types.js';
import type { TalentIndex } from './talentIndex.js';
import { EXCLUDED_BYPRODUCTS, RAW_OVERRIDES } from './types.js';
import type { RecipeIndex } from './recipeIndex.js';
import type { TagsIndex } from './tagsIndex.js';
import { ingredientAmountPerCycle } from './resourceCost.js';

interface BuildOptions {
  targetItem: string;
  totalAmount: number;
  recipeIndex: RecipeIndex;
  tagsIndex: TagsIndex;
  choices: UserChoices;
  globalUpgrade: number;  // 0.0 – 1.0 default reduction; per-table overrides in choices.upgradeByTable
  talentData?: TalentIndex;  // recipe Key → reduction + talent details (Eco 13 only)
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
  const { targetItem, totalAmount, recipeIndex, tagsIndex, choices, globalUpgrade, talentData } = opts;

  // Accumulate total requirements and byproduct supply
  const requirements = new Map<string, number>();
  const tagRequirements = new Map<string, number>();
  const byproductSupply = new Map<string, number>();

  // Track edges and nodes
  const edges: PlannerEdge[] = [];
  const edgeSet = new Set<string>();

  // Pass 1: tracks how many cycles of each item have already been expanded,
  // so re-visits only process the incremental delta (fixes multi-path accumulation).
  const processedCycles = new Map<string, number>();
  // Pass 2: prevents rebuilding the same node/edge twice.
  const visited = new Set<string>();
  // Items whose producer nodes are suppressed (inlined into the parent table node).
  const inlinedItems = new Set<string>();

  function addEdge(source: string, target: string) {
    const key = `${source}->${target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ id: key, source, target });
    }
  }

  // ── Pass 1 (gross): accumulate requirements + byproduct supply ────
  // Edges are NOT built here — buildNodes handles all edge creation.
  //
  // Uses processedCycles instead of a visited set so that items needed via
  // multiple paths get their ingredients correctly expanded for the full total.
  // Each call recurses only for the *incremental* cycles not yet processed.
  function resolveScaled(itemName: string, amount: number): void {
    requirements.set(itemName, (requirements.get(itemName) ?? 0) + amount);

    const recipes = recipeIndex.byProduct.get(itemName) ?? [];
    if (recipes.length === 0 || choices.marketItems.has(itemName) || RAW_OVERRIDES.has(itemName)) return;

    const recipe = choices.recipeByItem.get(itemName) ?? recipes[0];
    const variant =
      choices.variantByItem.get(itemName) ??
      recipe.Variants.find(v => v.Products[0]?.Name === itemName) ??
      getDefaultVariant(recipe);

    // Only treat this as the "true" crafting intent when itemName is the leading product.
    // If the recipe's first product is something else (itemName is a byproduct of that recipe),
    // skip byproduct supply tracking and ingredient recursion — the item will be supplied
    // as a side effect of producing the true primary.
    const isTruePrimary = variant.Products[0]?.Name === itemName;
    if (!isTruePrimary) return;

    const upgradeReduction = recipe.CraftingTableCanUseModules
      ? (choices.upgradeByTable.get(recipe.CraftingTable) ?? globalUpgrade)
      : 0;
    const talentReduction = Math.min(talentData?.get(recipe.Key)?.totalReduction ?? 0, 1);
    const effectiveReduction = 1 - (1 - upgradeReduction) * (1 - talentReduction);

    const primaryProduct = variant.Products.find(p => p.Name === itemName) ?? variant.Products[0];
    const primaryAmmount = primaryProduct?.Ammount ?? 1;

    // Compute delta: only expand cycles we haven't yet processed
    const totalRequired = requirements.get(itemName)!;
    const totalCycles = Math.ceil(totalRequired / primaryAmmount);
    const prevCycles = processedCycles.get(itemName) ?? 0;
    const newCycles = totalCycles - prevCycles;
    if (newCycles <= 0) return;
    processedCycles.set(itemName, totalCycles);

    // Identify loopback items: products that also appear as IsStatic:false ingredients
    const loopbackItems = new Set(
      variant.Products
        .filter(p => p.Name !== itemName)
        .filter(p => variant.Ingredients.some(i => i.Name === p.Name && !i.IsStatic))
        .map(p => p.Name)
    );

    // Track byproduct supply from the new cycles (skip loopback items)
    for (const product of variant.Products) {
      if (product.Name === itemName) continue;
      if (loopbackItems.has(product.Name)) continue;
      byproductSupply.set(product.Name, (byproductSupply.get(product.Name) ?? 0) + product.Ammount * (1 - effectiveReduction) * newCycles);
    }

    for (const ingredient of variant.Ingredients) {
      if (loopbackItems.has(ingredient.Name)) {
        // Both input and return scale with upgrade; net is the difference
        const loopbackProduct = variant.Products.find(p => p.Name === ingredient.Name)!;
        const netPerCycle = (ingredient.Ammount - loopbackProduct.Ammount) * (1 - effectiveReduction);
        if (netPerCycle > 0) {
          resolveScaled(ingredient.Name, netPerCycle * newCycles);
        }
        continue;
      }

      const effectivePerCycle = ingredientAmountPerCycle(ingredient, {
        upgradeReduction,
        talentReduction,
        effectiveReduction
      });
      const ingredientTotal = effectivePerCycle * newCycles;

      if (ingredient.IsSpecificItem) {
        resolveScaled(ingredient.Name, ingredientTotal);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        tagRequirements.set(tag, (tagRequirements.get(tag) ?? 0) + ingredientTotal);
        // Do not resolveScaled for user-chosen tag items here — deferred to post-pass-1
        // so byproduct allocation happens first and user item only covers the remainder.
      }
    }
  }

  resolveScaled(targetItem, totalAmount);

  // ── Post-pass 1: match byproduct items to tag requirements ────────
  // Each tag can be satisfied by multiple byproducts — allocate greedily until requirement is met.
  const byproductForTag = new Map<string, { itemName: string; contribution: number }[]>();

  for (const [tag, tagAmt] of tagRequirements) {
    let remaining = tagAmt;
    const contributors: { itemName: string; contribution: number }[] = [];
    for (const [itemName, supply] of byproductSupply) {
      if (remaining <= 0) break;
      if (EXCLUDED_BYPRODUCTS.has(itemName)) continue;
      if (!(tagsIndex.itemToTags.get(itemName) ?? []).includes(tag)) continue;
      const contribution = Math.min(supply, remaining);
      contributors.push({ itemName, contribution });
      // Register item as required so Pass 2 routes it to the tag
      requirements.set(itemName, (requirements.get(itemName) ?? 0) + contribution);
      remaining -= contribution;
    }
    if (contributors.length > 0) byproductForTag.set(tag, contributors);

    // If user chose an item for this tag, resolve only the remainder after byproduct coverage
    const userChosenItem = choices.itemByTag.get(tag);
    if (userChosenItem) {
      const totalBpContribution = contributors.reduce((s, c) => s + c.contribution, 0);
      const remainingForUser = Math.max(0, tagAmt - totalBpContribution);
      if (remainingForUser > 0) resolveScaled(userChosenItem, remainingForUser);
    }
  }

  // ── Pass 2 (build): create nodes and edges ──────────────────────
  const nodes: PlannerNode[] = [];
  const builtNodes = new Set<string>();
  visited.clear();

  function buildNodes(itemName: string, amount: number): void {
    if (visited.has(itemName)) return;
    if (inlinedItems.has(itemName)) return;
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

    if (recipes.length === 0 || RAW_OVERRIDES.has(itemName)) {
      // Raw resource — leaf node (no recipe, or overridden to gathered)
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
          ...(supply > 0 ? { byproductSupply: supply } : {}),
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
      recipe.Variants.find(v => v.Products[0]?.Name === itemName) ??
      getDefaultVariant(recipe);

    // If this item is only a secondary product of the chosen recipe (not Products[0]),
    // treat it like a raw resource — it can only be obtained as a byproduct of other crafting.
    if (variant.Products[0]?.Name !== itemName) {
      // Replace the item node we already pushed with a raw node (same id)
      const idx = nodes.findIndex(n => n.id === itemId);
      if (idx !== -1) {
        nodes[idx] = { type: 'raw', id: itemId, itemName, amount: net, ...(supply > 0 ? { byproductSupply: supply } : {}) } as RawPlannerNode;
      }
      return;
    }

    const upgradeReduction = recipe.CraftingTableCanUseModules
      ? (choices.upgradeByTable.get(recipe.CraftingTable) ?? globalUpgrade)
      : 0;
    const talentReduction = Math.min(talentData?.get(recipe.Key)?.totalReduction ?? 0, 1);
    const effectiveReduction = 1 - (1 - upgradeReduction) * (1 - talentReduction);

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

    // Detect inlineable ingredients: ingredient X is inlineable when all of X's producer's
    // own ingredients are covered by this variant's products (e.g. Petroleum for Plastic —
    // Pump Jack only needs Barrel, which Plastic produces as a byproduct).
    const inlineMap = new Map<string, { recipe: RecipeObject; variant: Variant }>();
    for (const ingredient of variant.Ingredients) {
      if (!ingredient.IsSpecificItem) continue;
      if (loopbackItems.has(ingredient.Name)) continue;
      const prodRecipes = recipeIndex.byProduct.get(ingredient.Name) ?? [];
      if (prodRecipes.length === 0) continue;
      const prodRecipe = choices.recipeByItem.get(ingredient.Name) ?? prodRecipes[0];
      const prodVariant =
        choices.variantByItem.get(ingredient.Name) ??
        prodRecipe.Variants.find(v => v.Products[0]?.Name === ingredient.Name) ??
        getDefaultVariant(prodRecipe);
      const allCovered = prodVariant.Ingredients.every(pi =>
        variant.Products.some(p => p.Name === pi.Name)
      );
      if (allCovered) inlineMap.set(ingredient.Name, { recipe: prodRecipe, variant: prodVariant });
    }

    // Build InlinedProduction data for each inlineable ingredient.
    const inlinedProductionsData: InlinedProduction[] = [];
    for (const [ingredName, { recipe: prodRecipe, variant: prodVariant }] of inlineMap) {
      const prodUpgrade = prodRecipe.CraftingTableCanUseModules
        ? (choices.upgradeByTable.get(prodRecipe.CraftingTable) ?? globalUpgrade) : 0;
      const prodTalent = Math.min(talentData?.get(prodRecipe.Key)?.totalReduction ?? 0, 1);
      const prodEffective = 1 - (1 - prodUpgrade) * (1 - prodTalent);

      const prodPrimary = prodVariant.Products.find(p => p.Name === ingredName) ?? prodVariant.Products[0];
      const parentIngredient = variant.Ingredients.find(i => i.Name === ingredName)!;
      const ingredAmountNeeded = ingredientAmountPerCycle(parentIngredient, {
        upgradeReduction, talentReduction, effectiveReduction
      }) * cycles;
      const prodCycles = Math.ceil(ingredAmountNeeded / (prodPrimary?.Ammount ?? 1));

      const grossIngredients = prodVariant.Ingredients.map(pi => ({
        name: pi.Name,
        amount: ingredientAmountPerCycle(pi, {
          upgradeReduction: prodUpgrade, talentReduction: prodTalent, effectiveReduction: prodEffective
        }) * prodCycles,
        isStatic: pi.IsStatic,
      }));

      const netIngredients = grossIngredients.map(gi => {
        const byproductReturn = variant.Products.find(p => p.Name === gi.name);
        const returned = byproductReturn
          ? byproductReturn.Ammount * (1 - effectiveReduction) * cycles
          : 0;
        return { name: gi.name, amount: Math.max(0, gi.amount - returned) };
      });

      inlinedProductionsData.push({
        itemName: ingredName,
        producerTable: prodRecipe.CraftingTable,
        recipe: prodRecipe,
        variant: prodVariant,
        cycles: prodCycles,
        upgradeReduction: prodUpgrade,
        talentReduction: prodTalent,
        effectiveReduction: prodEffective,
        appliedTalents: talentData?.get(prodRecipe.Key)?.talents ?? [],
        grossIngredients,
        netIngredients,
      });
    }

    const tableId = tableNodeId(itemName);
    if (!builtNodes.has(tableId)) {
      builtNodes.add(tableId);

      // Collect loopback data inline (mold/barrel items returned by this table)
      const loopbackItemsData: TablePlannerNode['loopbackItems'] = [];
      for (const product of variant.Products) {
        if (!loopbackItems.has(product.Name)) continue;
        const loopIngredient = variant.Ingredients.find(i => i.Name === product.Name && !i.IsStatic)!;
        // Both input and return scale with upgrade
        const grossAmount = loopIngredient.Ammount * (1 - effectiveReduction) * cycles;
        const returnAmount = product.Ammount * (1 - effectiveReduction) * cycles;
        const netAmount = grossAmount - returnAmount;
        loopbackItemsData.push({ itemName: product.Name, grossAmount, returnAmount, netAmount });
      }

      const tableNode: TablePlannerNode = {
        type: 'table',
        id: tableId,
        itemName,
        table: recipe.CraftingTable,
        recipe,
        variant,
        cycles,
        upgradeReduction,
        talentReduction,
        effectiveReduction,
        appliedTalents: talentData?.get(recipe.Key)?.talents ?? [],
        availableRecipes: recipes,
        ...(loopbackItemsData.length > 0 ? { loopbackItems: loopbackItemsData } : {}),
        ...(inlinedProductionsData.length > 0 ? { inlinedProductions: inlinedProductionsData } : {})
      };
      nodes.push(tableNode);
      addEdge(tableId, itemId);  // table produces primary item

      // Byproduct outputs
      for (const product of variant.Products) {
        if (product.Name === itemName) continue;

        if (loopbackItems.has(product.Name)) {
          // Loopback is now inline in the table; only add supply edge if net > 0
          const lb = loopbackItemsData.find(l => l.itemName === product.Name)!;
          if (lb.netAmount > 0) {
            buildNodes(product.Name, lb.netAmount);
            addEdge(itemNodeId(product.Name), tableId);
          }
          continue;
        }

        // Skip byproducts consumed internally by an inlined producer (e.g. Barrel → Pump Jack).
        // These are part of the hidden internal loop and must not appear as external edges.
        const consumedByInlinedProducer = inlinedProductionsData.some(ip =>
          ip.variant.Ingredients.some(i => i.Name === product.Name)
        );
        if (consumedByInlinedProducer) continue;

        // Fix B: if this byproduct contributes to a tag, route table → tag directly
        const feedsTag = [...byproductForTag.entries()]
          .find(([, contribs]) => contribs.some(c => c.itemName === product.Name))?.[0];
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
                amount: product.Ammount * (1 - effectiveReduction) * cycles
              };
              nodes.push(byproductNode);
            }
          }
        }
      }
    }

    // Recurse into ingredients, building edges as we go
    for (const ingredient of variant.Ingredients) {
      // Loopback items are handled inline in the table node (net supply edge added above)
      if (loopbackItems.has(ingredient.Name)) continue;

      // Inlined ingredients (e.g. Petroleum): suppress their nodes and route the inlined
      // producer's net external inputs (e.g. net Barrel) directly to this table instead.
      if (inlineMap.has(ingredient.Name)) {
        inlinedItems.add(ingredient.Name);
        const ip = inlinedProductionsData.find(d => d.itemName === ingredient.Name)!;
        for (const netIng of ip.netIngredients) {
          if (netIng.amount > 0) {
            addEdge(itemNodeId(netIng.name), tableId);
            buildNodes(netIng.name, netIng.amount);
          }
        }
        continue;
      }

      const effectivePerCycle = ingredientAmountPerCycle(ingredient, {
        upgradeReduction,
        talentReduction,
        effectiveReduction
      });
      const ingredientTotal = effectivePerCycle * cycles;

      if (ingredient.IsSpecificItem) {
        addEdge(itemNodeId(ingredient.Name), tableId);
        buildNodes(ingredient.Name, ingredientTotal);
      } else if (ingredient.Tag) {
        const tag = ingredient.Tag;
        const tagId = tagNodeId(tag);
        const tagTotal = tagRequirements.get(tag) ?? ingredientTotal;

        addEdge(tagId, tableId);

        const userChosenItem = choices.itemByTag.get(tag) ?? null;
        const bpContributors = byproductForTag.get(tag) ?? [];
        const totalBpContribution = bpContributors.reduce((sum, c) => sum + c.contribution, 0);
        const tagNet = Math.max(0, tagTotal - totalBpContribution);

        if (!builtNodes.has(tagId)) {
          builtNodes.add(tagId);
          const craftableItems = (tagsIndex.byTag.get(tag) ?? [])
            .filter(item => recipeIndex.byProduct.has(item));
          const tagNode: TagPlannerNode = {
            type: 'tag',
            id: tagId,
            tag,
            amount: tagNet,
            availableItems: tagsIndex.byTag.get(tag) ?? [],
            selectedItem: userChosenItem,
            byproductContributors: bpContributors.length > 0 ? bpContributors : undefined,
            craftableItems,
          };
          nodes.push(tagNode);
        }

        if (userChosenItem) {
          // Fix A: item → tag (not item → table directly)
          addEdge(itemNodeId(userChosenItem), tagId);
          buildNodes(userChosenItem, tagNet);
        }
        // Fix B: table→tag edges already added for each byproduct contributor in byproduct loop
      }
    }
  }

  buildNodes(targetItem, totalAmount);

  for (const node of nodes) {
    if (node.type !== 'table') continue;
    for (const ip of (node as TablePlannerNode).inlinedProductions ?? []) {
      for (const netIng of ip.netIngredients) {
        const itemNode = nodes.find(n => n.id === itemNodeId(netIng.name));
        if (itemNode && 'byproductSupply' in itemNode) {
          (itemNode as ItemPlannerNode | RawPlannerNode).byproductSupply = undefined;
        }
      }
    }
  }

  return { nodes, edges };
}
