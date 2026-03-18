<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { MarketPlannerNode, RecipeObject } from '../types.js';

  interface Props {
    data: MarketPlannerNode & {
      onRecipeChange?: (itemName: string, recipe: RecipeObject) => void;
    };
  }

  let { data }: Props = $props();

  function handleRecipeSelect(e: Event) {
    const select = e.target as HTMLSelectElement;
    if (select.value === '__market__') return;
    const recipe = data.availableRecipes.find(r => r.Key === select.value);
    if (recipe && data.onRecipeChange) {
      data.onRecipeChange(data.itemName, recipe);
    }
  }
</script>

<div class="market-node">
  <Handle type="source" position={Position.Right} />

  <div class="header">MARKET</div>

  <div class="body">
    <div class="name">{data.itemName}</div>
    <div class="amount">× {data.amount % 1 === 0 ? data.amount : data.amount.toFixed(2)}</div>

    {#if data.availableRecipes.length > 0}
      <div class="picker-row">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Switch to:
          <select value="__market__" onchange={handleRecipeSelect}>
            <option value="__market__">Market</option>
            {#each data.availableRecipes as r}
              <option value={r.Key}>{r.DefaultVariant}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
  </div>
</div>

<style>
  .market-node {
    background: #2a3d1a;
    border: 2px solid #6aab30;
    border-radius: 8px;
    color: #e8fde0;
    min-width: 160px;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .header {
    background: #1a2d0a;
    padding: 5px 10px;
    border-radius: 6px 6px 0 0;
    font-weight: bold;
    font-size: 11px;
    text-align: center;
    letter-spacing: 1px;
    border-bottom: 1px solid #6aab30;
    color: #8edb50;
  }

  .body {
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .name {
    font-weight: bold;
    font-size: 12px;
    text-align: center;
  }

  .amount {
    font-size: 15px;
    font-weight: bold;
    text-align: center;
    color: #8edb50;
  }

  .picker-row {
    display: flex;
    align-items: center;
    font-size: 11px;
  }

  .picker-row label {
    white-space: nowrap;
    color: #a0c490;
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }

  select {
    flex: 1;
    background: #1a2d0a;
    border: 1px solid #6aab30;
    color: #e8fde0;
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
  }
</style>
