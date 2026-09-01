<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { TablePlannerNode, RecipeObject, Variant, AppliedTalent, ECO12_UPGRADE_LEVELS, ECO13_UPGRADE_LEVELS, IngredientStats, ProductStats, ModuleSlot } from '../types.js';
  import { ECO12_UPGRADE_LEVELS as ECO12, EDM_MARKUP_EXCLUDED_RECIPES } from '../types.js';
  import { fmtNum, fmtEdm } from '../format.js';

  interface Props {
    data: TablePlannerNode & {
      onRecipeChange?: (itemName: string, recipe: RecipeObject) => void;
      onVariantChange?: (itemName: string, variant: Variant) => void;
      onMarketSelect?: (itemName: string) => void;
      onUpgradeChange?: (tableName: string, value: number) => void;
      currentUpgrade?: number;
      upgradeLevels?: typeof ECO12_UPGRADE_LEVELS | typeof ECO13_UPGRADE_LEVELS;
      // Eco 14: per-table module slots, replacing the upgrade ladder.
      onModuleSlotsChange?: (tableName: string, slots: ModuleSlot[]) => void;
      availableSlots?: ModuleSlot[];
      currentSlots?: ModuleSlot[];
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

  function toggleSlot(slot: ModuleSlot, on: boolean) {
    const next = new Set(data.currentSlots ?? []);
    if (on) next.add(slot); else next.delete(slot);
    data.onModuleSlotsChange?.(data.table, (data.availableSlots ?? []).filter(s => next.has(s)));
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

  // A <select> flattens to all of its options in a text extraction, marking none,
  // so the chosen recipe was invisible to anything reading the page as text.
  // These render the answer as plain text beside the picker.
  const recipeChoiceText = $derived(
    `${data.recipe.DefaultVariant}${data.availableRecipes.length > 1
      ? ` (${data.availableRecipes.length - 1} alternative${data.availableRecipes.length === 2 ? '' : 's'})`
      : ''}`
  );

  // Module state used to be recoverable only by set-differencing the checkbox
  // labels against the applied-modifier chips. One line states it instead.
  const moduleSummary = $derived.by(() => {
    const applied = data.appliedModules ?? [];
    const available = data.availableSlots ?? [];
    if (available.length === 0 && applied.length === 0) return null;
    const on = applied.map(m => `${m.slot} −${Math.round(m.reduction * 100)}%`);
    const off = available.filter(s => !applied.some(m => m.slot === s));
    if (on.length === 0) return `Modules applied: none (${off.join(', ')} off)`;
    return `Modules applied: ${on.join(', ')}${off.length > 0 ? ` (${off.join(', ')} off)` : ''}`;
  });

  const nodeLabel = $derived(
    `Crafting table ${data.table}, producing ${data.itemName}, ×${data.cycles} runs, recipe ${data.recipe.DefaultVariant}`
  );


</script>

<div class="table-node" role="group" aria-label={nodeLabel}>
  <Handle type="target" position={Position.Left} />

  <div class="header">{data.table}</div>

  <div class="body">
    <div class="cycles" data-value={data.cycles}>×{data.cycles} runs · {formatTime(totalSeconds)}</div>

    <div class="picker-row">
      <span class="picker-label">Recipe:</span>
      <select
        value={data.recipe.Key}
        onchange={handleRecipeSelect}
        aria-label="Recipe for {data.itemName} at {data.table}, currently {data.recipe.DefaultVariant}"
      >
        <option value="__market__">Market</option>
        {#each data.availableRecipes as r}
          <option value={r.Key}>{r.DefaultVariant}</option>
        {/each}
      </select>
    </div>
    <div class="sr-only">Recipe: {recipeChoiceText}</div>

    {#if data.recipe.NumberOfVariants > 1}
      <div class="picker-row">
        <span class="picker-label">Variant:</span>
        <select
          value={data.variant.Name}
          onchange={handleVariantSelect}
          aria-label="Variant for {data.itemName}, currently {data.variant.Name}"
        >
          {#each data.recipe.Variants as v}
            <option value={v.Name}>{v.Name}</option>
          {/each}
        </select>
      </div>
      <div class="sr-only">Variant: {data.variant.Name}</div>
    {/if}

    {#if data.recipe.CraftingTableCanUseModules}
      {#if data.availableSlots}
        <!-- Eco 14: only the slots this table's allow-list can actually fill. -->
        <div class="picker-row slot-row">
          <span class="slot-row-label">Modules:</span>
          {#each data.availableSlots as slot}
            <label class="slot-toggle">
              <input
                type="checkbox"
                checked={(data.currentSlots ?? []).includes(slot)}
                onchange={(e) => toggleSlot(slot, (e.target as HTMLInputElement).checked)}
                aria-label="{slot} module slot on {data.table}"
              />
              {slot}
            </label>
          {/each}
        </div>
      {:else}
        <div class="picker-row">
          <span class="picker-label">Upgrade:</span>
          <select
            value={data.currentUpgrade ?? 0}
            onchange={handleUpgradeSelect}
            aria-label="Upgrade level for {data.table}, currently {Math.round((data.currentUpgrade ?? 0) * 100)}%"
          >
            {#each (data.upgradeLevels ?? ECO12) as lvl}
              <option value={lvl.value}>{lvl.label} ({lvl.value * 100}%)</option>
            {/each}
          </select>
        </div>
      {/if}
    {/if}

    <!-- Eco 14: name the modules the reduction assumed. A specialty module only
         covers its own skill, so the same table reduces different recipes by
         different amounts — showing the modules makes that visible. -->
    {#if data.appliedModules?.length || moduleSummary}
      <div class="modules">
        {#each data.appliedModules ?? [] as mod}
          <span class="module-chip">
            {mod.slot} −{Math.round(mod.reduction * 100)}%
            <span class="talent-tooltip">{mod.module}</span>
          </span>
        {/each}
      </div>
      {#if moduleSummary}
        <div class="sr-only">{moduleSummary}</div>
      {/if}
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
            <span class="lb-gross" data-value={lb.grossAmount}>↓{fmtNum(lb.grossAmount)}</span>
            <span class="lb-return" data-value={lb.returnAmount}>↑{fmtNum(lb.returnAmount)}</span>
            <span class="lb-net" data-value={lb.netAmount}>net {fmtNum(lb.netAmount)}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if data.inlinedProductions?.length}
      <div class="inlined-prods">
        {#each data.inlinedProductions as ip}
          <div class="inlined-header">⊕ {ip.producerTable} ×{ip.cycles}</div>
          {#each ip.netIngredients as ni}
            {#if ni.amount > 0}
              <div class="inlined-row">
                <span class="il-label">{ni.name}</span>
                <span class="il-net" data-value={ni.amount}>net {fmtNum(ni.amount)}</span>
              </div>
            {/if}
          {/each}
        {/each}
      </div>
    {/if}

    {#if data.showStats !== false && ((data.ingredientStats?.length ?? 0) > 0 || (data.productStats?.length ?? 0) > 0)}
      <div class="stats-section" class:first-bottom={!data.appliedModules?.length && !data.appliedTalents?.length && !data.loopbackItems?.length}>

        {#each (data.ingredientStats ?? []) as ing}
          {#if ing.name === 'Food'}
            {@const isWP = EDM_MARKUP_EXCLUDED_RECIPES.has(data.recipe.Key)}
            <span class="stats-food-cals" data-value={ing.amount}>{fmtNum(ing.amount)} {isWP ? 'Labour' : 'cal'} · {fmtNum(ing.amount / data.cycles)}/run</span>
            {#if ing.edmPerUnit != null}
              <span class="stats-label">{isWP ? 'IN: Work Party' : 'IN: Food'}</span>
              <span class="stats-num" data-value={ing.amount}>{fmtNum(ing.amount, true)}</span>
              <span class="stats-rate" data-value={ing.edmPerUnit}>{fmtEdm(ing.edmPerUnit)}/u</span>
              <span class="stats-total" data-value={ing.totalEdm}>{fmtEdm(ing.totalEdm!)} EDM</span>
            {/if}
          {:else}
            <span class="stats-label">IN: {ing.name}</span>
            <span class="stats-num" data-value={ing.amount}>{fmtNum(ing.amount, true)}</span>
            {#if ing.edmPerUnit != null}
              <span class="stats-rate" data-value={ing.edmPerUnit}>{fmtEdm(ing.edmPerUnit)}/u</span>
              <span class="stats-total" data-value={ing.totalEdm}>{fmtEdm(ing.totalEdm!)} EDM</span>
            {:else}
              <span></span><span></span>
            {/if}
          {/if}
        {/each}

        {#each (data.productStats ?? []) as prod}
          <span class="stats-label">OUT: {prod.name}</span>
          <span class="stats-num" data-value={prod.amount}>{fmtNum(prod.amount, true)}</span>
          {#if prod.edmPerUnit != null}
            <span class="stats-rate" data-value={prod.edmPerUnit}>{fmtEdm(prod.edmPerUnit)}/u</span>
            <span class="stats-total" data-value={prod.totalEdm}>{fmtEdm(prod.totalEdm!)} EDM</span>
          {:else}
            <span></span><span></span>
          {/if}
        {/each}

        {#if data.valueAdded != null && data.valueAdded > 0}
          {@const primaryAmt = data.productStats?.find(p => p.name === data.itemName)?.amount ?? 0}
          {@const vaPerUnit = primaryAmt > 0 ? data.valueAdded / primaryAmt : null}
          <span class="stats-va" data-value={data.valueAdded}>VA: +{fmtEdm(data.valueAdded)} EDM{#if vaPerUnit != null} · +{fmtEdm(vaPerUnit)}/u{/if}</span>
        {/if}

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
    font-family: Consolas, 'Courier New', Courier, monospace;
  }

  .stats-section {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    column-gap: 5px;
    row-gap: 1px;
    font-size: 9px;
  }

  .stats-section.first-bottom {
    margin-top: 2px;
    border-top: 1px solid #4a7fb5;
    padding-top: 4px;
  }

  .stats-food-cals {
    grid-column: 1 / -1;
    color: #7ea8c4;
    font-family: Consolas, 'Courier New', Courier, monospace;
    font-variant-numeric: tabular-nums;
  }

  .stats-va {
    grid-column: 1 / -1;
    color: #90e0b0;
    font-family: Consolas, 'Courier New', Courier, monospace;
    font-variant-numeric: tabular-nums;
    margin-top: 2px;
    border-top: 1px solid #4a7fb5;
    padding-top: 2px;
  }

  .stats-label {
    color: #7ea8c4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stats-num,
  .stats-rate,
  .stats-total {
    text-align: right;
    white-space: nowrap;
    font-family: Consolas, 'Courier New', Courier, monospace;
    font-variant-numeric: tabular-nums;
    color: #c0daf0;
  }

  .picker-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }

  .picker-row label,
  .picker-row .picker-label {
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

  .lb-gross { color: #e07070; font-family: 'Courier New', Courier, monospace; }
  .lb-return { color: #70e070; font-family: 'Courier New', Courier, monospace; }
  .lb-net { color: #e0e070; font-family: 'Courier New', Courier, monospace; }

  .talents {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 2px;
    border-top: 1px solid #4a7fb5;
    padding-top: 4px;
  }

  .slot-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 6px;
  }

  .slot-row-label { font-size: 10px; color: #9bb; }

  .slot-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    color: #7fd8b0;
    cursor: pointer;
    white-space: nowrap;
  }

  .slot-toggle input { margin: 0; cursor: pointer; }

  .modules {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 2px;
    border-top: 1px solid #4a7fb5;
    padding-top: 4px;
  }

  .module-chip {
    position: relative;
    font-size: 10px;
    background: #143c2e;
    border: 1px solid #3f9d76;
    border-radius: 3px;
    padding: 1px 4px;
    color: #7fd8b0;
    cursor: default;
    white-space: nowrap;
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

  .module-chip:hover .talent-tooltip,
  .talent-chip:hover .talent-tooltip {
    display: block;
  }

  .inlined-prods {
    margin-top: 4px;
    border-top: 1px solid #4a7fb5;
    padding-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .inlined-header {
    font-size: 10px;
    color: #90c8e0;
    font-weight: bold;
  }

  .inlined-row {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    padding-left: 8px;
  }

  .il-label {
    color: #a0c4e0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .il-net {
    color: #e0e070;
    font-family: 'Courier New', Courier, monospace;
    white-space: nowrap;
  }
</style>
