import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { resolveItemEdmValue } from '$lib/edm.js';
import { DEFAULT_SETTINGS, DEFAULT_EDM_VALUES, DEFAULT_EDM_TAG_DEFAULTS } from '$lib/settings.js';
import { EDM_DERIVED_FROM } from '$lib/edmDerived.js';
import type { AppSettings } from '$lib/settings.js';
import type { RecipeObject } from '$lib/types.js';

/**
 * An item that recipes consume but nothing produces becomes a raw leaf, and a
 * raw leaf with no EDM nulls the whole plan's total. This walks the real data
 * files so a data refresh that introduces a new such item fails here rather
 * than silently blanking someone's report.
 */

const VERSIONS = [
  { mode: 'eco12', recipes: 'recipes.wt55.json', tags: 'tags.json' },
  { mode: 'eco13', recipes: 'recipes.wt56.json', tags: 'tags.json' },
  { mode: 'eco14', recipes: 'recipes.eco14.json', tags: 'tags.eco14.json' },
] as const;

/** Known gaps, left uncovered on purpose. Shrinking this list is the goal. */
const ACCEPTED_GAPS = new Set(['Wood Scrap', 'Textiles']);

const read = (file: string) => JSON.parse(readFileSync(`static/${file}`, 'utf-8'));

function unproducedIngredients(recipes: RecipeObject[]): string[] {
  const produced = new Set<string>();
  const consumed = new Set<string>();
  for (const recipe of recipes) {
    for (const variant of recipe.Variants) {
      for (const product of variant.Products) produced.add(product.Name);
      for (const ing of variant.Ingredients) if (ing.Name) consumed.add(ing.Name);
    }
  }
  return [...consumed].filter(name => !produced.has(name)).sort();
}

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  edmValues: { ...DEFAULT_EDM_VALUES },
  edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS },
};

describe('default EDM coverage', () => {
  for (const version of VERSIONS) {
    it(`values every unproduced ingredient in ${version.mode}`, () => {
      const recipes = read(version.recipes).Recipes as RecipeObject[];
      const tagsIndex = buildTagsIndex(read(version.tags).Tags);

      const missing = unproducedIngredients(recipes).filter(name =>
        resolveItemEdmValue(name, settings, tagsIndex) === null &&
        !ACCEPTED_GAPS.has(name) &&
        // Priced off another item at plan time rather than from a default.
        !(name in EDM_DERIVED_FROM)
      );

      expect(missing).toEqual([]);
    });
  }

  it('prices garbage at a negligible 0,01', () => {
    for (const item of ['Bio Residue', 'Food Scrap', 'Tailings', 'Wet Tailings', 'Spoiled Food']) {
      expect(DEFAULT_EDM_VALUES[item]).toBe(0.01);
    }
  });
});
