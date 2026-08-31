import type { ProfessionData, RecipeObject, Variant } from './types.js';

/**
 * The Sandbox version: Eco 14's data with the user's own overrides applied, so a
 * balancing change can be costed against Eco 12, 13 and stock Eco 14 side by side.
 *
 * Overrides are keyed by **variant key**, not recipe key: a recipe like Iron Bar
 * has several variants (Smelt Iron, Iron Bar) with different amounts, and lowering
 * the yield of one should not silently move the other.
 */

export interface VariantOverride {
  /** Product name → new `Ammount` per craft. */
  products?: Record<string, number>;
  /** Ingredient name (or tag, for tag ingredients) → new `Ammount` per craft. */
  ingredients?: Record<string, number>;
}

export interface SandboxPatch {
  version: 1;
  /** Variant key → amount overrides. */
  variants: Record<string, VariantOverride>;
  /** Talent display names (as `buildTalentIndex` derives them) to switch off. */
  disabledTalents: string[];
}

export const EMPTY_SANDBOX_PATCH: SandboxPatch = {
  version: 1,
  variants: {},
  disabledTalents: [],
};

/** An ingredient's override key: specific items go by name, tag ingredients by tag. */
export function ingredientKey(ing: { Name: string | null; Tag: string | null }): string {
  return ing.Name || ing.Tag || '';
}

export function isPatchEmpty(patch: SandboxPatch | undefined): boolean {
  if (!patch) return true;
  if (patch.disabledTalents.length > 0) return false;
  return Object.values(patch.variants).every(
    v => Object.keys(v.products ?? {}).length === 0 && Object.keys(v.ingredients ?? {}).length === 0
  );
}

/** How many variants the patch actually changes — what the UI counts as "edits". */
export function patchedVariantCount(patch: SandboxPatch | undefined): number {
  if (!patch) return 0;
  return Object.values(patch.variants).filter(
    v => Object.keys(v.products ?? {}).length > 0 || Object.keys(v.ingredients ?? {}).length > 0
  ).length;
}

function applyVariant(variant: Variant, override: VariantOverride): Variant {
  return {
    ...variant,
    Products: variant.Products.map(p =>
      override.products?.[p.Name] !== undefined ? { ...p, Ammount: override.products[p.Name] } : p
    ),
    Ingredients: variant.Ingredients.map(i => {
      const amount = override.ingredients?.[ingredientKey(i)];
      return amount !== undefined ? { ...i, Ammount: amount } : i;
    }),
  };
}

export interface PatchResult {
  recipes: RecipeObject[];
  /** Variant keys in the patch that no recipe in this data set has. */
  unmatched: string[];
}

/**
 * Returns a new recipe list with the patch applied. Only touched recipes and
 * variants are copied — the rest are shared by reference, so patching does not
 * duplicate the whole ~3000-recipe tree, and nothing mutates the source data
 * another version's index may be holding.
 */
export function applySandboxPatch(recipes: RecipeObject[], patch: SandboxPatch): PatchResult {
  const overrides = new Map(Object.entries(patch.variants));
  if (overrides.size === 0) return { recipes, unmatched: [] };

  const matched = new Set<string>();
  const patched = recipes.map(recipe => {
    if (!recipe.Variants.some(v => overrides.has(v.Key))) return recipe;
    return {
      ...recipe,
      Variants: recipe.Variants.map(v => {
        const override = overrides.get(v.Key);
        if (!override) return v;
        matched.add(v.Key);
        return applyVariant(v, override);
      }),
    };
  });

  return {
    recipes: patched,
    unmatched: [...overrides.keys()].filter(key => !matched.has(key)),
  };
}

/** The name `buildTalentIndex` will index this talent under. */
export function talentDisplayName(displayName: string): string {
  return displayName.split(':')[0].trim();
}

/** Every talent name that carries a resource-cost reduction, for the editor's list. */
export function talentNames(professions: ProfessionData[]): string[] {
  const names = new Set<string>();
  for (const profession of professions) {
    for (const skill of profession.skills) {
      for (const talent of skill.talents) {
        if (!talent.effects?.some(e => !e.penalty && e.effect?.includes('resource cost'))) continue;
        names.add(talentDisplayName(talent.display_name));
      }
    }
  }
  return [...names].sort();
}

/**
 * Drops disabled talents before the index is built, which is the only place a
 * talent has an effect — `buildTalentIndex` compounds whatever it is given.
 */
export function applyTalentPatch(professions: ProfessionData[], patch: SandboxPatch): ProfessionData[] {
  const disabled = new Set(patch.disabledTalents);
  if (disabled.size === 0) return professions;

  return professions.map(profession => ({
    ...profession,
    skills: profession.skills.map(skill => ({
      ...skill,
      talents: skill.talents.filter(t => !disabled.has(talentDisplayName(t.display_name))),
    })),
  }));
}

/** Validates an imported patch rather than trusting the file. */
export function parseSandboxPatch(raw: unknown): SandboxPatch | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<SandboxPatch>;
  if (candidate.version !== 1) return null;

  const variants: Record<string, VariantOverride> = {};
  for (const [key, value] of Object.entries(candidate.variants ?? {})) {
    if (typeof value !== 'object' || value === null) continue;
    const override: VariantOverride = {};
    for (const field of ['products', 'ingredients'] as const) {
      const entries = Object.entries((value as VariantOverride)[field] ?? {})
        .filter(([, n]) => typeof n === 'number' && isFinite(n) && n >= 0);
      if (entries.length > 0) override[field] = Object.fromEntries(entries);
    }
    if (override.products || override.ingredients) variants[key] = override;
  }

  return {
    version: 1,
    variants,
    disabledTalents: Array.isArray(candidate.disabledTalents)
      ? candidate.disabledTalents.filter((t): t is string => typeof t === 'string')
      : [],
  };
}
