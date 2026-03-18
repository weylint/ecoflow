<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { ItemPlannerNode } from '../types.js';

  interface Props {
    data: ItemPlannerNode;
  }

  let { data }: Props = $props();
</script>

<div class="item-node">
  <Handle type="target" position={Position.Left} />

  <div class="content">
    <div class="name">{data.itemName}</div>
    <div class="amount">× {data.amount % 1 === 0 ? data.amount : data.amount.toFixed(2)}</div>
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
  }
</style>
