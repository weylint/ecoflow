<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { ProductPlannerNode } from '../types.js';
  import { fmtNum } from '../format.js';

  interface Props {
    data: ProductPlannerNode;
  }

  let { data }: Props = $props();

  const fmt = fmtNum;
  const matches = $derived(data.amount === data.producedAmount);
</script>

<div class="product-node">
  <Handle type="target" position={Position.Left} />

  <div class="content">
    <div class="label">PRODUCT</div>
    <div class="name">{data.itemName}</div>
    {#if matches}
      <div class="amount">× {fmt(data.amount)}</div>
    {:else}
      <div class="amounts">
        <div class="amount-row">
          <span class="amount-label">Requested:</span>
          <span class="amount-value">× {fmt(data.amount)}</span>
        </div>
        <div class="amount-row">
          <span class="amount-label">Produced:</span>
          <span class="amount-value">× {fmt(data.producedAmount)}</span>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .product-node {
    background: #2d4a3a;
    border: 2px solid #4caf50;
    border-radius: 8px;
    color: #d0ffd8;
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
    color: #70b070;
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
    color: #80d080;
    font-weight: bold;
    font-family: 'Courier New', Courier, monospace;
  }

  .amounts {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .amount-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }

  .amount-label {
    color: #90c090;
  }

  .amount-value {
    color: #80d080;
    font-weight: bold;
    font-family: 'Courier New', Courier, monospace;
  }
</style>
