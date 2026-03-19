<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { ByproductPlannerNode, ByproductResolveOption } from '../types.js';
  import { EXCLUDED_BYPRODUCTS } from '../types.js';

  interface Props {
    data: ByproductPlannerNode & {
      resolveOptions?: ByproductResolveOption[];
      onResolve?: (tag: string, item: string) => void;
    };
  }

  let { data }: Props = $props();

  const options = $derived(data.resolveOptions ?? []);
  const excluded = $derived(EXCLUDED_BYPRODUCTS.has(data.itemName));
  const fmt = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(2);
</script>

<div class="byproduct-node" class:has-options={options.length > 0} class:excluded>
  <Handle type="target" position={Position.Left} />

  <div class="content">
    <div class="label">BYPRODUCT</div>
    <div class="name">{data.itemName}</div>
    <div class="amount">× {fmt(data.amount)}</div>
  </div>

  {#if options.length > 0}
    <div class="options">
      {#each options as opt}
        <button
          class="opt-btn"
          onclick={() => data.onResolve?.(opt.tag, opt.outputItem)}
          title="Use for {opt.tag} (need {fmt(opt.tagAmount)})"
        >
          {#if opt.via}
            <span class="opt-output">→ {opt.outputItem}</span>
            <span class="opt-via">{opt.via.tableName}</span>
          {:else}
            <span class="opt-output">direct</span>
          {/if}
          <span class="opt-tag">{opt.tag}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .byproduct-node {
    background: #3a2d52;
    border: 2px solid #7a5faa;
    border-radius: 8px;
    color: #e8d8ff;
    min-width: 140px;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .content {
    padding: 8px 12px;
    text-align: center;
  }

  .label {
    font-size: 9px;
    letter-spacing: 1px;
    color: #9070c0;
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  .name {
    font-weight: bold;
    font-size: 12px;
    margin-bottom: 2px;
  }

  .amount {
    font-size: 14px;
    color: #b090e0;
    font-weight: bold;
  }

  .byproduct-node.excluded {
    background: #3d1010;
    border-color: #c04040;
    color: #ffd0d0;
  }

  .byproduct-node.excluded .label {
    color: #a05050;
  }

  .byproduct-node.excluded .amount {
    color: #e07070;
  }

  /* Options panel */
  .options {
    border-top: 1px solid #5a4080;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .opt-btn {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 6px;
    align-items: center;
    padding: 4px 7px;
    background: #2a1e40;
    border: 1px solid #5a4080;
    border-radius: 4px;
    color: #c8a8f8;
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }
  .opt-btn:hover {
    background: #3a2e58;
    border-color: #8060c0;
  }

  .opt-output {
    font-weight: 600;
    color: #e0d0ff;
    grid-column: 1;
    grid-row: 1;
    white-space: nowrap;
  }

  .opt-via {
    font-size: 10px;
    color: #7060a0;
    grid-column: 1;
    grid-row: 2;
    white-space: nowrap;
  }

  .opt-tag {
    font-size: 10px;
    color: #c09050;
    grid-column: 2;
    grid-row: 1 / 3;
    text-align: right;
    word-break: break-word;
  }
</style>
