<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { TablePlannerNode, RecipeObject, Variant } from '../types.js';

  interface Props {
    data: TablePlannerNode & {
      onRecipeChange?: (itemName: string, recipe: RecipeObject) => void;
      onVariantChange?: (itemName: string, variant: Variant) => void;
      onMarketSelect?: (itemName: string) => void;
    };
  }

  let { data }: Props = $props();

  function handleRecipeSelect(e: Event) {
    const select = e.target as HTMLSelectElement;
    if (select.value === '__market__') {
      data.onMarketSelect?.(data.itemName);
      return;
    }
    const recipe = data.availableRecipes.find(r => r.Key === select.value);
    if (recipe && data.onRecipeChange) {
      data.onRecipeChange(data.itemName, recipe);
    }
  }

  function handleVariantSelect(e: Event) {
    const select = e.target as HTMLSelectElement;
    const variant = data.recipe.Variants.find(v => v.Name === select.value);
    if (variant && data.onVariantChange) {
      data.onVariantChange(data.itemName, variant);
    }
  }

  function formatTime(seconds: number): string {
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const mRem = m % 60;
    return mRem > 0 ? `${h}h ${mRem}m` : `${h}h`;
  }

  const totalSeconds = $derived(data.cycles * data.recipe.BaseCraftTime);
</script>

<div class="table-node">
  <Handle type="target" position={Position.Left} />

  <div class="header">{data.table}</div>

  <div class="body">
    <div class="cycles">×{data.cycles} runs · {formatTime(totalSeconds)}</div>

    <div class="picker-row">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label>Recipe:
        <select value={data.recipe.Key} onchange={handleRecipeSelect}>
          <option value="__market__">Market</option>
          {#each data.availableRecipes as r}
            <option value={r.Key}>{r.DefaultVariant}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if data.recipe.NumberOfVariants > 1}
      <div class="picker-row">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Variant:
          <select value={data.variant.Name} onchange={handleVariantSelect}>
            {#each data.recipe.Variants as v}
              <option value={v.Name}>{v.Name}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
  </div>

  <Handle type="source" position={Position.Right} />
</div>

<style>
  .table-node {
    background: #2d4a6e;
    border: 2px solid #4a7fb5;
    border-radius: 8px;
    color: #e8f4fd;
    min-width: 180px;
    font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .header {
    background: #1a3a5c;
    padding: 6px 10px;
    border-radius: 6px 6px 0 0;
    font-weight: bold;
    font-size: 12px;
    text-align: center;
    border-bottom: 1px solid #4a7fb5;
  }

  .body {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cycles {
    font-size: 13px;
    font-weight: bold;
    text-align: center;
    color: #7ec8e3;
  }

  .picker-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }

  .picker-row label {
    white-space: nowrap;
    color: #a0c4e0;
  }

  select {
    flex: 1;
    background: #1a3a5c;
    border: 1px solid #4a7fb5;
    color: #e8f4fd;
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
  }
</style>
