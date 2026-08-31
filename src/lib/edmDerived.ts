import type { AppSettings } from './settings.js';
import type { TagsIndex } from './tagsIndex.js';
import type { BuildOptions } from './planner.js';
import type { ProductPlannerNode } from './types.js';
import { buildGraph } from './planner.js';
import { computeEdmReport, resolveItemEdmValue } from './edm.js';

/**
 * Items with no producing recipe that are nonetheless worth what another,
 * planned item is worth. Recycling feedstock substitutes 1:1 for the matching
 * concentrate in otherwise identical recipes (Recycled Iron Bar: 2 Iron Scrap
 * → 6 Iron Bar, vs Smelt Iron: 2 Iron Concentrate → 6 Iron Bar), so its value
 * is the concentrate's — derived from the current plan settings rather than
 * frozen as a literal in DEFAULT_EDM_VALUES.
 */
export const EDM_DERIVED_FROM: Record<string, string> = {
  'Iron Scrap':   'Iron Concentrate',
  'Copper Scrap': 'Copper Concentrate',
  'Gold Scrap':   'Gold Concentrate',
};

/** The plan inputs a derivation needs — everything buildGraph takes but the target. */
export type DerivationOptions = Omit<BuildOptions, 'targetItem' | 'totalAmount'>;

/**
 * Per-unit EDM of `targetItem`, planned on its own at the given settings.
 * Returns null when the item cannot be planned or its own cost is unresolved.
 */
function perUnitEdm(
  targetItem: string,
  settings: AppSettings,
  tagsIndex: TagsIndex,
  opts: DerivationOptions
): number | null {
  if (!opts.recipeIndex.byProduct.has(targetItem)) return null;
  const graph = buildGraph({ ...opts, targetItem, totalAmount: 1 });
  const report = computeEdmReport(graph, settings, tagsIndex);
  if (report.totalEdm === null) return null;
  const produced = graph.nodes.find((n): n is ProductPlannerNode => n.type === 'product')?.producedAmount ?? 0;
  return produced > 0 ? report.totalEdm / produced : null;
}

/**
 * Resolves EDM_DERIVED_FROM into concrete per-item values and returns `settings`
 * with them filled in. A value the user already has (per-item override or tag
 * default) always wins, so this only ever fills gaps.
 *
 * Derivation runs against the *original* settings, never the augmented one: if a
 * target's own chain ever came back through a derived item it resolves to null
 * and is skipped rather than recursing. Results are deliberately not memoised —
 * they depend on the user's live recipe and variant choices, which are mutated
 * in place, and each target is a shallow graph.
 */
export function withDerivedEdmValues(
  settings: AppSettings,
  tagsIndex: TagsIndex,
  opts: DerivationOptions
): AppSettings {
  const fill: Record<string, number> = {};

  for (const [item, target] of Object.entries(EDM_DERIVED_FROM)) {
    // A per-item override or tag default the user already has always wins.
    if (resolveItemEdmValue(item, settings, tagsIndex) !== null) continue;
    const value = perUnitEdm(target, settings, tagsIndex, opts);
    if (value !== null) fill[item] = value;
  }

  if (Object.keys(fill).length === 0) return settings;
  return { ...settings, edmValues: { ...settings.edmValues, ...fill } };
}
