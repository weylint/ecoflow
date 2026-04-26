<script lang="ts">
  import { onMount } from 'svelte';
  import { dev, browser } from '$app/environment';
  import { writable, get } from 'svelte/store';
  import { SvelteFlow, Controls, Background, MiniMap, Panel } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import type { Node, Edge, NodeTypes, EdgeTypes } from '@xyflow/svelte';
  import { ECO12_UPGRADE_LEVELS, ECO13_UPGRADE_LEVELS, getUpgradeLevels, EXCLUDED_BYPRODUCTS, DEFAULT_LAYOUT_OPTIONS, DEFAULT_TAG_CHOICES, DEFAULT_RECIPE_CHOICES, DEFAULT_MARKET_ITEMS } from '$lib/types.js';
  import type { LayoutOptions, PlannerGraph } from '$lib/types.js';
  import type { RecipeObject, Variant, TagsFile, RecipeFile, UserChoices, TablePlannerNode, RawPlannerNode, MarketPlannerNode, TagPlannerNode, ByproductPlannerNode, ByproductResolveOption, IngredientStats, ProductStats } from '$lib/types.js';
  import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '$lib/settings.js';
  import type { AppSettings } from '$lib/settings.js';
  import { computeEdmReport, resolveItemEdmValue, PROFESSION_FOOD_TIER } from '$lib/edm.js';
  import type { EdmReport, TransitionPathEntry } from '$lib/edm.js';
  import { displayedProductEdmPerUnit, tableEdmPerUnit } from '$lib/nodeEdmDisplay.js';
  import { fmtNum, fmtEdm, fmtLabor } from '$lib/format.js';
  import { buildRecipeIndex } from '$lib/recipeIndex.js';
  import { buildTagsIndex } from '$lib/tagsIndex.js';
  import { buildTalentIndex } from '$lib/talentIndex.js';
  import type { TalentIndex } from '$lib/talentIndex.js';
  import { ingredientAmountPerCycle } from '$lib/resourceCost.js';
  import { buildGraph } from '$lib/planner.js';
  import type { ProfessionData } from '$lib/types.js';

  import TableNode from '$lib/components/TableNode.svelte';
  import RawNode from '$lib/components/RawNode.svelte';
  import TagNode from '$lib/components/TagNode.svelte';
  import MarketNode from '$lib/components/MarketNode.svelte';
  import ByproductNode from '$lib/components/ByproductNode.svelte';
  import ProfessionGroupNode from '$lib/components/ProfessionGroupNode.svelte';
  import LabeledEdge from '$lib/components/LabeledEdge.svelte';
  import TablePane from '$lib/components/TablePane.svelte';
  import ResolveModal from '$lib/components/ResolveModal.svelte';
  import FitViewOnDemand from '$lib/components/FitViewOnDemand.svelte';

  // ── Custom node type registry ────────────────────────────────────
  const nodeTypes = {
    tableNode: TableNode,
    rawNode: RawNode,
    tagNode: TagNode,
    marketNode: MarketNode,
    byproductNode: ByproductNode,
    professionGroup: ProfessionGroupNode
  } as unknown as NodeTypes;

  const edgeTypes = {
    labeledEdge: LabeledEdge
  } as unknown as EdgeTypes;

  // ── State ────────────────────────────────────────────────────────
  let recipeIndex = $state<ReturnType<typeof buildRecipeIndex> | null>(null);
  let tagsIndex = $state<ReturnType<typeof buildTagsIndex> | null>(null);
  let talentIndex = $state<TalentIndex>(new Map());
  let loading = $state(true);
  let error = $state<string | null>(null);

  let settings = $state<AppSettings>({ ...DEFAULT_SETTINGS, edmValues: { ...DEFAULT_SETTINGS.edmValues }, edmTagDefaults: { ...DEFAULT_SETTINGS.edmTagDefaults } });
  const upgradeLevels = $derived(getUpgradeLevels(settings.ecoMode));

  const _urlParams = browser ? new URL(window.location.href).searchParams : null;
  const _urlAmount = _urlParams ? parseInt(_urlParams.get('amount') ?? '', 10) : NaN;

  let selectedProduct = $state(_urlParams?.get('product') ?? 'Steel Bar');
  let amount = $state(_urlAmount > 0 ? _urlAmount : 100);

  $effect(() => {
    if (!browser) return;
    const url = new URL(window.location.href);
    url.searchParams.set('product', selectedProduct);
    url.searchParams.set('amount', String(amount));
    history.replaceState({}, '', url.toString());
  });
  let globalUpgrade = $state(0.25);  // Eco13 default max

  let tagDefaults = $state(new Map<string, string>(Object.entries(DEFAULT_TAG_CHOICES)));

  let choices = $state<UserChoices>({
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(Object.entries(DEFAULT_TAG_CHOICES)),
    marketItems: new Set(DEFAULT_MARKET_ITEMS),
    upgradeByTable: new Map()
  });

  let plannerTableNodes = $state<TablePlannerNode[]>([]);
  let plannerRawNodes = $state<RawPlannerNode[]>([]);
  let plannerMarketNodes = $state<MarketPlannerNode[]>([]);
  let plannerUnresolvedTagNodes = $state<TagPlannerNode[]>([]);
  let plannerByproductNodes = $state<ByproductPlannerNode[]>([]);
  let lastPlannerGraph = $state<PlannerGraph | null>(null);

  const edmReport = $derived.by((): EdmReport | null => {
    if (!lastPlannerGraph) return null;
    if (!tagsIndex) return null;
    return computeEdmReport(lastPlannerGraph, settings, tagsIndex);
  });

  const edmGrouped = $derived.by(() => {
    const groups = new Map<string | null, RawPlannerNode[]>();
    for (const node of plannerRawNodes) {
      const tags = tagsIndex?.itemToTags.get(node.itemName) ?? [];
      const primaryTag =
        tags.find(t => settings.edmTagDefaults[t] !== undefined) ?? tags[0] ?? null;
      const bucket = groups.get(primaryTag) ?? [];
      bucket.push(node);
      groups.set(primaryTag, bucket);
    }
    return groups;
  });

  const laborByProfession = $derived.by(() => {
    const map = new Map<string, number>();
    for (const n of plannerTableNodes) {
      const prof = n.recipe.SkillNeeds[0]?.Skill ?? 'No Skill Required';
      map.set(prof, (map.get(prof) ?? 0) + n.recipe.BaseLaborCost * n.cycles);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  let compareUpgrade = $state<{ value: number; mode: 'eco12' | 'eco13' } | null>(null);

  const comparisonReport = $derived.by(() => {
    if (compareUpgrade === null || !recipeIndex || !tagsIndex) return null;
    const snap = $state.snapshot(choices) as UserChoices;
    const pg = buildGraph({
      targetItem: selectedProduct,
      totalAmount: amount,
      recipeIndex,
      tagsIndex,
      choices: { ...snap, upgradeByTable: new Map() },
      globalUpgrade: compareUpgrade.value,
      talentData: compareUpgrade.mode === 'eco13' ? talentIndex : undefined
    });
    const rawNodes = pg.nodes.filter((n): n is RawPlannerNode => n.type === 'raw');
    const cmpTableNodes = pg.nodes.filter((n): n is TablePlannerNode => n.type === 'table');
    const unresolvedTagNodes = pg.nodes.filter((n): n is TagPlannerNode => n.type === 'tag' && n.amount > 0 && n.selectedItem === null);
    const byproductNodes = pg.nodes.filter((n): n is ByproductPlannerNode => n.type === 'byproduct');
    const laborMap = new Map<string, number>();
    for (const n of cmpTableNodes) {
      const prof = n.recipe.SkillNeeds[0]?.Skill ?? 'No Skill Required';
      laborMap.set(prof, (laborMap.get(prof) ?? 0) + n.recipe.BaseLaborCost * n.cycles);
    }
    return {
      rawByItem:        new Map(rawNodes.map(n => [n.itemName, n.amount])),
      tagByName:        new Map(unresolvedTagNodes.map(n => [n.tag, n.amount])),
      byproductByKey:   new Map(byproductNodes.map(n => [n.id, n.amount])),
      laborByProfession: [...laborMap.entries()].sort((a, b) => b[1] - a[1]),
      edmReport:        computeEdmReport(pg, settings, tagsIndex)
    };
  });

  let showReport = $state(false);
  let showResolve = $state(false);
  let expandedTransition = $state<number | null>(null);
  let showLayoutSettings = $state(false);
  let layoutOptions = $state<LayoutOptions>({ ...DEFAULT_LAYOUT_OPTIONS });
  let darkMode = $state(true);
  let groupByProfession = $state(false);

  $effect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('light', !darkMode);
  });

  $effect(() => {
    // Persist settings to localStorage whenever they change.
    // We snapshot to avoid capturing reactive proxies.
    saveSettings($state.snapshot(settings) as AppSettings);
  });

  function fmtDeltaPct(cur: number, cmp: number): string {
    if (cur === 0 && cmp === 0) return '—';
    if (cur === 0) return 'new';
    const pct = Math.round((cmp - cur) / cur * 100);
    return (pct > 0 ? '+' : '') + pct + '%';
  }

  function openReport() {
    expandedTransition = null;
    const otherMode: 'eco12' | 'eco13' = settings.ecoMode === 'eco13' ? 'eco12' : 'eco13';
    const otherLevels = getUpgradeLevels(otherMode);
    compareUpgrade = { value: otherLevels[otherLevels.length - 1].value, mode: otherMode };
    showReport = true;
  }

  function closeReport() {
    showReport = false;
    compareUpgrade = null;
    expandedTransition = null;
  }

  // SvelteFlow v0.1.x requires writable stores, not $state arrays
  const flowNodes = writable<Node[]>([]);
  const flowEdges = writable<Edge[]>([]);
  let graphBuilding = $state(false);
  let fitViewPending = $state(false);

  // ── Data loading ─────────────────────────────────────────────────
  const RECIPES_URL = dev
    ? './recipes.json'
    : 'https://white-tiger.play.eco/api/v1/plugins/EcoPriceCalculator/recipes';
  const TAGS_URL = dev
    ? './tags.json'
    : 'https://white-tiger.play.eco/api/v1/plugins/EcoPriceCalculator/tags';

  async function fetchWithFallback(url: string, fallback: string): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) return res;
      return fetch(fallback);
    } catch {
      clearTimeout(id);
      return fetch(fallback);
    }
  }

  onMount(async () => {
    // Load persisted settings before first render/plan
    const saved = loadSettings();
    settings = saved;
    // Initialise globalUpgrade to max of whichever mode was saved
    const levels = getUpgradeLevels(saved.ecoMode);
    globalUpgrade = levels[levels.length - 1].value;

    try {
      const [recipesRes, tagsRes, professionsRes] = await Promise.all([
        fetchWithFallback(RECIPES_URL, './recipes.json'),
        fetchWithFallback(TAGS_URL, './tags.json'),
        fetch('./professions.json')
      ]);

      if (!recipesRes.ok || !tagsRes.ok) throw new Error('Failed to load data files');

      const recipesData: RecipeFile = await recipesRes.json();
      const tagsData: TagsFile = await tagsRes.json();

      recipeIndex = buildRecipeIndex(recipesData.Recipes);
      tagsIndex = buildTagsIndex(tagsData.Tags);

      if (professionsRes.ok) {
        const professionsData: { professions: ProfessionData[] } = await professionsRes.json();
        talentIndex = buildTalentIndex(professionsData.professions, recipesData.Recipes, tagsData.Tags);
      }

      // Apply default recipe selections (e.g. Clean Medium Fish for Raw Fish)
      for (const [itemName, recipeKey] of Object.entries(DEFAULT_RECIPE_CHOICES)) {
        if (!choices.recipeByItem.has(itemName)) {
          const match = (recipeIndex.byProduct.get(itemName) ?? []).find(r => r.Key === recipeKey);
          if (match) choices.recipeByItem.set(itemName, match);
        }
      }

      // Validate product after data loads; fall back to first craftable if unknown
      if (!recipeIndex.allCraftableNames.includes(selectedProduct)) {
        selectedProduct = recipeIndex.allCraftableNames[0] ?? '';
      }

      loading = false;

      // Auto-plan on load — fresh layout so viewport fits
      await replan(false);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      loading = false;
    }
  });

  // ── Byproduct resolve options ─────────────────────────────────────
  // Computes all ways a byproduct can be used: directly satisfying an unresolved tag,
  // or by crafting it into a primary product that satisfies an unresolved tag.
  function computeResolveOptions(
    itemName: string,
    unresolvedTags: TagPlannerNode[]
  ): ByproductResolveOption[] {
    if (!recipeIndex || !tagsIndex) return [];
    if (EXCLUDED_BYPRODUCTS.has(itemName)) return [];
    const unresolved = new Map(unresolvedTags.map(n => [n.tag, n.amount]));
    const options: ByproductResolveOption[] = [];
    const seen = new Set<string>();

    for (const tag of tagsIndex.itemToTags.get(itemName) ?? []) {
      if (!unresolved.has(tag)) continue;
      const key = `${itemName}:${tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ outputItem: itemName, tag, tagAmount: unresolved.get(tag)! });
    }

    for (const recipe of recipeIndex.byIngredient.get(itemName) ?? []) {
      const variant = recipe.Variants.find(v => v.Name === recipe.DefaultVariant) ?? recipe.Variants[0];
      const primary = variant?.Products[0];
      if (!primary) continue;
      for (const tag of tagsIndex.itemToTags.get(primary.Name) ?? []) {
        if (!unresolved.has(tag)) continue;
        const key = `${primary.Name}:${tag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
          outputItem: primary.Name,
          tag,
          tagAmount: unresolved.get(tag)!,
          via: { tableName: recipe.CraftingTable },
        });
      }
    }

    options.sort((a, b) => {
      const d = (a.via ? 1 : 0) - (b.via ? 1 : 0);
      return d !== 0 ? d : a.outputItem.localeCompare(b.outputItem);
    });
    return options;
  }

  // ── Planning ─────────────────────────────────────────────────────
  async function replan(preservePositions = true) {
    if (!recipeIndex || !tagsIndex) return;
    graphBuilding = true;

    try {
      const plannerGraph = buildGraph({
        targetItem: selectedProduct,
        totalAmount: amount,
        recipeIndex,
        tagsIndex,
        choices: $state.snapshot(choices) as UserChoices,
        globalUpgrade,
        talentData: settings.ecoMode === 'eco13' ? talentIndex : undefined
      });

      lastPlannerGraph = plannerGraph;
      plannerTableNodes = plannerGraph.nodes.filter((n): n is TablePlannerNode => n.type === 'table');
      plannerRawNodes = plannerGraph.nodes.filter((n): n is RawPlannerNode => n.type === 'raw');
      plannerMarketNodes = plannerGraph.nodes.filter((n): n is MarketPlannerNode => n.type === 'market');
      plannerUnresolvedTagNodes = plannerGraph.nodes.filter(
        (n): n is TagPlannerNode =>
          n.type === 'tag' && n.amount > 0 &&
          (n.selectedItem === null || (n.byproductContributors?.length ?? 0) > 0)
      );
      plannerByproductNodes = plannerGraph.nodes.filter((n): n is ByproductPlannerNode => n.type === 'byproduct');

      const { buildFlowGraph } = await import('$lib/graphBuilder.js');
      const flow = await buildFlowGraph(plannerGraph, groupByProfession, layoutOptions);

      let layoutNodes = flow.nodes;

      if (preservePositions) {
        const currentNodes = get(flowNodes);
        const currentMap = new Map(currentNodes.map(n => [n.id, n]));
        layoutNodes = flow.nodes.map(n => {
          const existing = currentMap.get(n.id);
          return existing ? { ...n, position: existing.position } : n;
        });
      }

      // Inject callbacks into node data here (avoids infinite $effect loops)
      const pgNodeMap = new Map(plannerGraph.nodes.map(n => [n.id, n]));
      const localEdmReport = computeEdmReport(plannerGraph, settings, tagsIndex!);
      const edgesByTarget = new Map<string, string[]>();
      const producerTableOf = new Map<string, TablePlannerNode>();

      for (const edge of plannerGraph.edges) {
        const sources = edgesByTarget.get(edge.target) ?? [];
        sources.push(edge.source);
        edgesByTarget.set(edge.target, sources);
        if (edge.source.startsWith('table:')) {
          const tableNode = pgNodeMap.get(edge.source);
          if (tableNode?.type === 'table') producerTableOf.set(edge.target, tableNode as TablePlannerNode);
        }
      }

      function resolveProducerTable(nodeId: string, seen = new Set<string>()): TablePlannerNode | undefined {
        if (seen.has(nodeId)) return undefined;
        seen.add(nodeId);
        const direct = producerTableOf.get(nodeId);
        if (direct) return direct;
        for (const sourceId of edgesByTarget.get(nodeId) ?? []) {
          const sourceNode = pgNodeMap.get(sourceId);
          if (sourceNode?.type === 'table') return sourceNode as TablePlannerNode;
          const indirect = resolveProducerTable(sourceId, seen);
          if (indirect) return indirect;
        }
        return undefined;
      }

      flowNodes.set(layoutNodes.map(n => {
        if (n.type === 'tableNode') {
          const tNode = n.data as unknown as TablePlannerNode;
          const prof = tNode.recipe.SkillNeeds[0]?.Skill ?? '';
          const tier = PROFESSION_FOOD_TIER[prof] ?? 'basic';
          const foodCalories = tNode.recipe.BaseLaborCost * tNode.cycles / 2;
          const foodEdm = settings.foodCostEnabled
            ? (foodCalories / 1000) * settings.foodTierCosts[tier]
            : null;

          const ingredientStats: IngredientStats[] = tNode.variant.Ingredients.map(ing => {
            let name = ing.Name;
            if (!ing.IsSpecificItem && ing.Tag) {
              name = choices.itemByTag.get(ing.Tag)
                ?? (pgNodeMap.get(`tag:${ing.Tag}`) as TagPlannerNode | undefined)?.selectedItem
                ?? ing.Tag;
            }
            const amount = ingredientAmountPerCycle(ing, tNode) * tNode.cycles;
            let edmPerUnit = resolveItemEdmValue(name, settings, tagsIndex!);
            if (edmPerUnit === null) {
              const inputId = ing.IsSpecificItem ? `item:${ing.Name}` : `tag:${ing.Tag as string}`;
              const producerTable = resolveProducerTable(inputId);
              if (producerTable) edmPerUnit = tableEdmPerUnit(producerTable, localEdmReport);
            }
            const totalEdm = edmPerUnit !== null ? amount * edmPerUnit : null;
            return { name, amount, edmPerUnit, totalEdm };
          });

          if (foodCalories > 0) {
            const foodEdmPerUnit = foodEdm !== null ? foodEdm / foodCalories : null;
            ingredientStats.unshift({ name: 'Food', amount: foodCalories, edmPerUnit: foodEdmPerUnit, totalEdm: foodEdm });
          }

          const productStats: ProductStats[] = tNode.variant.Products.map(prod => {
            const productAmount = prod.Ammount * tNode.cycles;
            let edmPerUnit = resolveItemEdmValue(prod.Name, settings, tagsIndex!);
            if (edmPerUnit === null && prod.Name === tNode.itemName) {
              edmPerUnit = displayedProductEdmPerUnit(tNode, localEdmReport, selectedProduct, amount);
            }
            const totalEdm = edmPerUnit !== null ? productAmount * edmPerUnit : null;
            return { name: prod.Name, amount: productAmount, edmPerUnit, totalEdm };
          });

          return {
            ...n,
            data: {
              ...n.data,
              onRecipeChange: handleRecipeChange,
              onVariantChange: handleVariantChange,
              onMarketSelect: handleMarketSelect,
              onUpgradeChange: handleUpgradeChange,
              currentUpgrade: choices.upgradeByTable.get(tNode.table) ?? globalUpgrade,
              upgradeLevels,
              ingredientStats,
              productStats,
              showStats: settings.showNodeStats,
            }
          };
        }
        if (n.type === 'tagNode') {
          return { ...n, data: { ...n.data, onTagSelect: handleTagSelect } };
        }
        if (n.type === 'marketNode') {
          return { ...n, data: { ...n.data, onRecipeChange: handleRecipeChange } };
        }
        if (n.type === 'byproductNode') {
          const bpNode = n.data as unknown as ByproductPlannerNode;
          const resolveOptions = computeResolveOptions(
            bpNode.itemName,
            plannerUnresolvedTagNodes
          );
          return { ...n, data: { ...n.data, resolveOptions, onResolve: handleTagSelect } };
        }
        return n;
      }));
      flowEdges.set(flow.edges);
      if (!preservePositions) fitViewPending = true;
    } finally {
      graphBuilding = false;
    }
  }

  function handlePlan() {
    // Reset user choices when explicitly replanning with a new product/amount
    const resetRecipes = new Map<string, RecipeObject>();
    for (const [itemName, recipeKey] of Object.entries(DEFAULT_RECIPE_CHOICES)) {
      const match = (recipeIndex?.byProduct.get(itemName) ?? []).find(r => r.Key === recipeKey);
      if (match) resetRecipes.set(itemName, match);
    }
    choices = {
      recipeByItem: resetRecipes,
      variantByItem: new Map(),
      itemByTag: new Map(tagDefaults),  // restore configurable defaults
      marketItems: new Set(DEFAULT_MARKET_ITEMS),
      upgradeByTable: new Map()
    };
    replan(false);
  }

  // ── Node event handlers ──────────────────────────────────────────
  function handleRecipeChange(itemName: string, recipe: RecipeObject) {
    choices.marketItems.delete(itemName);
    choices.recipeByItem.set(itemName, recipe);
    choices = { ...choices, recipeByItem: new Map(choices.recipeByItem), marketItems: new Set(choices.marketItems) };
    replan();
  }

  function handleMarketSelect(itemName: string) {
    choices.marketItems.add(itemName);
    choices.recipeByItem.delete(itemName);
    choices.variantByItem.delete(itemName);
    choices = { ...choices, marketItems: new Set(choices.marketItems), recipeByItem: new Map(choices.recipeByItem), variantByItem: new Map(choices.variantByItem) };
    replan();
  }

  function handleVariantChange(itemName: string, variant: Variant) {
    choices.variantByItem.set(itemName, variant);
    choices = { ...choices, variantByItem: new Map(choices.variantByItem) };
    replan();
  }

  function handleTagSelect(tag: string, item: string) {
    choices.itemByTag.set(tag, item);
    choices = { ...choices, itemByTag: new Map(choices.itemByTag) };
    replan();
  }

  function handleUpgradeChange(tableName: string, value: number) {
    choices.upgradeByTable.set(tableName, value);
    choices = { ...choices, upgradeByTable: new Map(choices.upgradeByTable) };
    replan();
  }

  function handleResolveApply(tagChoices: Map<string, string>) {
    for (const [tag, item] of tagChoices) {
      choices.itemByTag.set(tag, item);
    }
    choices = { ...choices, itemByTag: new Map(choices.itemByTag) };
    showResolve = false;
    replan();
  }
