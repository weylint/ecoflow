import type { AppSettings } from './settings.js';

/**
 * The subset of AppSettings that can change an EDM figure. Layout, dark mode and
 * the eco version are deliberately absent: the version is reported separately,
 * and the rest cannot move a number.
 */
interface PriceSetInput {
  edmValues: Record<string, number>;
  edmTagDefaults: Record<string, number>;
  crossProfessionMarkup: number;
  foodCostEnabled: boolean;
  foodTierCosts: AppSettings['foodTierCosts'];
  sandboxPatch: unknown;
}

/** An empty patch is the same price model as no patch, and the two spellings
 *  (`undefined` from the CLI, `EMPTY_SANDBOX_PATCH` from the settings store)
 *  must not hash to different ids. */
function normalisePatch(patch: AppSettings['sandboxPatch']): unknown {
  if (!patch) return null;
  const empty = Object.keys(patch.variants ?? {}).length === 0
    && (patch.disabledTalents?.length ?? 0) === 0;
  return empty ? null : patch;
}

/** JSON with object keys sorted at every depth, so two equal settings stringify equal. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
}

/** FNV-1a, 32-bit. Not a security hash — an identifier short enough to print. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A short stable id for the price model behind a cost figure.
 *
 * Every EDM number the app produces depends on values that live only in the
 * user's localStorage, so the same URL in a fresh profile yields different
 * costs. Stamping this id alongside a total says *which* price set produced it,
 * which is what makes one agent's figure checkable by another.
 */
/**
 * Pass the settings *before* `withDerivedEdmValues` — derived prices depend on
 * the plan being costed, so hashing them would give the same price model a
 * different id for every product.
 */
export function priceSetId(settings: AppSettings): string {
  const input: PriceSetInput = {
    edmValues: settings.edmValues,
    edmTagDefaults: settings.edmTagDefaults,
    crossProfessionMarkup: settings.crossProfessionMarkup,
    foodCostEnabled: settings.foodCostEnabled,
    foodTierCosts: settings.foodTierCosts,
    sandboxPatch: normalisePatch(settings.sandboxPatch),
  };
  return fnv1a(stableStringify(input)).toString(16).padStart(8, '0');
}
