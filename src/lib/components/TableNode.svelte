<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { TablePlannerNode, RecipeObject, Variant, AppliedTalent, ECO12_UPGRADE_LEVELS, ECO13_UPGRADE_LEVELS, IngredientStats, ProductStats } from '../types.js';
  import { ECO12_UPGRADE_LEVELS as ECO12 } from '../types.js';

  interface Props {
    data: TablePlannerNode & {
      onRecipeChange?: (itemName: string, recipe: RecipeObject) => void;
      onVariantChange?: (itemName: string, variant: Variant) => void;
      onMarketSelect?: (itemName: string) => void;
      onUpgradeChange?: (tableName: string, value: number) => void;
      currentUpgrade?: number;
      upgradeLevels?: typeof ECO12_UPGRADE_LEVELS | typeof ECO13_UPGRADE_LEVELS;
      foodCalories?: number;
      foodEdm?: number | null;
      ingredientStats?: IngredientStats[];
      productStats?: ProductStats[];
      showStats?: boolean;
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

  function handleUpgradeSelect(e: Event) {
    const select = e.target as HTMLSelectElement;
    data.onUpgradeChange?.(data.table, Number(select.value));
  }

  function formatTime(seconds: number): string {
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const mRem = m % 60;
    if (h < 24) return mRem > 0 ? `${h}h ${mRem}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const hRem = h % 24;
    return hRem > 0 ? `${d}d ${hRem}h` : `${d}d`;
  }

  const totalSeconds = $derived(data.cycles * data.recipe.BaseCraftTime * 60 * (1 - (data.currentUpgrade ?? 0)));

  function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
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

    {#if data.recipe.CraftingTableCanUseModules}
      <div class="picker-row">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>Upgrade:
          <select value={data.currentUpgrade ?? 0} onchange={handleUpgradeSelect}>
            {#each (data.upgradeLevels ?? ECO12) as lvl}
              <option value={lvl.value}>{lvl.label} ({lvl.value * 100}%)</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}

    {#if data.appliedTalents?.length}
      <div class="talents">
        {#each data.appliedTalents as talent}
          <span class="talent-chip">
            {talent.name} −{Math.round(talent.reduction * 100)}%
            <span class="talent-tooltip">{talent.description}</span>
          </span>
        {/each}
      </div>
    {/if}

    {#if data.loopbackItems?.length}
      <div class="returnables">
        {#each data.loopbackItems as lb}
          <div class="returnable-row">
            <span class="lb-name">{lb.itemName}</span>
            <span class="lb-gross">↓{fmt(lb.grossAmount)}</span>
            <span class="lb-return">↑{fmt(lb.returnAmount)}</span>
            <span class="lb-net">net {fmt(lb.netAmount)}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if data.showStats !== false && (data.foodCalories ?? 0) > 0}
      <div class="stats-section" class:first-bottom={!data.appliedTalents?.length && !data.loopbackItems?.length}>

        <div class="stats-cals">
          <span>{fmt(data.foodCalories! / data.cycles)}/run · {fmt(data.foodCalories!)} cal</span>
          {#if data.foodEdm != null}
            <span class="food-edm">+{data.foodEdm.toFixed(2)} EDM</span>
          {/if}
        </div>

        {#each (data.ingredientStats ?? []) as ing}
          <div class="stats-row">
            <span class="stats-label">IN: {ing.name}</span>
            <span class="stats-values">
              {#if ing.edmPerUnit != null}
                {fmt(ing.amount)} · {ing.edmPerUnit.toFixed(2)}/u · {ing.totalEdm!.toFixed(2)} EDM
              {:else}
                {fmt(ing.amount)}
              {/if}
            </span>
          </div>
        {/each}

        {#each (data.productStats ?? []) as prod}
          <div class="stats-row">
            <span class="stats-label">OUT: {prod.name}</span>
            <span class="stats-values">
              {#if prod.edmPerUnit != null}
                {fmt(prod.amount)} · {prod.edmPerUnit.toFixed(2)}/u · {prod.totalEdm!.toFixed(2)} EDM
              {:else}
                {fmt(prod.amount)}
              {/if}
            </span>
          </div>
        {/each}

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
    overflow: visible;
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

  .stats-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 10px;
  }

  .stats-section.first-bottom {
    margin-top: 2px;
    border-top: 1px solid #4a7fb5;
    padding-top: 4px;
  }

  .stats-cals {
    display: flex;
    justify-content: space-between;
    color: #a0c4e0;
  }

  .food-edm { color: #f0c070; }

  .stats-row {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }

  .stats-label { color: #7ea8c4; white-space: nowrap; }
  .stats-values { color: #c0daf0; text-align: right; font-variant-numeric: tabular-nums; }

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

  .returnables {
    margin-top: 4px;
    border-top: 1px solid #4a7fb5;
    padding-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .returnable-row {
    display: flex;
    gap: 4px;
    font-size: 10px;
    align-items: center;
  }

  .lb-name {
    flex: 1;
    color: #a0c4e0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lb-gross { color: #e07070; }
  .lb-return { color: #70e070; }
  .lb-net { color: #e0e070; }

  .talents {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 2px;
    border-top: 1px solid #4a7fb5;
    padding-top: 4px;
  }

  .talent-chip {
    position: relative;
    font-size: 10px;
    background: #1a3a5c;
    border: 1px solid #4a90c4;
    border-radius: 3px;
    padding: 1px 4px;
    color: #7ec8e3;
    cursor: default;
    white-space: nowrap;
  }

  .talent-tooltip {
    display: none;
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 1000;
    background: #0d1f33;
    border: 1px solid #4a90c4;
    border-radius: 4px;
    padding: 5px 7px;
    color: #e8f4fd;
    font-size: 11px;
    white-space: normal;
    width: 200px;
    line-height: 1.4;
    pointer-events: none;
  }

  .talent-chip:hover .talent-tooltip {
    display: block;
  }
</style>
