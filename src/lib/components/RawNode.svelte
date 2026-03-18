<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { RawPlannerNode } from '../types.js';

  interface Props {
    data: RawPlannerNode;
  }

  let { data }: Props = $props();
</script>

<div class="raw-node">
  <Handle type="source" position={Position.Right} />

  <div class="content">
    <div class="label">RAW</div>
    <div class="name">{data.itemName}</div>
    <div class="amount">× {data.amount % 1 === 0 ? data.amount : data.amount.toFixed(2)}</div>
  </div>
</div>

<style>
  .raw-node {
    background: #3a3a3a;
    border: 2px solid #666;
    border-radius: 8px;
    color: #d0d0d0;
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
    color: #888;
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
    color: #aaa;
    font-weight: bold;
  }
</style>
