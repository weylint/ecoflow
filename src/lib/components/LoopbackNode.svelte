<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { LoopbackPlannerNode } from '../types.js';

  interface Props {
    data: LoopbackPlannerNode;
  }

  let { data }: Props = $props();

  function fmt(n: number): string {
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  }
</script>

<div class="loopback-node">
  <Handle type="target" position={Position.Top} id="return-in" />
  <Handle type="source" position={Position.Top} id="cycle-out" />

  {#if data.netAmount > 0}
    <Handle type="target" position={Position.Left} id="supply-in" />
  {/if}

  <div class="header">LOOPBACK</div>

  <div class="body">
    <div class="item-name">{data.itemName}</div>
    <div class="amounts">
      <span class="gross">↓ {fmt(data.grossAmount)} in</span>
      <span class="return">↑ {fmt(data.returnAmount)} returned</span>
      <span class="net">net: {fmt(data.netAmount)}</span>
    </div>
  </div>
</div>

<style>
  .loopback-node {
    background: #1a3d3d;
    border: 2px solid #2a9090;
    border-radius: 8px;
    color: #c8f0f0;
    min-width: 160px;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .header {
    background: #0f2a2a;
    padding: 5px 10px;
    border-radius: 6px 6px 0 0;
    font-weight: bold;
    font-size: 11px;
    text-align: center;
    border-bottom: 1px solid #2a9090;
    color: #40c8c8;
    letter-spacing: 0.05em;
  }

  .body {
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .item-name {
    font-weight: bold;
    font-size: 13px;
    text-align: center;
    color: #80e0e0;
  }

  .amounts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
  }

  .gross  { color: #a0d0d0; }
  .return { color: #40c8a0; }
  .net    { color: #f0c870; font-weight: bold; }
</style>
