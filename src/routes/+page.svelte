<script lang="ts">
  import { onMount } from 'svelte';
  import { dev } from '$app/environment';
  import { writable } from 'svelte/store';
  import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import type { Node, Edge } from '@xyflow/svelte';
  import { UPGRADE_LEVELS } from '$lib/types.js';
  import type { RecipeObject, Variant, TagsFile, RecipeFile, UserChoices, TablePlannerNode, RawPlannerNode, MarketPlannerNode, TagPlannerNode } from '$lib/types.js';
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
  let globalUpgrade = $state(0);

  let choices = $state<UserChoices>({
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(),
    marketItems: new Set(),
    upgradeByTable: new Map()
  });

  let plannerTableNodes = $state<TablePlannerNode[]>([]);
  let plannerRawNodes = $state<RawPlannerNode[]>([]);
  let plannerMarketNodes = $state<MarketPlannerNode[]>([]);
  let plannerUnresolvedTagNodes = $state<TagPlannerNode[]>([]);
  let showReport = $state(false);
  let darkMode = $state(true);
  let groupByProfession = $state(false);

  $effect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('light', !darkMode);
  });

  function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  // SvelteFlow v0.1.x requires writable stores, not $state arrays
  const flowNodes = writable<Node[]>([]);
  const flowEdges = writable<Edge[]>([]);
  let graphBuilding = $state(false);

  // ── Data loading ─────────────────────────────────────────────────
  const RECIPES_URL = dev
    ? './recipes.json'
    : 'https://white-tiger.play.eco/api/v1/plugins/EcoPriceCalculator/recipes';
  const TAGS_URL = dev
    ? './tags.json'
    : 'https://white-tiger.play.eco/api/v1/plugins/EcoPriceCalculator/tags';

  onMount(async () => {
    try {
      const [recipesRes, tagsRes] = await Promise.all([
        fetch(RECIPES_URL),
        fetch(TAGS_URL)
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

      // Auto-plan on load
      await replan();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      loading = false;
    }
  });

  // ── Planning ─────────────────────────────────────────────────────
  async function replan() {
    if (!recipeIndex || !tagsIndex) return;
    graphBuilding = true;

    try {
      const plannerGraph = buildGraph({
        targetItem: selectedProduct,
        totalAmount: amount,
        recipeIndex,
        tagsIndex,
        choices,
        globalUpgrade
      });

      plannerTableNodes = plannerGraph.nodes.filter((n): n is TablePlannerNode => n.type === 'table');
      plannerRawNodes = plannerGraph.nodes.filter((n): n is RawPlannerNode => n.type === 'raw');
      plannerMarketNodes = plannerGraph.nodes.filter((n): n is MarketPlannerNode => n.type === 'market');
      plannerUnresolvedTagNodes = plannerGraph.nodes.filter(
        (n): n is TagPlannerNode => n.type === 'tag' && n.amount > 0 && (n.selectedItem === null || n.byproductSupply !== undefined)
      );

      const { buildFlowGraph } = await import('$lib/graphBuilder.js');
      const flow = await buildFlowGraph(plannerGraph, groupByProfession);

      // Inject callbacks into node data here (avoids infinite $effect loops)
      flowNodes.set(flow.nodes.map(n => {
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
        return n;
      }));
      flowEdges.set(flow.edges);
    } finally {
      graphBuilding = false;
    }
  }

  function handlePlan() {
    // Reset user choices when explicitly replanning with a new product/amount
    choices = {
      recipeByItem: new Map(),
      variantByItem: new Map(),
      itemByTag: new Map(),
      marketItems: new Set(),
      upgradeByTable: new Map()
    };
    replan();
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
        {graphBuilding ? 'Planning…' : 'Plan!'}
      </button>

      <button onclick={() => showReport = true} disabled={loading || $flowNodes.length === 0}>
        Generate Report
      </button>

      <label class="checkbox-label">
        <input type="checkbox" bind:checked={groupByProfession} onchange={replan} />
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
      {:else if graphBuilding}
        <div class="status">Building graph…</div>
      {:else if $flowNodes.length === 0}
        <div class="status">Select a product and click Plan!</div>
      {:else}
        <SvelteFlow
          nodes={flowNodes}
          edges={flowEdges}
          {nodeTypes}
          fitView
          minZoom={0.05}
        >
          <Controls />
          <Background />
          <MiniMap />
        </SvelteFlow>
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
    <div class="report-panel">
      <div class="report-header">
        <h2>Production Report</h2>
        <button class="close-btn" onclick={() => showReport = false}>✕</button>
      </div>

      <section>
        <h3>Raw Ingredients</h3>
        {#if plannerRawNodes.length === 0}
          <p class="empty">None</p>
        {:else}
          <table>
            <tbody>
              {#each [...plannerRawNodes].sort((a, b) => b.amount - a.amount) as n}
                <tr><td class="item-name">{n.itemName}</td><td class="item-amt">{fmt(n.amount)}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>

      {#if plannerUnresolvedTagNodes.length > 0}
        <section>
          <h3>Unresolved Tags</h3>
          <table>
            <tbody>
              {#each [...plannerUnresolvedTagNodes].sort((a, b) => b.amount - a.amount) as n}
                <tr><td class="item-name">{n.tag}</td><td class="item-amt">{fmt(n.amount)}</td></tr>
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
</style>
