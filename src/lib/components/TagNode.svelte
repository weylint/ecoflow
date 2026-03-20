<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { TagPlannerNode } from '../types.js';

  interface Props {
    data: TagPlannerNode & {
      onTagSelect?: (tag: string, item: string) => void;
    };
  }

  let { data }: Props = $props();

  const fmt = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(2);

  function handleSelect(e: Event) {
    const select = e.target as HTMLSelectElement;
    if (select.value && data.onTagSelect) {
      data.onTagSelect(data.tag, select.value);
    }
  }
</script>

<div class="tag-node" class:resolved={!!data.selectedItem}>
  <Handle type="source" position={Position.Right} />

  <div class="header">TAG: {data.tag}</div>

  <div class="body">
    <div class="amount">
      {#if data.amount === 0 && data.byproductContributors?.length}
        ✓ from byproduct
      {:else}
        × {fmt(data.amount)}
      {/if}
    </div>
    {#if data.byproductContributors}
      {#each data.byproductContributors as c}
        <div class="supply">+{fmt(c.contribution)} {c.itemName}</div>
      {/each}
    {/if}

    <div class="picker-row">
      <select onchange={handleSelect}>
        <option value="" selected={!data.selectedItem}>— pick item —</option>
        {#each data.availableItems as item}
          <option value={item} selected={item === data.selectedItem}>
            {item}{data.craftableItems?.includes(item) ? ' ⚙' : ''}
          </option>
        {/each}
      </select>
    </div>
  </div>

  {#if data.selectedItem || data.byproductContributors?.length}
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

  .tag-node.resolved {
    background: #2e1e0a;
    border-color: #7a5220;
  }

  .tag-node.resolved .header {
    background: #1e1208;
    border-bottom-color: #7a5220;
    color: #c09050;
  }

  .tag-node.resolved .amount {
    color: #c09050;
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
