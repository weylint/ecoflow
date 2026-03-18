<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { TagPlannerNode } from '../types.js';

  interface Props {
    data: TagPlannerNode & {
      onTagSelect?: (tag: string, item: string) => void;
    };
  }

  let { data }: Props = $props();

  function handleSelect(e: Event) {
    const select = e.target as HTMLSelectElement;
    if (select.value && data.onTagSelect) {
      data.onTagSelect(data.tag, select.value);
    }
  }
</script>

<div class="tag-node">
  <Handle type="source" position={Position.Right} />

  <div class="header">TAG: {data.tag}</div>

  <div class="body">
    <div class="amount">
      {#if data.amount === 0}
        ✓ from byproduct
      {:else}
        × {data.amount % 1 === 0 ? data.amount : data.amount.toFixed(2)}
      {/if}
    </div>
    {#if data.byproductSupply}
      <div class="supply">+{data.byproductSupply % 1 === 0 ? data.byproductSupply : data.byproductSupply.toFixed(2)} byproduct</div>
    {/if}

    <div class="picker-row">
      <select value={data.selectedItem ?? ''} onchange={handleSelect}>
        <option value="">— pick item —</option>
        {#each data.availableItems as item}
          <option value={item}>{item}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if data.selectedItem}
    <Handle type="target" position={Position.Left} />
  {/if}
</div>

<style>
  .tag-node {
    background: #5a3d1a;
    border: 2px solid #b07830;
    border-radius: 8px;
    color: #fdf0d8;
    min-width: 160px;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .header {
    background: #3d2a0f;
    padding: 5px 10px;
    border-radius: 6px 6px 0 0;
    font-weight: bold;
    font-size: 11px;
    text-align: center;
    border-bottom: 1px solid #b07830;
    color: #f0c070;
  }

  .body {
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .amount {
    font-size: 14px;
    font-weight: bold;
    text-align: center;
    color: #f0c070;
  }

  .supply {
    font-size: 11px;
    color: #4ec870;
    margin-top: 2px;
  }

  .picker-row select {
    width: 100%;
    background: #3d2a0f;
    border: 1px solid #b07830;
    color: #fdf0d8;
    border-radius: 4px;
    padding: 3px 4px;
    font-size: 11px;
  }
</style>
