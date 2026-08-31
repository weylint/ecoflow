import { ECO_MODES, MODULE_SLOTS, isEcoMode, isModuleSlot, usesModuleSlots } from './types.js';
import type {
  EcoMode, ModuleSlot, PlannerGraph, TablePlannerNode, RawPlannerNode,
  MarketPlannerNode, TagPlannerNode, ByproductPlannerNode, ProductPlannerNode
} from './types.js';
import type { EdmReport } from './edm.js';
import { computeEdmReport } from './edm.js';
import type { AppSettings } from './settings.js';
import type { TagsIndex } from './tagsIndex.js';

/** How much crafting efficiency a report column assumes for its version. */
export type ColumnTarget =
  | { mode: 'eco12' | 'eco13'; value: number }        // upgrade ladder fraction
  | { mode: 'eco14' | 'sandbox'; slots: ModuleSlot[] };  // filled module slots

/** Everything the report needs from one planned version. */
export interface ColumnSnapshot {
  rawByItem: Map<string, number>;
  marketByItem: Map<string, number>;
  tagByName: Map<string, number>;
  byproductByKey: Map<string, number>;
  laborByTable: Map<string, { table: string; item: string; labor: number }>;
  laborByProfession: Map<string, number>;
  valueAddedByTable: Map<string, { table: string; item: string; profession: string; va: number | null }>;
  edmReport: EdmReport;
  tableNodes: TablePlannerNode[];
  producedAmount: number;
}

export interface ReportColumn {
  mode: EcoMode;
  label: string;              // e.g. "Eco 14 · all modules"
  target: ColumnTarget;
  isActive: boolean;          // the version currently being planned
  /** null while the version's data is still loading, or if the product does not exist in it. */
  snapshot: ColumnSnapshot | null;
}

/**
 * Reduces a planned graph to the figures the report shows. Used for every column,
 * including the active one, so a rebuilt version and the live plan are summarised
 * by exactly the same code.
 */
export function buildSnapshot(
  graph: PlannerGraph,
  settings: AppSettings,
  tagsIndex: TagsIndex
): ColumnSnapshot {
  const tableNodes = graph.nodes.filter((n): n is TablePlannerNode => n.type === 'table');
  const edmReport = computeEdmReport(graph, settings, tagsIndex);

  const laborByTable = new Map<string, { table: string; item: string; labor: number }>();
  const laborByProfession = new Map<string, number>();
  for (const n of tableNodes) {
    laborByTable.set(n.id, { table: n.table, item: n.itemName, labor: n.recipe.BaseLaborCost * n.cycles });
    const prof = n.recipe.SkillNeeds[0]?.Skill ?? 'No Skill Required';
    laborByProfession.set(prof, (laborByProfession.get(prof) ?? 0) + n.recipe.BaseLaborCost * n.cycles);
  }

  const valueAddedByTable = new Map<string, { table: string; item: string; profession: string; va: number | null }>();
  for (const [id, va] of edmReport.tableValueAdded) {
    if (va === null || va <= 0) continue;
    const node = tableNodes.find(n => n.id === id);
    valueAddedByTable.set(id, {
      table: node?.table ?? id,
      item: node?.itemName ?? '',
      profession: node?.recipe.SkillNeeds[0]?.Skill ?? '',
      va,
    });
  }

  return {
    rawByItem: new Map(graph.nodes
      .filter((n): n is RawPlannerNode => n.type === 'raw')
      .map(n => [n.itemName, n.amount])),
    marketByItem: new Map(graph.nodes
      .filter((n): n is MarketPlannerNode => n.type === 'market')
      .map(n => [n.itemName, n.amount])),
    // Strictly unresolved: a tag the user has not pinned to an item. Byproduct-covered
    // tags are resolved, and belong in the graph rather than in this list.
    tagByName: new Map(graph.nodes
      .filter((n): n is TagPlannerNode => n.type === 'tag' && n.amount > 0 && n.selectedItem === null)
      .map(n => [n.tag, n.amount])),
    byproductByKey: new Map(graph.nodes
      .filter((n): n is ByproductPlannerNode => n.type === 'byproduct')
      .map(n => [n.id, n.amount])),
    laborByTable,
    laborByProfession,
    valueAddedByTable,
    edmReport,
    tableNodes,
    producedAmount: graph.nodes.find((n): n is ProductPlannerNode => n.type === 'product')?.producedAmount ?? 0,
  };
}

