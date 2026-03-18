<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { ByproductPlannerNode } from '../types.js';

  interface Props {
    data: ByproductPlannerNode;
  }

  let { data }: Props = $props();
</script>

<div class="byproduct-node">
  <Handle type="target" position={Position.Left} />

  <div class="content">
    <div class="label">BYPRODUCT</div>
    <div class="name">{data.itemName}</div>
    <div class="amount">× {data.amount % 1 === 0 ? data.amount : data.amount.toFixed(2)}</div>
  </div>
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
</style>
