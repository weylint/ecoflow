<script lang="ts">
  import type { TablePlannerNode, RecipeObject, ModuleSlot, ECO12_UPGRADE_LEVELS, ECO13_UPGRADE_LEVELS } from '../types.js';
  import { fmtNum } from '../format.js';

  interface Props {
    tableNodes: TablePlannerNode[];
    upgradeByTable: Map<string, number>;
    globalUpgrade: number;
    upgradeLevels: typeof ECO12_UPGRADE_LEVELS | typeof ECO13_UPGRADE_LEVELS;
    onRecipeChange: (itemName: string, recipe: RecipeObject) => void;
    onUpgradeChange: (tableName: string, value: number) => void;
    onMarketSelect: (itemName: string) => void;
    // Eco 14 only: per-table module slots replace the upgrade ladder.
    // `availableSlots` returns [] for other versions, which selects the ladder.
    availableSlots?: (tableName: string) => ModuleSlot[];
    currentSlots?: (tableName: string) => ModuleSlot[];
    onModuleSlotsChange?: (tableName: string, slots: ModuleSlot[]) => void;
  }

  let { tableNodes, upgradeByTable, globalUpgrade, upgradeLevels, onRecipeChange, onUpgradeChange, onMarketSelect,
        availableSlots, currentSlots, onModuleSlotsChange }: Props = $props();

  function toggleSlot(table: string, slot: ModuleSlot, on: boolean) {
    const next = new Set(currentSlots?.(table) ?? []);
    if (on) next.add(slot); else next.delete(slot);
    onModuleSlotsChange?.(table, (availableSlots?.(table) ?? []).filter(s => next.has(s)));
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

  // Group table nodes by skill name
  const groups = $derived.by(() => {
    const map = new Map<string, TablePlannerNode[]>();
    for (const node of tableNodes) {
      const skill = node.recipe.SkillNeeds[0]?.Skill ?? 'No Skill Required';
      if (!map.has(skill)) map.set(skill, []);
      map.get(skill)!.push(node);
    }
    return map;
  });

  const inlinedRows = $derived(
    tableNodes.flatMap(n => (n.inlinedProductions ?? []).map(ip => ({ ip, parentNode: n })))
  );
</script>

<aside class="table-pane" aria-labelledby="table-pane-heading">
  <h2 class="pane-header" id="table-pane-heading">Tables</h2>
  {#each [...groups.entries()] as [skill, nodes]}
    <section class="skill-group" aria-label={skill}>
      <h3 class="skill-header">{skill}</h3>
      <ul class="entry-list">
      {#each nodes as node}
        <li class="table-entry">
          <div class="entry-item">{node.itemName}</div>
          <div class="entry-table">{node.table}</div>
          <div class="entry-cycles" data-value={node.cycles}>×{node.cycles} runs · {formatTime(node.cycles * node.recipe.BaseCraftTime * 60 * (1 - (node.recipe.CraftingTableCanUseModules ? (upgradeByTable.get(node.table) ?? globalUpgrade) : 0)))}</div>

          <div class="entry-row">
            <span class="picker-label">Recipe:</span>
            <select
              value={node.recipe.Key}
              aria-label="Recipe for {node.itemName} at {node.table}, currently {node.recipe.DefaultVariant}"
              onchange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                if (val === '__market__') { onMarketSelect(node.itemName); return; }
                const r = node.availableRecipes.find(x => x.Key === val);
                if (r) onRecipeChange(node.itemName, r);
              }}
            >
              <option value="__market__">Market</option>
              {#each node.availableRecipes as r}
                <option value={r.Key}>{r.DefaultVariant}</option>
              {/each}
            </select>
          </div>
          <div class="sr-only">Recipe: {node.recipe.DefaultVariant}{node.availableRecipes.length > 1
            ? ` (${node.availableRecipes.length - 1} alternative${node.availableRecipes.length === 2 ? '' : 's'})` : ''}</div>

          {#if node.recipe.CraftingTableCanUseModules}
            {@const slots = availableSlots?.(node.table) ?? []}
            {#if slots.length > 0}
              <div class="entry-row slot-row">
                <span class="slot-row-label">Modules:</span>
                {#each slots as slot}
                  <label class="slot-toggle">
                    <input
                      type="checkbox"
                      checked={(currentSlots?.(node.table) ?? []).includes(slot)}
                      onchange={(e) => toggleSlot(node.table, slot, (e.target as HTMLInputElement).checked)}
                      aria-label="{slot} module slot on {node.table}"
                    />
                    {slot}
                  </label>
                {/each}
              </div>
              {@const on = currentSlots?.(node.table) ?? []}
              {@const off = slots.filter(sl => !on.includes(sl))}
              <div class="sr-only">Modules applied: {on.length > 0 ? on.join(', ') : 'none'}{off.length > 0 ? ` (${off.join(', ')} off)` : ''}</div>
            {:else}
              <div class="entry-row">
                <span class="picker-label">Upgrade:</span>
                <select
                  value={upgradeByTable.get(node.table) ?? globalUpgrade}
                  aria-label="Upgrade level for {node.table}, currently {Math.round((upgradeByTable.get(node.table) ?? globalUpgrade) * 100)}%"
                  onchange={(e) => onUpgradeChange(node.table, Number((e.target as HTMLSelectElement).value))}
                >
                  {#each upgradeLevels as lvl}
                    <option value={lvl.value}>{lvl.label} ({lvl.value * 100}%)</option>
                  {/each}
                </select>
              </div>
            {/if}
          {/if}
        </li>
      {/each}
      </ul>
    </section>
  {/each}

  {#if inlinedRows.length > 0}
    <section class="skill-group" aria-label="Inlined Producers">
      <h3 class="skill-header">Inlined Producers</h3>
      <ul class="entry-list">
      {#each inlinedRows as { ip, parentNode }}
        <li class="table-entry">
          <div class="entry-item">via {parentNode.itemName}</div>
          <div class="entry-table">{ip.producerTable}</div>
          <div class="entry-cycles" data-value={ip.cycles}>×{ip.cycles} runs (inlined)</div>
          {#each ip.netIngredients as ni}
            {#if ni.amount > 0}
              <div class="inlined-ing">
                <span class="ii-name">{ni.name}</span>
                <span class="ii-net" data-value={ni.amount}>net {fmtNum(ni.amount)}</span>
              </div>
            {/if}
          {/each}
        </li>
      {/each}
      </ul>
    </section>
  {/if}
</aside>

<style>
  .table-pane {
    width: 280px;
    background: #181818;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .pane-header {
    margin: 0;
    background: #1e1e1e;
    border-bottom: 1px solid #333;
    padding: 8px 12px;
    font-weight: bold;
    font-size: 13px;
    color: #7ec8e3;
    flex-shrink: 0;
  }

  .skill-group {
    border-bottom: 1px solid #2a2a2a;
  }

  .entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .skill-header {
    margin: 0;
    background: #222;
    padding: 4px 12px;
    font-size: 11px;
    color: #888;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .table-entry {
    padding: 8px 12px;
    border-bottom: 1px solid #222;
  }

  .table-entry:last-child {
    border-bottom: none;
  }

  .entry-item {
    font-size: 10px;
    color: #777;
    margin-bottom: 1px;
  }

  .entry-table {
    font-size: 13px;
    font-weight: bold;
    color: #c8dff0;
    margin-bottom: 2px;
  }

  .entry-cycles {
    font-size: 11px;
    color: #7ec8e3;
    margin-bottom: 4px;
  }

  .slot-row {
    flex-wrap: wrap;
    gap: 2px 8px;
    /* Was inherited from `.entry-row label`, which the explicit picker labels replaced. */
    font-size: 11px;
  }

  .slot-row-label { color: #9bb; }

  .slot-toggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: #7fd8b0;
    cursor: pointer;
    white-space: nowrap;
  }

  .slot-toggle input { margin: 0; cursor: pointer; }

  .entry-row {
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .entry-row .picker-label {
    font-size: 11px;
    color: #888;
    white-space: nowrap;
  }

  .entry-row select {
    flex: 1;
    background: #252525;
    border: 1px solid #444;
    color: #d0d0d0;
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 11px;
  }

  .inlined-ing {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    padding-left: 8px;
    margin-top: 1px;
  }

  .ii-name {
    color: #a0a0a0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ii-net {
    color: #e0e070;
    font-family: 'Courier New', Courier, monospace;
    white-space: nowrap;
  }
</style>