export interface ReportRow<M = undefined> {
  key: string;
  /** One entry per column, aligned by index; null where that column has no snapshot. */
  values: (number | null)[];
  meta: M;
}

/**
 * Builds one row per key across every column, so a section renders the union of
 * items rather than only those the active version happens to use.
 *
 * `pick` pulls the section's map out of a snapshot; `meta` derives per-row display
 * data (table name, producer, …) from the first column that actually has the key,
 * so a row still labels itself when it is absent from the active version.
 */
export function unionRows<M = undefined>(
  columns: readonly ReportColumn[],
  pick: (snapshot: ColumnSnapshot) => Map<string, number>,
  meta?: (key: string, snapshot: ColumnSnapshot) => M
): ReportRow<M>[] {
  const maps = columns.map(c => (c.snapshot ? pick(c.snapshot) : null));

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
    if (!map) continue;
    for (const key of map.keys()) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }

  // Sort by the active column where there is one, else the first column with data,
  // so the ordering matches the plan the user is actually looking at.
  const sortIdx = Math.max(
    0,
    columns.findIndex(c => c.isActive && c.snapshot) >= 0
      ? columns.findIndex(c => c.isActive && c.snapshot)
      : maps.findIndex(m => m !== null)
  );

  const rows = keys.map(key => {
    let metaValue: M = undefined as M;
    if (meta) {
      for (let i = 0; i < columns.length; i++) {
        const snapshot = columns[i].snapshot;
        if (snapshot && maps[i]?.has(key)) { metaValue = meta(key, snapshot); break; }
      }
    }
    return {
      key,
      values: maps.map(map => (map ? map.get(key) ?? 0 : null)),
      meta: metaValue,
    };
  });

  rows.sort((a, b) => (b.values[sortIdx] ?? 0) - (a.values[sortIdx] ?? 0));
  return rows;
}

/**
 * The value to measure column `index` against: the nearest earlier column that has
 * data. Skipping empty columns means a version where the product does not exist
 * does not blank out the next version's delta. Returns null for the first column
 * with data, which has nothing to compare against.
 */
export function previousValue(values: readonly (number | null)[], index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

// ── URL state ──────────────────────────────────────────────────────
// One `cols` parameter carries every version's efficiency, e.g.
//   cols=eco12:0.5;eco13:0.25;eco14:basic,advanced,modern,specialty

/** Modes absent from `targets` are omitted, so a link only carries the columns
 *  the report is actually showing (Sandbox stays out until it has a patch). */
export function serializeColumnTargets(targets: Partial<Record<EcoMode, ColumnTarget>>): string {
  return ECO_MODES.flatMap(mode => {
    const t = targets[mode];
    if (!t) return [];
    return [`${mode}:${'slots' in t ? t.slots.map(s => s.toLowerCase()).join(',') : t.value}`];
  }).join(';');
}

/** Lenient by design: an unparseable entry is skipped so the rest of a hand-edited
 *  or truncated link still applies, rather than the whole report falling back. */
export function parseColumnTargets(raw: string | null | undefined): Partial<Record<EcoMode, ColumnTarget>> {
  const out: Partial<Record<EcoMode, ColumnTarget>> = {};
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const mode = part.slice(0, idx);
    const val = part.slice(idx + 1);
    if (!isEcoMode(mode)) continue;
    if (usesModuleSlots(mode)) {
      const parsed = val === ''
        ? []
        : val.split(',').map(s => s.trim()).filter(Boolean)
             .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
      if (parsed.every(isModuleSlot)) {
        // Normalise to canonical slot order so two equivalent links compare equal.
        out[mode] = { mode, slots: MODULE_SLOTS.filter(s => parsed.includes(s)) };
      }
    } else {
      const value = parseFloat(val);
      if (isFinite(value) && value >= 0 && value <= 1) out[mode] = { mode, value };
    }
  }
  return out;
}
