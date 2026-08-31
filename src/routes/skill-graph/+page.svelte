<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { base } from '$app/paths';
  import { SvelteFlow, Controls, Background, MiniMap } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { Node, Edge, NodeTypes, EdgeTypes } from '@xyflow/svelte';

  import SkillNode from '$lib/components/SkillNode.svelte';
  import LabeledEdge from '$lib/components/LabeledEdge.svelte';
  import FitViewOnDemand from '$lib/components/FitViewOnDemand.svelte';
  import { buildSkillFlowGraph, type SkillGraphJson } from '$lib/skillGraphBuilder.js';

  const nodeTypes = { skillNode: SkillNode } as unknown as NodeTypes;
  const edgeTypes = { labeledEdge: LabeledEdge } as unknown as EdgeTypes;

  // SvelteFlow v0.1.x requires writable stores, not $state arrays (see CLAUDE.md)
  const flowNodes = writable<Node[]>([]);
  const flowEdges = writable<Edge[]>([]);

  let rawGraph = $state<SkillGraphJson | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let direction = $state<'RIGHT' | 'DOWN'>('RIGHT');
  let focusSkill = $state('');
  let fileInput: HTMLInputElement | undefined = $state();
  let fitViewPending = $state(false);

  async function loadDefault() {
    try {
      const res = await fetch(`${base}/skill-graph.json`);
      if (res.ok) {
        rawGraph = await res.json();
      }
    } catch {
      // no default file present — user can load one manually
    } finally {
      loading = false;
    }
  }

  function loadFromFile(file: File) {
    loading = true;
    error = null;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        rawGraph = JSON.parse(reader.result as string);
      } catch {
        error = 'Not valid JSON';
        rawGraph = null;
      } finally {
        loading = false;
      }
    };
    reader.onerror = () => {
      error = 'Could not read file';
      loading = false;
    };
    reader.readAsText(file);
  }

  function onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) loadFromFile(file);
  }

  // Subgraph containing only the focused skill and its immediate neighbors
  // — mirrors eco-graph's `SkillGraph::focus` on the Rust side, but done
  // client-side so switching focus doesn't require regenerating the JSON.
  const displayedGraph = $derived.by((): SkillGraphJson | null => {
    if (!rawGraph) return null;
    const target = focusSkill.trim();
    if (!target) return rawGraph;
    const edges = rawGraph.edges.filter((e) => e.from === target || e.to === target);
    const skills = new Set<string>([target]);
    for (const e of edges) {
      skills.add(e.from);
      skills.add(e.to);
    }
    return { skills: [...skills].sort(), edges };
  });

  $effect(() => {
    const graph = displayedGraph;
    const dir = direction;
    if (!graph) {
      flowNodes.set([]);
      flowEdges.set([]);
      return;
    }
    buildSkillFlowGraph(graph, dir).then((flow) => {
      flowNodes.set(flow.nodes);
      flowEdges.set(flow.edges);
      fitViewPending = true;
    });
  });

  onMount(loadDefault);
</script>

<svelte:head>
  <title>Skill Dependency Graph</title>
</svelte:head>

<div class="page">
  <div class="toolbar">
    <a class="back-link" href="{base}/">← Planner</a>
    <h1>Skill Dependency Graph</h1>

    <label class="control">
      Load JSON
      <input
        bind:this={fileInput}
        type="file"
        accept="application/json"
        onchange={onFileChange}
      />
    </label>

    <label class="control">
      Focus
      <input
        list="skill-options"
        bind:value={focusSkill}
        placeholder="(whole graph)"
        disabled={!rawGraph}
      />
      {#if rawGraph}
        <datalist id="skill-options">
          {#each rawGraph.skills as skill}
            <option value={skill}></option>
          {/each}
        </datalist>
      {/if}
    </label>
    {#if focusSkill}
      <button onclick={() => (focusSkill = '')}>Clear focus</button>
    {/if}

    <label class="control">
      Direction
      <select bind:value={direction}>
        <option value="RIGHT">Left → Right</option>
        <option value="DOWN">Top → Bottom</option>
      </select>
    </label>

    {#if displayedGraph}
      <span class="stats">
        {displayedGraph.skills.length} skills, {displayedGraph.edges.length} edges
      </span>
    {/if}
  </div>

  <div class="canvas">
    {#if loading}
      <div class="placeholder">Loading…</div>
    {:else if error}
      <div class="placeholder error">{error}</div>
    {:else if !rawGraph}
      <div class="placeholder">
        No graph loaded. Generate one with:
        <pre>eco-graph graph --recipes recipes.json --json --out skill-graph.json</pre>
        then load it above, or drop it at <code>static/skill-graph.json</code> and reload.
      </div>
    {:else}
      <SvelteFlow nodes={flowNodes} edges={flowEdges} {nodeTypes} {edgeTypes} fitView>
        <Background />
        <Controls />
        <MiniMap />
        <FitViewOnDemand {fitViewPending} onFitViewDone={() => (fitViewPending = false)} />
      </SvelteFlow>
    {/if}
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #1a1a1a;
    color: #ddd;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 16px;
    background: #242424;
    border-bottom: 1px solid #3a3a3a;
    flex-wrap: wrap;
  }

  .back-link {
    color: #7ab0ff;
    text-decoration: none;
    font-size: 13px;
  }

  h1 {
    font-size: 16px;
    margin: 0;
    margin-right: 8px;
  }

  .control {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #aaa;
  }

  .control input,
  .control select {
    background: #333;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
  }

  button {
    background: #3d3d3d;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover {
    background: #4a4a4a;
  }

  .stats {
    margin-left: auto;
    font-size: 12px;
    color: #888;
  }

  .canvas {
    flex: 1;
    position: relative;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 100%;
    color: #888;
    font-size: 14px;
    text-align: center;
    padding: 2rem;
  }

  .placeholder.error {
    color: #e08080;
  }

  .placeholder pre {
    background: #111;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    color: #ccc;
  }
</style>
