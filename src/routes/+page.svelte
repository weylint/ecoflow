<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import type { Node, Edge } from '@xyflow/svelte';
  import type { RecipeObject, Variant, TagsFile, RecipeFile, UserChoices } from '$lib/types.js';
  import { buildRecipeIndex } from '$lib/recipeIndex.js';
  import { buildTagsIndex } from '$lib/tagsIndex.js';
  import { buildGraph } from '$lib/planner.js';
  import { buildFlowGraph } from '$lib/graphBuilder.js';

  import TableNode from '$lib/components/TableNode.svelte';
  import ItemNode from '$lib/components/ItemNode.svelte';
  import RawNode from '$lib/components/RawNode.svelte';
  import TagNode from '$lib/components/TagNode.svelte';

  // ── Custom node type registry ────────────────────────────────────
  const nodeTypes = {
    tableNode: TableNode,
    itemNode: ItemNode,
    rawNode: RawNode,
    tagNode: TagNode
  };

  // ── State ────────────────────────────────────────────────────────
  let recipeIndex = $state<ReturnType<typeof buildRecipeIndex> | null>(null);
  let tagsIndex = $state<ReturnType<typeof buildTagsIndex> | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let selectedProduct = $state('Steel Bar');
  let amount = $state(100);
  let skillReduction = $state(0);

  let choices = $state<UserChoices>({
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map()
  });

  // SvelteFlow v0.1.x requires writable stores, not $state arrays
  const flowNodes = writable<Node[]>([]);
  const flowEdges = writable<Edge[]>([]);
  let graphBuilding = $state(false);

  // ── Data loading ─────────────────────────────────────────────────
  onMount(async () => {
    try {
      const [recipesRes, tagsRes] = await Promise.all([
        fetch('./recipes.json'),
        fetch('./tags.json')
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
        skillReduction
      });

      const flow = await buildFlowGraph(plannerGraph);

      // Inject callbacks into node data here (avoids infinite $effect loops)
      flowNodes.set(flow.nodes.map(n => {
        if (n.type === 'tableNode') {
          return { ...n, data: { ...n.data, onRecipeChange: handleRecipeChange, onVariantChange: handleVariantChange } };
        }
        if (n.type === 'tagNode') {
          return { ...n, data: { ...n.data, onTagSelect: handleTagSelect } };
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
      itemByTag: new Map()
    };
    replan();
  }

  // ── Node event handlers ──────────────────────────────────────────
  function handleRecipeChange(itemName: string, recipe: RecipeObject) {
    choices.recipeByItem.set(itemName, recipe);
    choices = { ...choices, recipeByItem: new Map(choices.recipeByItem) };
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

      <fieldset class="skill-field">
        <legend>Skill reduction:</legend>
        <label>
          <input type="radio" bind:group={skillReduction} value={0} /> 0%
        </label>
        <label>
          <input type="radio" bind:group={skillReduction} value={0.5} /> 50%
        </label>
      </fieldset>

      <button onclick={handlePlan} disabled={loading || graphBuilding}>
        {graphBuilding ? 'Planning…' : 'Plan!'}
      </button>
    </div>
  </header>

  <main class="canvas-container">
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
      >
        <Controls />
        <Background />
        <MiniMap />
      </SvelteFlow>
    {/if}
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: #121212;
    color: #e0e0e0;
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

  .skill-field {
    border: 1px solid #444;
    border-radius: 4px;
    padding: 2px 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }

  .skill-field legend {
    font-size: 11px;
    color: #888;
    padding: 0 4px;
  }

  .skill-field label {
    font-size: 12px;
    color: #c0c0c0;
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
</style>
