<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { ItemPlannerNode } from '../types.js';
  import { fmtNum } from '../format.js';

  interface Props {
    data: ItemPlannerNode;
  }

  let { data }: Props = $props();
</script>

<div class="item-node">
  <Handle type="target" position={Position.Left} />

  <div class="content">
    <div class="name">{data.itemName}</div>
    <div class="amount">
      {#if data.amount === 0}
        ✓ from byproduct
      {:else}
        × {fmtNum(data.amount)}
      {/if}
    </div>
    {#if data.byproductSupply}
      <div class="supply">+{fmtNum(data.byproductSupply)} byproduct</div>
    {/if}
  </div>

  <Handle type="source" position={Position.Right} />
</div>

<style>
  .item-node {
    background: #2d5a3d;
    border: 2px solid #4a9060;
    border-radius: 8px;
    color: #e8fdf0;
    min-width: 150px;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .content {
    padding: 8px 12px;
    text-align: center;
  }

  .name {
    font-weight: bold;
    font-size: 13px;
    margin-bottom: 2px;
  }

  .amount {
    font-size: 15px;
    color: #7ee3a0;
    font-weight: bold;
    font-family: 'Courier New', Courier, monospace;
  }

  .supply {
    font-size: 11px;
    color: #4ec870;
    margin-top: 2px;
  }
</style>
