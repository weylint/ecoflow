<script lang="ts">
  import type { TablePlannerNode, RecipeObject } from '../types.js';
  import { UPGRADE_LEVELS } from '../types.js';

  interface Props {
    tableNodes: TablePlannerNode[];
    upgradeByTable: Map<string, number>;
    globalUpgrade: number;
    onRecipeChange: (itemName: string, recipe: RecipeObject) => void;
    onUpgradeChange: (tableName: string, value: number) => void;
    onMarketSelect: (itemName: string) => void;
  }

  let { tableNodes, upgradeByTable, globalUpgrade, onRecipeChange, onUpgradeChange, onMarketSelect }: Props = $props();

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
</script>

<aside class="table-pane">
  <div class="pane-header">Tables</div>
  {#each [...groups.entries()] as [skill, nodes]}
    <div class="skill-group">
      <div class="skill-header">{skill}</div>
      {#each nodes as node}
        <div class="table-entry">
          <div class="entry-item">{node.itemName}</div>
          <div class="entry-table">{node.table}</div>
          <div class="entry-cycles">×{node.cycles} runs · {formatTime(node.cycles * node.recipe.BaseCraftTime * 60 * (1 - (upgradeByTable.get(node.table) ?? globalUpgrade)))}</div>

          <div class="entry-row">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Recipe:
              <select
                value={node.recipe.Key}
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
            </label>
          </div>

          <div class="entry-row">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label>Upgrade:
              <select
                value={upgradeByTable.get(node.table) ?? globalUpgrade}
                onchange={(e) => onUpgradeChange(node.table, Number((e.target as HTMLSelectElement).value))}
              >
                {#each UPGRADE_LEVELS as lvl}
                  <option value={lvl.value}>{lvl.label} ({lvl.value * 100}%)</option>
                {/each}
              </select>
            </label>
          </div>
        </div>
      {/each}
    </div>
  {/each}
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

  .skill-header {
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

  .entry-row {
    margin-bottom: 4px;
  }

  .entry-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #888;
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
</style>
