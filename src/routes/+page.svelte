<script lang="ts">
  import { onMount } from 'svelte';
  import { dev } from '$app/environment';
  import { writable, get } from 'svelte/store';
  import { SvelteFlow, Controls, Background, MiniMap, Panel } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import type { Node, Edge } from '@xyflow/svelte';
  import { UPGRADE_LEVELS, EXCLUDED_BYPRODUCTS, DEFAULT_LAYOUT_OPTIONS, DEFAULT_TAG_CHOICES } from '$lib/types.js';
  import type { LayoutOptions } from '$lib/types.js';
  import type { RecipeObject, Variant, TagsFile, RecipeFile, UserChoices, TablePlannerNode, RawPlannerNode, MarketPlannerNode, TagPlannerNode, ByproductPlannerNode, ByproductResolveOption } from '$lib/types.js';
  import { buildRecipeIndex } from '$lib/recipeIndex.js';
  import { buildTagsIndex } from '$lib/tagsIndex.js';
  import { buildGraph } from '$lib/planner.js';

  import TableNode from '$lib/components/TableNode.svelte';
  import RawNode from '$lib/components/RawNode.svelte';
  import TagNode from '$lib/components/TagNode.svelte';
  import MarketNode from '$lib/components/MarketNode.svelte';
  import ByproductNode from '$lib/components/ByproductNode.svelte';
  import ProfessionGroupNode from '$lib/components/ProfessionGroupNode.svelte';
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
  };

  // ── State ────────────────────────────────────────────────────────
  let recipeIndex = $state<ReturnType<typeof buildRecipeIndex> | null>(null);
  let tagsIndex = $state<ReturnType<typeof buildTagsIndex> | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let selectedProduct = $state('Steel Bar');
  let amount = $state(100);
  let globalUpgrade = $state(0.50);

  let tagDefaults = $state(new Map<string, string>(Object.entries(DEFAULT_TAG_CHOICES)));

  let choices = $state<UserChoices>({
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(Object.entries(DEFAULT_TAG_CHOICES)),
    marketItems: new Set(),
    upgradeByTable: new Map()
  });

  let plannerTableNodes = $state<TablePlannerNode[]>([]);
  let plannerRawNodes = $state<RawPlannerNode[]>([]);
  let plannerMarketNodes = $state<MarketPlannerNode[]>([]);
  let plannerUnresolvedTagNodes = $state<TagPlannerNode[]>([]);
  let plannerByproductNodes = $state<ByproductPlannerNode[]>([]);
  const laborByProfession = $derived.by(() => {
    const map = new Map<string, number>();
    for (const n of plannerTableNodes) {
      const prof = n.recipe.SkillNeeds[0]?.Skill ?? 'No Skill Required';
      map.set(prof, (map.get(prof) ?? 0) + n.recipe.BaseLaborCost * n.cycles);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  let compareUpgrade = $state<number | null>(null);

  const comparisonReport = $derived.by(() => {
    if (compareUpgrade === null || !recipeIndex || !tagsIndex) return null;
    const snap = $state.snapshot(choices) as UserChoices;
    const pg = buildGraph({
      targetItem: selectedProduct,
      totalAmount: amount,
      recipeIndex,
      tagsIndex,
      choices: { ...snap, upgradeByTable: new Map() },
      globalUpgrade: compareUpgrade
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
      laborByProfession: [...laborMap.entries()].sort((a, b) => b[1] - a[1])
    };
  });

  let showReport = $state(false);
  let showResolve = $state(false);
  let showLayoutSettings = $state(false);
  let layoutOptions = $state<LayoutOptions>({ ...DEFAULT_LAYOUT_OPTIONS });
  let darkMode = $state(true);
  let groupByProfession = $state(false);

  $effect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('light', !darkMode);
  });

  function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function fmtLabor(n: number): string {
    const k = n / 1000;
    return (k % 1 === 0 ? String(k) : k.toFixed(1).replace('.', ',')) + 'k';
  }

  function fmtDeltaPct(cur: number, cmp: number): string {
    if (cur === 0 && cmp === 0) return '—';
    if (cur === 0) return 'new';
    const pct = Math.round((cmp - cur) / cur * 100);
    return (pct > 0 ? '+' : '') + pct + '%';
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
    try {
      const [recipesRes, tagsRes] = await Promise.all([
        fetchWithFallback(RECIPES_URL, './recipes.json'),
        fetchWithFallback(TAGS_URL, './tags.json')
      ]);

      if (!recipesRes.ok || !tagsRes.ok) throw new Error('Failed to load data files');

      const recipesData: RecipeFile = await recipesRes.json();
      const tagsData: TagsFile = await tagsRes.json();

      recipeIndex = buildRecipeIndex(recipesData.Recipes);
      tagsIndex = buildTagsIndex(tagsData.Tags);

      // Set default selection after options are available
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
        globalUpgrade
      });

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
      flowNodes.set(layoutNodes.map(n => {
        if (n.type === 'tableNode') {
          const tNode = n.data as TablePlannerNode;
          return {
            ...n,
            data: {
              ...n.data,
              onRecipeChange: handleRecipeChange,
              onVariantChange: handleVariantChange,
              onMarketSelect: handleMarketSelect,
              onUpgradeChange: handleUpgradeChange,
              currentUpgrade: choices.upgradeByTable.get(tNode.table) ?? globalUpgrade
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
          const bpNode = n.data as ByproductPlannerNode;
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
    choices = {
      recipeByItem: new Map(),
      variantByItem: new Map(),
      itemByTag: new Map(tagDefaults),  // restore configurable defaults
      marketItems: new Set(),
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

      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label>
        Upgrade (global):
        <select bind:value={globalUpgrade} disabled={loading}>
          {#each UPGRADE_LEVELS as lvl}
            <option value={lvl.value}>{lvl.label} ({lvl.value * 100}%)</option>
          {/each}
        </select>
      </label>

      <button onclick={handlePlan} disabled={loading || graphBuilding}>
        Plan!
      </button>

      <button onclick={() => showReport = true} disabled={loading || $flowNodes.length === 0}>
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
        <button class="close-btn" onclick={() => { showReport = false; compareUpgrade = null; }}>✕</button>
      </div>
      <div class="compare-row">
        <span class="compare-label">Compare with:</span>
        <select
          onchange={e => {
            const v = (e.target as HTMLSelectElement).value;
            compareUpgrade = v === '' ? null : Number(v);
          }}
        >
          <option value="">— none —</option>
          {#each UPGRADE_LEVELS as lvl}
            <option value={lvl.value} selected={lvl.value === compareUpgrade}>{lvl.label}</option>
          {/each}
        </select>
      </div>

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
              </tr></thead>
            {/if}
            <tbody>
              {#each allRawItems as itemName}
                {@const cur = plannerRawNodes.find(n => n.itemName === itemName)?.amount ?? 0}
                {#if comparisonReport}
                  {@const cmp = comparisonReport.rawByItem.get(itemName) ?? 0}
                  <tr>
                    <td class="item-name">{itemName}</td>
                    <td class="item-amt">{fmt(cur)}</td>
                    <td class="item-amt">{fmt(cmp)}</td>
                    <td class="item-amt" class:delta-neg={cmp < cur} class:delta-pos={cmp > cur}>{fmtDeltaPct(cur, cmp)}</td>
                  </tr>
                {:else}
                  <tr><td class="item-name">{itemName}</td><td class="item-amt">{fmt(cur)}</td></tr>
                {/if}
              {/each}
            </tbody>
          </table>
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
                    <td class="item-amt">{fmt(cur)}</td>
                    <td class="item-amt">{fmt(cmp)}</td>
                    <td class="item-amt" class:delta-neg={cmp < cur} class:delta-pos={cmp > cur}>{fmtDeltaPct(cur, cmp)}</td>
                  </tr>
                {:else}
                  <tr><td class="item-name">{tag}</td><td class="item-amt">{fmt(cur)}</td></tr>
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
                    <td class="item-amt">{fmt(cur)}</td>
                    <td class="item-amt">{fmt(cmp)}</td>
                    <td class="item-amt" class:delta-neg={cmp < cur} class:delta-pos={cmp > cur}>{fmtDeltaPct(cur, cmp)}</td>
                  </tr>
                {:else}
                  <tr>
                    <td class="item-name">{itemName}</td>
                    <td class="item-name muted">from {producer}</td>
                    <td class="item-amt">{fmt(cur)}</td>
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
                <tr><td class="item-name">{n.itemName}</td><td class="item-amt">{fmt(n.amount)}</td></tr>
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
    padding: 24px; min-width: 360px; max-width: 520px; max-height: 80vh;
    overflow-y: auto; color: #e0e0e0;
  }

  .report-panel.wide { max-width: 700px; }

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
    display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
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
  :global(html.light) .report-header h2 { color: #1a6b9a; }
  :global(html.light) .report-panel h3 { color: #374151; }
  :global(html.light) .item-amt { color: #1d4ed8; }
  :global(html.light) .close-btn { color: #555; }
  :global(html.light) .empty { color: #888; }

  .layout-settings-panel {
    min-width: 320px;
    max-width: 420px;
    max-height: 80vh;
    overflow-y: auto;
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