</script>

<svelte:head>
  <title>Eco Production Planner</title>
</svelte:head>

<div class="app">
  <header class="toolbar">
    <h1>Eco Production Planner</h1>

    <div class="controls">
      <label>
        Product:
        <select bind:value={selectedProduct} disabled={loading}>
          {#if recipeIndex}
            {#each recipeIndex.allCraftableNames as name}
              <option value={name}>{name}</option>
            {/each}
          {:else}
            <option>Loading…</option>
          {/if}
        </select>
      </label>

      <label>
        Amount:
        <input type="number" bind:value={amount} min="1" step="1" disabled={loading} />
      </label>

      <label class="checkbox-label eco-mode-label">
        <input
          type="checkbox"
          checked={settings.ecoMode === 'eco13'}
          onchange={(e) => {
            const newMode = (e.target as HTMLInputElement).checked ? 'eco13' : 'eco12';
            settings = { ...settings, ecoMode: newMode };
            // Clamp globalUpgrade to nearest valid level in new mode
            const newLevels = getUpgradeLevels(newMode);
            const validValues = newLevels.map(l => l.value);
            const closest = validValues.reduce((prev, cur) =>
              Math.abs(cur - globalUpgrade) < Math.abs(prev - globalUpgrade) ? cur : prev
            );
            globalUpgrade = closest;
          }}
        />
        Eco 13
      </label>

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label>
        Upgrade (global):
        <select bind:value={globalUpgrade} disabled={loading}>
          {#each upgradeLevels as lvl}
            <option value={lvl.value}>{lvl.label} ({lvl.value * 100}%)</option>
          {/each}
        </select>
      </label>

      <button onclick={handlePlan} disabled={loading || graphBuilding}>
        Plan!
      </button>

      <button onclick={openReport} disabled={loading || $flowNodes.length === 0}>
        Generate Report
      </button>

      <button onclick={() => showResolve = true} disabled={loading || $flowNodes.length === 0}>
        Resolve
      </button>

      <button onclick={() => replan(false)} disabled={loading || graphBuilding || $flowNodes.length === 0}
        title="Reset node positions and re-run auto-layout">
        Re-layout
      </button>

      <button onclick={() => showLayoutSettings = true} disabled={loading} title="ELK layout settings">
        Settings
      </button>

      <label class="checkbox-label">
        <input type="checkbox" bind:checked={groupByProfession} onchange={() => replan(false)} />
        Group by Profession
      </label>

      <button class="theme-toggle" onclick={() => darkMode = !darkMode} title="Toggle light/dark mode">
        {darkMode ? 'Light Mode' : 'Dark Mode'}
      </button>
    </div>
  </header>

  <main class="canvas-container">
    <div class="graph-area">
      {#if loading}
        <div class="status">Loading game data…</div>
      {:else if error}
        <div class="status error">Error: {error}</div>
      {:else}
        <SvelteFlow
          nodes={flowNodes}
          edges={flowEdges}
          {nodeTypes}
          {edgeTypes}
          minZoom={0.05}
        >
          <FitViewOnDemand {fitViewPending} onFitViewDone={() => { fitViewPending = false; }} />
          <Panel position="top-right">
            <select
              class="direction-select"
              value={layoutOptions.direction}
              onchange={e => { layoutOptions = { ...layoutOptions, direction: (e.target as HTMLSelectElement).value as LayoutOptions['direction'] }; replan(false); }}
            >
              <option value="RIGHT">→ Left to Right</option>
              <option value="DOWN">↓ Top to Bottom</option>
            </select>
          </Panel>
          <Controls />
          <Background />
          <MiniMap />
        </SvelteFlow>

        {#if $flowNodes.length === 0}
          <div class="status">Select a product and click Plan!</div>
        {/if}
      {/if}
    </div>

    {#if plannerTableNodes.length > 0}
      <TablePane
        tableNodes={plannerTableNodes}
        upgradeByTable={choices.upgradeByTable}
        {globalUpgrade}
        {upgradeLevels}
        onRecipeChange={handleRecipeChange}
        onUpgradeChange={handleUpgradeChange}
        onMarketSelect={handleMarketSelect}
      />
    {/if}
  </main>
</div>

{#if showReport}
  <div class="report-overlay" role="dialog" aria-modal="true">
    <div class="report-panel" class:wide={!!comparisonReport}>
      <div class="report-header">
        <h2>Production Report</h2>
        <button class="close-btn" onclick={closeReport}>✕</button>
      </div>
      <div class="report-body">
      <div class="compare-row">
        <span class="compare-label">Compare with:</span>
        <select
          onchange={e => {
            const v = (e.target as HTMLSelectElement).value;
            if (v === '') { compareUpgrade = null; return; }
            const [mode, val] = v.split(':');
            compareUpgrade = { value: Number(val), mode: mode as 'eco12' | 'eco13' };
          }}
        >
          <option value="">— none —</option>
          <optgroup label="Eco 13">
            {#each getUpgradeLevels('eco13') as lvl}
              <option value="eco13:{lvl.value}" selected={compareUpgrade?.mode === 'eco13' && compareUpgrade?.value === lvl.value}>{lvl.label}</option>
            {/each}
          </optgroup>
          <optgroup label="Eco 12">
            {#each getUpgradeLevels('eco12') as lvl}
              <option value="eco12:{lvl.value}" selected={compareUpgrade?.mode === 'eco12' && compareUpgrade?.value === lvl.value}>{lvl.label}</option>
            {/each}
          </optgroup>
        </select>
      </div>

      {#if edmReport}
        {@const cmpEdm = comparisonReport?.edmReport ?? null}
        {@const cmpLabel = compareUpgrade ? `${compareUpgrade.mode === 'eco13' ? 'Eco 13' : 'Eco 12'} ${getUpgradeLevels(compareUpgrade.mode).find(l => l.value === compareUpgrade!.value)?.label ?? ''}` : ''}
        <div class="edm-summary" class:compare={!!cmpEdm}>
          {#if cmpEdm}
            <span class="edm-row edm-compare-header">
              <span class="edm-label">per {selectedProduct}</span>
              <span class="edm-col-hdr">Current</span>
              <span class="edm-col-hdr">{cmpLabel}</span>
            </span>
            <span class="edm-row">
              <span class="edm-label">Base EDM:</span>
              <span class="edm-value">{edmReport.baseEdm != null ? fmtEdm(edmReport.baseEdm / amount) : '—'}</span>
              <span class="edm-value">{cmpEdm.baseEdm != null ? fmtEdm(cmpEdm.baseEdm / amount) : '—'}</span>
            </span>
            {#if edmReport.laborFoodEdm !== null || cmpEdm.laborFoodEdm !== null}
              <span class="edm-row">
                <span class="edm-label">Food EDM:</span>
                <span class="edm-value">{edmReport.laborFoodEdm !== null ? '+' + fmtEdm(edmReport.laborFoodEdm / amount) : '—'}</span>
                <span class="edm-value">{cmpEdm.laborFoodEdm !== null ? '+' + fmtEdm(cmpEdm.laborFoodEdm / amount) : '—'}</span>
              </span>
            {/if}
            {#if edmReport.crossProfTransitions.length > 0 || (cmpEdm.crossProfTransitions?.length ?? 0) > 0}
              <span class="edm-row">
                <span class="edm-label">Prof. markup:</span>
                <span class="edm-value">{edmReport.markupEdm != null ? '+' + fmtEdm(edmReport.markupEdm / amount) : '—'}</span>
                <span class="edm-value">{cmpEdm.markupEdm != null ? '+' + fmtEdm(cmpEdm.markupEdm / amount) : '—'}</span>
              </span>
            {/if}
            <span class="edm-row edm-total">
              <span class="edm-label">EDM / {selectedProduct}:</span>
              <span class="edm-value">{edmReport.totalEdm != null ? fmtEdm(edmReport.totalEdm / amount) : '—'}</span>
              <span class="edm-value">{cmpEdm.totalEdm != null ? fmtEdm(cmpEdm.totalEdm / amount) : '—'}</span>
            </span>
          {:else}
            <span class="edm-row edm-subheader"><span class="edm-label">per {selectedProduct}</span></span>
            <span class="edm-row"><span class="edm-label">Base EDM:</span> <span class="edm-value">{edmReport.baseEdm != null ? fmtEdm(edmReport.baseEdm / amount) : '— (missing values)'}</span></span>
            {#if edmReport.laborFoodEdm !== null}
              <span class="edm-row"><span class="edm-label">Food EDM:</span> <span class="edm-value">+{fmtEdm(edmReport.laborFoodEdm / amount)}</span></span>
            {/if}
            {#if edmReport.crossProfTransitions.length > 0}
              <span class="edm-row"><span class="edm-label">Profession markup:</span> <span class="edm-value">{edmReport.markupEdm != null ? '+' + fmtEdm(edmReport.markupEdm / amount) : '—'}</span></span>
            {/if}
            <span class="edm-row edm-total"><span class="edm-label">EDM / {selectedProduct}:</span> <span class="edm-value">{edmReport.totalEdm != null ? fmtEdm(edmReport.totalEdm / amount) : '— (missing values)'}</span></span>
          {/if}
        </div>
      {/if}

      <section>
        <h3>Raw Ingredients</h3>
        {#if plannerRawNodes.length === 0 && !comparisonReport}
          <p class="empty">None</p>
        {:else}
          {@const allRawItems = [...new Set([
            ...plannerRawNodes.map(n => n.itemName),
            ...(comparisonReport ? comparisonReport.rawByItem.keys() : [])
          ])].sort((a, b) => {
            const ca = plannerRawNodes.find(n => n.itemName === a)?.amount ?? 0;
            const cb = plannerRawNodes.find(n => n.itemName === b)?.amount ?? 0;
            return cb - ca;
          })}
          <table>
            {#if comparisonReport}
              <thead><tr>
                <th class="item-name"></th>
                <th class="item-amt col-hdr">Current</th>
                <th class="item-amt col-hdr">Compare</th>
                <th class="item-amt col-hdr">Δ%</th>
                <th class="item-amt col-hdr">EDM/u</th>
                <th class="item-amt col-hdr">EDM/{selectedProduct}</th>
              </tr></thead>
            {:else}
              <thead><tr>
                <th class="item-name"></th>
                <th class="item-amt col-hdr">Amount</th>
                <th class="item-amt col-hdr">EDM/u</th>
                <th class="item-amt col-hdr">EDM/{selectedProduct}</th>
              </tr></thead>
            {/if}
            <tbody>
              {#each allRawItems as itemName}
                {@const cur = plannerRawNodes.find(n => n.itemName === itemName)?.amount ?? 0}
                {@const rawCost = edmReport?.rawCosts.find(r => r.itemName === itemName)}
                {@const isMissing = rawCost ? rawCost.edmPerUnit === null : true}
                {#if comparisonReport}
                  {@const cmp = comparisonReport.rawByItem.get(itemName) ?? 0}
                  <tr>
                    <td class="item-name" class:edm-missing-name={isMissing}>{itemName}{#if isMissing} ⚠{/if}</td>
                    <td class="item-amt">{fmtNum(cur, true)}</td>
                    <td class="item-amt">{fmtNum(cmp, true)}</td>
                    <td class="item-amt" class:delta-neg={cmp < cur} class:delta-pos={cmp > cur}>{fmtDeltaPct(cur, cmp)}</td>
                    <td class="item-amt" class:edm-missing={isMissing}>{rawCost?.edmPerUnit != null ? fmtEdm(rawCost.edmPerUnit) : '—'}</td>
                    <td class="item-amt" class:edm-missing={isMissing}>{rawCost?.totalEdm != null ? fmtEdm(rawCost.totalEdm / amount) : '—'}</td>
                  </tr>
                {:else}
                  <tr>
                    <td class="item-name" class:edm-missing-name={isMissing}>{itemName}{#if isMissing} ⚠{/if}</td>
                    <td class="item-amt">{fmtNum(cur, true)}</td>
                    <td class="item-amt" class:edm-missing={isMissing}>{rawCost?.edmPerUnit != null ? fmtEdm(rawCost.edmPerUnit) : '—'}</td>
                    <td class="item-amt" class:edm-missing={isMissing}>{rawCost?.totalEdm != null ? fmtEdm(rawCost.totalEdm / amount) : '—'}</td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>

          {#if edmReport.crossProfTransitions.length > 0}
              <div class="cross-prof-list">
                <div class="cross-prof-header">Cross-profession transitions (+{(settings.crossProfessionMarkup * 100).toFixed(0)}% markup each):</div>
                {#each [...edmReport.crossProfTransitions].sort((a, b) => (b.markupAmount ?? -Infinity) - (a.markupAmount ?? -Infinity)) as t, i}
                  {@const isExpanded = expandedTransition === i}
                  <div
                    class="cross-prof-row"
                    class:cross-prof-expanded={isExpanded}
                    role="button"
                    tabindex="0"
                    onclick={() => { expandedTransition = isExpanded ? null : i; }}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expandedTransition = isExpanded ? null : i; } }}
                  >
                    <span class="cross-prof-chevron">{isExpanded ? '▾' : '▸'}</span>
                    <span class="cross-prof-profs">{t.fromProf} → {t.toProf}</span>
                    <span class="cross-prof-item muted">via {t.itemName}</span>
                    <span class="cross-prof-amt">{t.markupAmount != null ? '+' + fmtEdm(t.markupAmount / amount) : '—'} EDM</span>
                  </div>
                  {#if isExpanded}
                    <div class="cross-prof-detail">
                      <div class="cp-detail-title">Production chain for <strong>{t.itemName}</strong> ({t.fromProf})</div>
                      {#each t.pathEntries as entry}
                        <div class="cp-entry" style="padding-left: {entry.depth * 14 + 6}px">
                          {#if entry.kind === 'table'}
                            {@const perItem = entry.subtreeEdm != null && entry.outputAmount > 0 ? entry.subtreeEdm / entry.outputAmount : null}
                            {@const markupPerItem = (entry.markupApplied && perItem != null) ? perItem * settings.crossProfessionMarkup : null}
                            <span class="cp-entry-profession">[{entry.profession}]</span>
                            <span class="cp-entry-table">{entry.tableName}</span>
                            <span class="cp-entry-item muted">→ {entry.itemName}</span>
                            <span class="cp-entry-amount muted">{fmtNum(entry.neededAmount)} needed / {fmtNum(entry.outputAmount)} produced</span>
                            {#if entry.markupApplied}<span class="cp-entry-markup">+{(settings.crossProfessionMarkup * 100).toFixed(0)}%</span>{/if}
                            <span class="cp-entry-edm">{entry.subtreeEdm != null ? fmtEdm(entry.subtreeEdm / amount) : '—'} EDM</span>
                            <span class="cp-entry-per-item">{perItem != null ? fmtEdm(perItem) : '—'}/item{#if markupPerItem != null} <span class="cp-entry-markup-amt">+{fmtEdm(markupPerItem)}</span>{/if}</span>
                          {:else}
                            <span class="cp-entry-leaf-type muted">[{entry.nodeType}]</span>
                            <span class="cp-entry-item">{entry.itemName}</span>
                            <span class="cp-entry-amount muted">{fmtNum(entry.amount)} × {entry.edmPerUnit != null ? fmtEdm(entry.edmPerUnit) : '?'}</span>
                            <span class="cp-entry-edm">{entry.totalEdm != null ? fmtEdm(entry.totalEdm / amount) : '—'} EDM</span>
                          {/if}
                        </div>
                      {/each}
                      <div class="cp-detail-footer">
                        <span>Subtree base: {t.baseEdm != null ? fmtEdm(t.baseEdm / amount) : '—'} EDM</span>
                        <span class="cp-markup-highlight">Markup (+{(settings.crossProfessionMarkup * 100).toFixed(0)}%): {t.markupAmount != null ? '+' + fmtEdm(t.markupAmount / amount) : '—'} EDM</span>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
        {/if}
      </section>

      {#if plannerUnresolvedTagNodes.length > 0 || (comparisonReport?.tagByName.size ?? 0) > 0}
        {@const allTags = [...new Set([
          ...plannerUnresolvedTagNodes.map(n => n.tag),
          ...(comparisonReport ? comparisonReport.tagByName.keys() : [])
        ])].sort((a, b) => {
          const ca = plannerUnresolvedTagNodes.find(n => n.tag === a)?.amount ?? 0;
          const cb = plannerUnresolvedTagNodes.find(n => n.tag === b)?.amount ?? 0;
          return cb - ca;
        })}
        <section>
          <h3>Unresolved Tags</h3>
          <table>
            {#if comparisonReport}
              <thead><tr>
                <th class="item-name"></th>
                <th class="item-amt col-hdr">Current</th>
                <th class="item-amt col-hdr">Compare</th>
                <th class="item-amt col-hdr">Δ%</th>
              </tr></thead>
            {/if}
            <tbody>
              {#each allTags as tag}
                {@const cur = plannerUnresolvedTagNodes.find(n => n.tag === tag)?.amount ?? 0}
                {#if comparisonReport}
                  {@const cmp = comparisonReport.tagByName.get(tag) ?? 0}
                  <tr>
                    <td class="item-name">{tag}</td>
                    <td class="item-amt">{fmtNum(cur, true)}</td>
                    <td class="item-amt">{fmtNum(cmp, true)}</td>
                    <td class="item-amt" class:delta-neg={cmp < cur} class:delta-pos={cmp > cur}>{fmtDeltaPct(cur, cmp)}</td>
                  </tr>
                {:else}
                  <tr><td class="item-name">{tag}</td><td class="item-amt">{fmtNum(cur, true)}</td></tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </section>
      {/if}

      {#if plannerByproductNodes.length > 0 || (comparisonReport?.byproductByKey.size ?? 0) > 0}
        {@const allBpKeys = [...new Set([
          ...plannerByproductNodes.map(n => n.id),
          ...(comparisonReport ? comparisonReport.byproductByKey.keys() : [])
        ])]}
        {@const showBpCmp = comparisonReport !== null && allBpKeys.some(key => {
          const cur = plannerByproductNodes.find(n => n.id === key)?.amount ?? 0;
          const cmp = comparisonReport.byproductByKey.get(key) ?? 0;
          return Math.abs(cmp - cur) > 0.001;
        })}
        <section>
          <h3>Byproducts</h3>
          <table>
            {#if showBpCmp}
              <thead><tr>
                <th class="item-name"></th>
                <th class="item-name"></th>
                <th class="item-amt col-hdr">Current</th>
                <th class="item-amt col-hdr">Compare</th>
                <th class="item-amt col-hdr">Δ%</th>
              </tr></thead>
            {/if}
            <tbody>
              {#each (showBpCmp ? allBpKeys : plannerByproductNodes.map(n => n.id)).sort((a, b) => {
                const ca = plannerByproductNodes.find(n => n.id === a)?.amount ?? 0;
                const cb = plannerByproductNodes.find(n => n.id === b)?.amount ?? 0;
                return cb - ca;
              }) as key}
                {@const node = plannerByproductNodes.find(n => n.id === key)}
                {@const itemName = node?.itemName ?? key.split(':')[1]}
                {@const producer = key.split(':from:')[1]}
                {@const cur = node?.amount ?? 0}
                {#if showBpCmp}
                  {@const cmp = comparisonReport!.byproductByKey.get(key) ?? 0}
                  <tr>
                    <td class="item-name">{itemName}</td>
                    <td class="item-name muted">from {producer}</td>
                    <td class="item-amt">{fmtNum(cur, true)}</td>
                    <td class="item-amt">{fmtNum(cmp, true)}</td>
                    <td class="item-amt" class:delta-neg={cmp < cur} class:delta-pos={cmp > cur}>{fmtDeltaPct(cur, cmp)}</td>
                  </tr>
                {:else}
                  <tr>
                    <td class="item-name">{itemName}</td>
                    <td class="item-name muted">from {producer}</td>
                    <td class="item-amt">{fmtNum(cur, true)}</td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </section>
      {/if}

      <section>
        <h3>Market Purchases</h3>
        {#if plannerMarketNodes.length === 0}
          <p class="empty">None</p>
        {:else}
          <table>
            <tbody>
              {#each [...plannerMarketNodes].sort((a, b) => b.amount - a.amount) as n}
                <tr><td class="item-name">{n.itemName}</td><td class="item-amt">{fmtNum(n.amount, true)}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      {#if laborByProfession.length > 0}
        {@const allProfs = [...new Set([
          ...laborByProfession.map(([p]) => p),
          ...(comparisonReport ? comparisonReport.laborByProfession.map(([p]) => p) : [])
        ])].sort((a, b) => {
          const la = laborByProfession.find(([p]) => p === a)?.[1] ?? 0;
          const lb = laborByProfession.find(([p]) => p === b)?.[1] ?? 0;
          return lb - la;
        })}
        <section>
          <h3>Labor (by Profession)</h3>
          <table>
            {#if comparisonReport}
              <thead><tr>
                <th class="item-name"></th>
                <th class="item-amt col-hdr">Current</th>
                <th class="item-amt col-hdr">Compare</th>
                <th class="item-amt col-hdr">Δ%</th>
              </tr></thead>
            {/if}
            <tbody>
              {#each allProfs as prof}
                {@const cur = laborByProfession.find(([p]) => p === prof)?.[1] ?? 0}
                {#if comparisonReport}
                  {@const cmp = comparisonReport.laborByProfession.find(([p]) => p === prof)?.[1] ?? 0}
                  <tr>
                    <td class="item-name">{prof}</td>
                    <td class="item-amt">{fmtLabor(cur)}</td>
                    <td class="item-amt">{fmtLabor(cmp)}</td>
                    <td class="item-amt" class:delta-neg={cmp < cur} class:delta-pos={cmp > cur}>{fmtDeltaPct(cur, cmp)}</td>
                  </tr>
                {:else}
                  <tr><td class="item-name">{prof}</td><td class="item-amt">{fmtLabor(cur)}</td></tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </section>
      {/if}
      </div><!-- report-body -->
    </div>
  </div>
{/if}

{#if showResolve && recipeIndex && tagsIndex}
  <ResolveModal
    byproductNodes={plannerByproductNodes}
    unresolvedTagNodes={plannerUnresolvedTagNodes}
    {recipeIndex}
    {tagsIndex}
    inChainItems={new Set(plannerTableNodes.map(n => n.itemName))}
    onApply={handleResolveApply}
    onClose={() => showResolve = false}
  />
{/if}

{#if showLayoutSettings}
  <div class="report-overlay" role="dialog" aria-modal="true">
    <div class="report-panel layout-settings-panel">
      <div class="report-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={() => showLayoutSettings = false}>✕</button>
      </div>

      <section>
        <h3 class="settings-section-title">Layout</h3>
        <label class="settings-row">
          <span class="settings-label">Thoroughness</span>
          <select
            value={layoutOptions.thoroughness}
            onchange={e => { layoutOptions = { ...layoutOptions, thoroughness: Number((e.target as HTMLSelectElement).value) }; replan(false); }}
          >
            <option value={7}>7 – Default</option>
            <option value={15}>15 – Better</option>
            <option value={25}>25 – Best</option>
            <option value={50}>50 – Max</option>
          </select>
        </label>

        <label class="settings-row">
          <span class="settings-label">Node Placement</span>
          <select
            value={layoutOptions.nodePlacement}
            onchange={e => { layoutOptions = { ...layoutOptions, nodePlacement: (e.target as HTMLSelectElement).value as LayoutOptions['nodePlacement'] }; replan(false); }}
          >
            <option value="BRANDES_KOPP">BRANDES_KOPP – Default</option>
            <option value="LINEAR_SEGMENTS">LINEAR_SEGMENTS</option>
            <option value="NETWORK_SIMPLEX">NETWORK_SIMPLEX</option>
          </select>
        </label>
      </section>

      <section>
        <h3 class="settings-section-title">Tag Defaults</h3>
        {#each tagDefaults.entries() as [tag, item]}
          <label class="settings-row">
            <span class="settings-label">{tag}</span>
            {#if tagsIndex}
              <select
                value={item}
                onchange={e => {
                  const newItem = (e.target as HTMLSelectElement).value;
                  tagDefaults.set(tag, newItem);
                  choices.itemByTag.set(tag, newItem);
                  replan();
                }}
              >
                {#each tagsIndex.byTag.get(tag) ?? [] as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else}
              <span class="settings-value">{item}</span>
            {/if}
          </label>
        {/each}
      </section>

      <section>
        <h3 class="settings-section-title">EDM Values</h3>

        <label class="settings-row">
          <span class="settings-label">Cross-profession markup</span>
          <div class="edm-markup-row">
            <input
              type="number"
              class="edm-number-input"
              min="0"
              max="100"
              step="1"
              value={Math.round(settings.crossProfessionMarkup * 100)}
              oninput={e => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!isNaN(v)) settings = { ...settings, crossProfessionMarkup: v / 100 };
              }}
            />
            <span class="edm-unit">%</span>
          </div>
        </label>

        <label class="settings-row">
          <span class="settings-label">Include food cost</span>
          <input
            type="checkbox"
            checked={settings.foodCostEnabled}
            onchange={e => { settings = { ...settings, foodCostEnabled: (e.target as HTMLInputElement).checked }; replan(); }}
          />
        </label>

        <label class="settings-row">
          <span class="settings-label">Show node statistics</span>
          <input
            type="checkbox"
            checked={settings.showNodeStats}
            onchange={e => { settings = { ...settings, showNodeStats: (e.target as HTMLInputElement).checked }; replan(); }}
          />
        </label>

        {#if settings.foodCostEnabled}
          <div class="edm-food-tiers">
            <div class="edm-food-tier-header">EDM per 1k calories:</div>
            {#each [['baseline', 'Baseline'], ['basic', 'Basic'], ['advanced', 'Advanced'], ['modern', 'Modern']] as [tier, label]}
              <label class="settings-row edm-food-tier-row">
                <span class="settings-label edm-food-tier-label">{label}</span>
                <div class="edm-markup-row">
                  <input
                    type="number"
                    class="edm-number-input"
                    min="0"
                    step="0.1"
                    value={settings.foodTierCosts[tier as keyof typeof settings.foodTierCosts]}
                    oninput={e => {
                      const v = Number((e.target as HTMLInputElement).value);
                      if (!isNaN(v)) { settings = { ...settings, foodTierCosts: { ...settings.foodTierCosts, [tier]: v } }; replan(); }
                    }}
                  />
                  <span class="edm-unit">EDM</span>
                </div>
              </label>
            {/each}
          </div>
        {/if}

        {#if plannerRawNodes.length > 0 && tagsIndex}
          <div class="edm-resources-header">Raw resources (current plan):</div>
          {#each [...edmGrouped.entries()].sort(([a], [b]) => (a ?? '￿').localeCompare(b ?? '￿')) as [tag, nodes]}
            <div class="edm-tag-group">
              <div class="edm-tag-header">
                <span class="edm-tag-name">{tag ?? 'Ungrouped'}</span>
                {#if tag !== null}
                  <input
                    type="number"
                    class="edm-number-input"
                    min="0"
                    step="0.01"
                    value={settings.edmTagDefaults[tag] ?? ''}
                    placeholder="—"
                    oninput={e => {
                      const v = (e.target as HTMLInputElement).value;
                      const num = parseFloat(v);
                      const newDefaults = { ...settings.edmTagDefaults };
                      if (v === '' || isNaN(num)) {
                        delete newDefaults[tag];
                      } else {
                        newDefaults[tag] = num;
                      }
                      settings = { ...settings, edmTagDefaults: newDefaults };
                    }}
                  />
                  <span class="edm-tag-unit">tag default</span>
                {/if}
              </div>

              {#each [...nodes].sort((a, b) => a.itemName.localeCompare(b.itemName)) as node}
                {@const hasException = settings.edmValues[node.itemName] !== undefined}
                {@const effectiveVal = resolveItemEdmValue(node.itemName, settings, tagsIndex)}
                {@const isMissing = effectiveVal === null}
                <div class="settings-row edm-item-row" class:edm-missing-row={isMissing}>
                  <span class="settings-label edm-item-label" class:edm-missing-name={isMissing}>
                    {#if isMissing}⚠ {/if}{node.itemName}
                  </span>
                  <div class="edm-item-value">
                    {#if hasException}
                      <input
                        type="number"
                        class="edm-number-input"
                        min="0"
                        step="0.01"
                        value={settings.edmValues[node.itemName]}
                        oninput={e => {
                          const v = (e.target as HTMLInputElement).value;
                          const num = parseFloat(v);
                          const newEdm = { ...settings.edmValues };
                          if (v === '' || isNaN(num)) {
                            delete newEdm[node.itemName];
                          } else {
                            newEdm[node.itemName] = num;
                          }
                          settings = { ...settings, edmValues: newEdm };
                        }}
                      />
                      <button
                        class="edm-icon-btn"
                        title="Reset to tag default"
                        onclick={() => {
                          const newEdm = { ...settings.edmValues };
                          delete newEdm[node.itemName];
                          settings = { ...settings, edmValues: newEdm };
                        }}
                      >↩</button>
                    {:else}
                      <span class="edm-inherited-value">{effectiveVal !== null ? effectiveVal : '—'}</span>
                      <button
                        class="edm-icon-btn"
                        title="Override for this item"
                        onclick={() => {
                          settings = { ...settings, edmValues: { ...settings.edmValues, [node.itemName]: effectiveVal ?? 0 } };
                        }}
                      >✎</button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        {:else}
          <p class="empty">Generate a plan first to see raw resources.</p>
        {/if}

        <button
          class="export-edm-btn"
          onclick={() => {
            const snap = $state.snapshot(settings) as AppSettings;
            const json = JSON.stringify({ edmValues: snap.edmValues, edmTagDefaults: snap.edmTagDefaults }, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'edm-values.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export EDM as JSON
        </button>
      </section>
    </div>
  </div>
{/if}

<style>
  :global(html) { color-scheme: dark; }
  :global(html.light) { color-scheme: light; }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: #121212;
    color: #e0e0e0;
  }

  :global(html.light body) {
    background: #f0f4f8;
    color: #1a1a1a;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .toolbar {
    background: #1e1e1e;
    border-bottom: 1px solid #333;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-shrink: 0;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    color: #7ec8e3;
    white-space: nowrap;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #b0b0b0;
  }

  select, input[type="number"] {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
  }

  select {
    min-width: 180px;
    max-width: 280px;
  }

  input[type="number"] {
    width: 80px;
  }

  button {
    background: #1a6b3a;
    border: 1px solid #2a9b5a;
    color: #e0ffe0;
    border-radius: 4px;
    padding: 6px 18px;
    font-size: 13px;
    cursor: pointer;
    font-weight: bold;
  }

  button:hover:not(:disabled) {
    background: #1e8044;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .canvas-container {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }

  .graph-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: #888;
  }

  .status.error {
    color: #e06060;
  }

  .report-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }

  .report-panel {
    background: #1e1e1e; border: 1px solid #444; border-radius: 8px;
    min-width: 360px; width: min(860px, 90vw); max-height: 85vh;
    overflow-y: auto; color: #e0e0e0;
    display: flex; flex-direction: column;
  }

  .report-panel.wide { width: min(1100px, 92vw); }

  .report-body { padding: 16px 24px 24px; overflow-y: visible; }

  .compare-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 0 12px; font-size: 12px;
  }

  .compare-label { color: #888; white-space: nowrap; }

  .compare-row select {
    background: #2a2a2a; border: 1px solid #555; color: #e0e0e0;
    border-radius: 4px; padding: 2px 6px; font-size: 12px;
  }

  .col-hdr {
    font-size: 11px; color: #888; font-weight: normal; padding-bottom: 4px;
  }

  .delta-neg { color: #4ec870; }
  .delta-pos { color: #f08080; }

  .report-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 20px 24px 12px;
    position: sticky; top: 0; z-index: 2;
    background: #1e1e1e;
    border-bottom: 1px solid #2a2a2a;
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .report-header h2 {
    margin: 0; font-size: 16px; color: #7ec8e3;
  }

  .close-btn {
    background: none; border: none; color: #888; font-size: 18px; cursor: pointer; padding: 0;
  }

  .report-panel section {
    margin-bottom: 20px;
  }

  .report-panel h3 {
    font-size: 13px; color: #a0c4e0; margin: 0 0 8px;
    text-transform: uppercase; letter-spacing: 0.05em;
  }

  .report-panel table {
    width: 100%; border-collapse: collapse; font-size: 13px;
  }

  .item-name {
    padding: 3px 8px 3px 0;
  }

  .item-name.muted {
    color: #777; font-size: 11px;
  }

  .item-amt {
    text-align: right; color: #7ec8e3; font-variant-numeric: tabular-nums;
    font-family: 'Courier New', Courier, monospace;
  }

  .empty {
    color: #666; font-style: italic; font-size: 12px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #b0b0b0;
    cursor: pointer;
    margin-left: auto;
  }

  .theme-toggle {
    background: #2a2a2a;
    border: 1px solid #555;
    color: #b0b0b0;
  }

  /* ── Light mode overrides ─────────────────────────────────────── */

  /* App chrome */
  :global(html.light) .toolbar {
    background: #ffffff;
    border-bottom-color: #d0d0d0;
  }
  :global(html.light) h1 { color: #1a6b9a; }
  :global(html.light) label { color: #444; }
  :global(html.light) select,
  :global(html.light) input[type="number"] {
    background: #ffffff;
    border-color: #bbb;
    color: #1a1a1a;
  }
  :global(html.light) button {
    background: #1a6b3a;
    border-color: #2a9b5a;
    color: #e0ffe0;
  }
  :global(html.light) button:hover:not(:disabled) { background: #1e8044; }
  :global(html.light) .checkbox-label { color: #444; }
  :global(html.light) .theme-toggle {
    background: #e8e8e8;
    border-color: #bbb;
    color: #444;
  }
  :global(html.light) .theme-toggle:hover { background: #d8d8d8; }
  :global(html.light) .status { color: #555; }
  :global(html.light) .status.error { color: #c0392b; }

  /* SvelteFlow canvas */
  :global(html.dark .svelte-flow) { background: #141414; }
  :global(html.light .svelte-flow) { background: #f8fafc; }
  :global(html.light .svelte-flow__edge path),
  :global(html.light .svelte-flow__edge polyline) { stroke: #6b7280; }
  :global(html.light .svelte-flow__edge-label) { color: #1a1a1a; }
  :global(html.light .svelte-flow__controls button) {
    background: #ffffff; color: #333; border-color: #ccc;
  }
  :global(html.light .svelte-flow__controls button:hover) { background: #f0f0f0; }
  :global(html.light .svelte-flow__minimap) { background: #e8ecf0; }
  :global(html.light .svelte-flow__background pattern circle),
  :global(html.light .svelte-flow__background pattern rect) { fill: #c0c8d0; }

  /* TableNode */
  :global(html.light .table-node) {
    background: #dbeafe; border-color: #2563eb; color: #1e3a5f;
  }
  :global(html.light .table-node .header) {
    background: #bfdbfe; border-bottom-color: #2563eb; color: #1e3a5f;
  }
  :global(html.light .table-node .cycles) { color: #1d4ed8; }
  :global(html.light .table-node .picker-row label) { color: #374151; }
  :global(html.light .table-node select) {
    background: #eff6ff; border-color: #2563eb; color: #1e3a5f;
  }
  :global(html.light .table-node .returnables) { border-top-color: #2563eb; }
  :global(html.light .table-node .lb-name) { color: #374151; }
  :global(html.light .table-node .stats-section.first-bottom) { border-top-color: #2563eb; }
  :global(html.light .table-node .stats-cals) { color: #374151; }
  :global(html.light .table-node .food-edm) { color: #b45309; }
  :global(html.light .table-node .stats-label) { color: #1d4ed8; }
  :global(html.light .table-node .stats-values) { color: #1e3a5f; }

  /* RawNode */
  :global(html.light .raw-node) {
    background: #f0f0f0; border-color: #888; color: #222;
  }
  :global(html.light .raw-node .label) { color: #777; }
  :global(html.light .raw-node .amount) { color: #555; }

  /* ByproductNode */
  :global(html.light .byproduct-node) {
    background: #f3e8ff; border-color: #9333ea; color: #3b0764;
  }
  :global(html.light .byproduct-node .label) { color: #7c3aed; }
  :global(html.light .byproduct-node .amount) { color: #6d28d9; }
  :global(html.light .byproduct-node.excluded) {
    background: #fde8e8; border-color: #dc2626; color: #450a0a;
  }
  :global(html.light .byproduct-node.excluded .label) { color: #b91c1c; }
  :global(html.light .byproduct-node.excluded .amount) { color: #dc2626; }

  /* TagNode */
  :global(html.light .tag-node) {
    background: #fef3c7; border-color: #d97706; color: #451a03;
  }
  :global(html.light .tag-node .header) {
    background: #fde68a; border-bottom-color: #d97706; color: #92400e;
  }
  :global(html.light .tag-node .amount) { color: #92400e; }
  :global(html.light .tag-node .picker-row select) {
    background: #fffbeb; border-color: #d97706; color: #451a03;
  }

  /* MarketNode */
  :global(html.light .market-node) {
    background: #dcfce7; border-color: #16a34a; color: #052e16;
  }
  :global(html.light .market-node .header) {
    background: #bbf7d0; border-bottom-color: #16a34a; color: #166534;
  }
  :global(html.light .market-node .amount) { color: #166534; }
  :global(html.light .market-node select) {
    background: #f0fdf4; border-color: #16a34a; color: #052e16;
  }

  /* TablePane */
  :global(html.light) .canvas-container :global(aside.table-pane) {
    background: #ffffff; border-left-color: #d0d0d0;
  }
  :global(html.light .table-pane .pane-header) {
    background: #f0f0f0; border-bottom-color: #d0d0d0; color: #1a6b9a;
  }
  :global(html.light .table-pane .skill-group) { border-bottom-color: #e0e0e0; }
  :global(html.light .table-pane .skill-header) { background: #f8f8f8; color: #555; }
  :global(html.light .table-pane .table-entry) { border-bottom-color: #e8e8e8; }
  :global(html.light .table-pane .entry-item) { color: #666; }
  :global(html.light .table-pane .entry-table) { color: #1a3a5c; }
  :global(html.light .table-pane .entry-cycles) { color: #1d4ed8; }
  :global(html.light .table-pane .entry-row label) { color: #555; }
  :global(html.light .table-pane .entry-row select) {
    background: #f5f5f5; border-color: #bbb; color: #1a1a1a;
  }

  /* Report modal */
  :global(html.light) .report-panel {
    background: #ffffff; border-color: #d0d0d0; color: #1a1a1a;
  }
  :global(html.light) .report-header { background: #ffffff; border-bottom-color: #e0e0e0; }
  :global(html.light) .report-header h2 { color: #1a6b9a; }
  :global(html.light) .report-panel h3 { color: #374151; }
  :global(html.light) .item-amt { color: #1d4ed8; }
  :global(html.light) .close-btn { color: #555; }
  :global(html.light) .empty { color: #888; }

  .layout-settings-panel {
    min-width: 360px;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .layout-settings-panel > section {
    padding: 0 24px;
  }

  .layout-settings-panel > section:last-child {
    padding-bottom: 20px;
  }

  .settings-section-title {
    margin: 12px 0 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666;
  }

  :global(html.light) .settings-section-title { color: #999; }

  .settings-value {
    font-size: 13px;
    color: #888;
  }

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    font-size: 13px;
    color: #b0b0b0;
  }

  .settings-label {
    white-space: nowrap;
  }

  .layout-settings-panel select {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    min-width: 180px;
  }

  :global(html.light) .settings-row { color: #444; }
  :global(html.light) .layout-settings-panel select {
    background: #ffffff; border-color: #bbb; color: #1a1a1a;
  }

  /* EDM styles */
  .edm-summary {
    margin-top: 0;
    padding: 8px 10px;
    background: #252525;
    border-radius: 4px;
    display: grid;
    grid-template-columns: 1fr auto;
    row-gap: 3px;
    column-gap: 8px;
    font-size: 12px;
  }
  .edm-summary.compare { grid-template-columns: 1fr auto auto; }

  .edm-row { display: contents; }

  .edm-label { color: #888; }
  .edm-value { color: #7ec8e3; font-variant-numeric: tabular-nums; font-family: 'Courier New', Courier, monospace; text-align: right; }
  .edm-total .edm-label { color: #b0b0b0; font-weight: bold; }
  .edm-total .edm-value { color: #90e0b0; font-weight: bold; }
  .edm-subheader .edm-label { font-style: italic; font-size: 11px; }

  .edm-compare-header > * { border-bottom: 1px solid #333; padding-bottom: 3px; margin-bottom: 2px; }
  .edm-col-hdr { font-size: 10px; color: #666; text-align: right; }
  .edm-summary.compare .edm-row > :last-child { padding-left: 14px; }

  .edm-missing { color: #d4a017 !important; }
  .edm-missing-name { color: #d4a017; }

  .cross-prof-list {
    margin-top: 8px;
    font-size: 11px;
  }

  .cross-prof-header {
    color: #888;
    margin-bottom: 4px;
    font-style: italic;
  }

  .cross-prof-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 3px 4px;
    border-radius: 3px;
    cursor: pointer;
    user-select: none;
  }

  .cross-prof-row:hover { background: rgba(255,255,255,0.05); }
  .cross-prof-row.cross-prof-expanded { background: rgba(200,160,240,0.08); }

  .cross-prof-chevron { color: #888; font-size: 9px; width: 10px; flex-shrink: 0; }
  .cross-prof-profs { color: #c8a0f0; white-space: nowrap; }
  .cross-prof-item { color: #666; font-size: 10px; flex: 1; }
  .cross-prof-amt { color: #f0c070; white-space: nowrap; font-variant-numeric: tabular-nums; font-family: 'Courier New', Courier, monospace; }

  .cross-prof-detail {
    margin: 2px 0 6px 14px;
    padding: 8px 10px;
    border-left: 2px solid #5a3a7a;
    background: rgba(90,58,122,0.1);
    border-radius: 0 4px 4px 0;
    font-size: 10px;
  }

  .cp-detail-title {
    color: #aaa;
    margin-bottom: 6px;
    font-style: italic;
  }

  .cp-entry {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 1px 0;
  }

  .cp-entry-profession { color: #888; white-space: nowrap; }
  .cp-entry-table { color: #c8a0f0; white-space: nowrap; }
  .cp-entry-leaf-type { color: #666; white-space: nowrap; }
  .cp-entry-item { color: #e0e0e0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-entry-amount { color: #888; white-space: nowrap; font-variant-numeric: tabular-nums; font-family: 'Courier New', Courier, monospace; }
  .cp-entry-edm { color: #f0c070; white-space: nowrap; font-variant-numeric: tabular-nums; margin-left: auto; font-family: 'Courier New', Courier, monospace; }
  .cp-entry-markup { color: #f0a040; font-size: 9px; background: rgba(240,160,64,0.15); border: 1px solid rgba(240,160,64,0.4); border-radius: 2px; padding: 0 3px; white-space: nowrap; }
  .cp-entry-per-item { color: #888; font-size: 9px; white-space: nowrap; margin-left: auto; font-family: 'Courier New', Courier, monospace; }
  .cp-entry-markup-amt { color: #f0a040; }

  .cp-detail-footer {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid #3a2a4a;
    color: #888;
  }

  .cp-markup-highlight { color: #f0c070; }

  /* EDM Settings */
  .edm-resources-header {
    font-size: 11px;
    color: #666;
    margin: 8px 0 4px;
    font-style: italic;
  }

  .edm-number-input {
    width: 80px;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    text-align: right;
  }

  .edm-markup-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .edm-unit { color: #888; font-size: 12px; }

  .edm-missing-row { background: rgba(212, 160, 23, 0.07); border-radius: 3px; }

  .edm-tag-group {
    margin-bottom: 10px;
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    overflow: hidden;
  }

  .edm-tag-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    background: #1e2a1e;
    font-weight: 600;
    font-size: 12px;
  }

  .edm-tag-name {
    flex: 1;
    color: #8ec88e;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .edm-tag-unit {
    color: #555;
    font-size: 10px;
    font-weight: normal;
  }

  .edm-item-row {
    padding: 2px 8px 2px 20px;
    min-height: 28px;
    border-top: 1px solid #1e1e1e;
  }

  .edm-item-label { font-size: 12px; }

  .edm-item-value {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .edm-inherited-value {
    display: inline-block;
    width: 80px;
    text-align: right;
    color: #555;
    font-size: 12px;
    padding-right: 4px;
  }

  .edm-icon-btn {
    background: none;
    border: 1px solid #333;
    color: #888;
    font-size: 12px;
    padding: 1px 5px;
    cursor: pointer;
    border-radius: 3px;
    line-height: 1.4;
  }

  .edm-icon-btn:hover { border-color: #666; color: #ccc; background: #222; }

  .export-edm-btn {
    margin-top: 12px;
    width: 100%;
    background: #2a3a2a;
    border: 1px solid #4a7a4a;
    color: #90d090;
    font-size: 12px;
    padding: 6px 12px;
    font-weight: normal;
  }

  .export-edm-btn:hover:not(:disabled) { background: #334433; }

  .eco-mode-label { font-weight: bold; color: #7ec8e3 !important; }

  :global(html.light) .edm-summary { background: #f0f4f8; }
  :global(html.light) .edm-label { color: #666; }
  :global(html.light) .edm-value { color: #1a6b9a; }
  :global(html.light) .edm-total .edm-label { color: #333; }
  :global(html.light) .edm-total .edm-value { color: #1a7a3a; }
  :global(html.light) .cross-prof-row:hover { background: rgba(0,0,0,0.04); }
  :global(html.light) .cross-prof-row.cross-prof-expanded { background: rgba(124,58,237,0.06); }
  :global(html.light) .cross-prof-profs { color: #7c3aed; }
  :global(html.light) .cross-prof-amt { color: #b45309; }
  :global(html.light) .cross-prof-detail { border-left-color: #9f7aea; background: rgba(159,122,234,0.06); }
  :global(html.light) .cp-entry-table { color: #7c3aed; }
  :global(html.light) .cp-entry-item { color: #1a1a1a; }
  :global(html.light) .cp-entry-edm { color: #b45309; }
  :global(html.light) .cp-markup-highlight { color: #b45309; }
  :global(html.light) .cp-detail-footer { border-top-color: #ddd; }
  :global(html.light) .edm-number-input {
    background: #fff; border-color: #bbb; color: #1a1a1a;
  }
  :global(html.light) .edm-tag-group { border-color: #d0d8d0; }
  :global(html.light) .edm-tag-header { background: #e8f0e8; }
  :global(html.light) .edm-tag-name { color: #3a7a3a; }
  :global(html.light) .edm-item-row { border-top-color: #e8e8e8; }
  :global(html.light) .edm-inherited-value { color: #aaa; }
  :global(html.light) .edm-icon-btn { border-color: #ccc; color: #666; }
  :global(html.light) .edm-icon-btn:hover { border-color: #888; color: #333; background: #f0f0f0; }
  :global(html.light) .export-edm-btn {
    background: #e8f5e8; border-color: #4a9a4a; color: #1a5a1a;
  }
  :global(html.light) .eco-mode-label { color: #1a6b9a !important; }

  :global(.direction-select) {
    background: #1e1e1e;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }

  :global(html.light .direction-select) {
    background: #ffffff;
    border-color: #bbb;
    color: #1a1a1a;
  }
</style>
