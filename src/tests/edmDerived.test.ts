import { describe, it, expect } from 'vitest';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { buildGraph } from '$lib/planner.js';
import { computeEdmReport, resolveItemEdmValue } from '$lib/edm.js';
import { withDerivedEdmValues, EDM_DERIVED_FROM } from '$lib/edmDerived.js';
import type { AppSettings } from '$lib/settings.js';
import type { RecipeObject, UserChoices } from '$lib/types.js';

function emptyChoices(): UserChoices {
  return {
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(),
    marketItems: new Set(),
    upgradeByTable: new Map()
  };
}

// 20 Iron Ore → 1 Iron Concentrate, mirroring the shape of the real recipe.
const concentrateRecipe: RecipeObject = {
  Key: 'IronConcentrate',
  Untranslated: 'Iron Concentrate Recipe',
  BaseCraftTime: 1,
  BaseLaborCost: 0,
  BaseXPGain: 1,
  CraftingTable: 'Froth Floatation Cell',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Iron Concentrate',
  NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Mining', Level: 1 }],
  Variants: [{
    Key: 'IronConcentrate',
    Name: 'Iron Concentrate',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 20, IsStatic: true }
    ],
    Products: [{ Name: 'Iron Concentrate', Ammount: 1 }]
  }]
};

// The recycling twin: same table, same output, scrap in place of concentrate.
const recycledBarRecipe: RecipeObject = {
  Key: 'RecycledIronBar',
  Untranslated: 'Recycled Iron Bar Recipe',
  BaseCraftTime: 1,
  BaseLaborCost: 0,
  BaseXPGain: 1,
  CraftingTable: 'Bloomery',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Recycled Iron Bar',
  NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Smelting', Level: 1 }],
  Variants: [{
    Key: 'RecycledIronBar',
    Name: 'Recycled Iron Bar',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Iron Scrap', Ammount: 2, IsStatic: true }
    ],
    Products: [{ Name: 'Iron Bar', Ammount: 6 }]
  }]
};

const baseSettings: AppSettings = {
  ecoMode: 'eco14',
  edmValues: { 'Iron Ore': 2 },
  edmTagDefaults: {},
  crossProfessionMarkup: 0,
  foodCostEnabled: false,
  foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
  showNodeStats: true,
};

function planOpts(recipes: RecipeObject[]) {
  return {
    recipeIndex: buildRecipeIndex(recipes),
    tagsIndex: buildTagsIndex({}),
    choices: emptyChoices(),
    globalUpgrade: 0,
  };
}

describe('withDerivedEdmValues', () => {
  it('prices Iron Scrap at the per-unit EDM of Iron Concentrate', () => {
    const opts = planOpts([concentrateRecipe, recycledBarRecipe]);
    const derived = withDerivedEdmValues(baseSettings, opts.tagsIndex, opts);

    // 20 Iron Ore × 2 EDM, one concentrate produced.
    expect(derived.edmValues['Iron Scrap']).toBeCloseTo(40, 6);
  });

  it('lets a plan that consumes scrap resolve instead of nulling its total', () => {
    const opts = planOpts([concentrateRecipe, recycledBarRecipe]);
    const settings = withDerivedEdmValues(baseSettings, opts.tagsIndex, opts);

    const graph = buildGraph({ ...opts, targetItem: 'Iron Bar', totalAmount: 6 });
    const report = computeEdmReport(graph, settings, opts.tagsIndex);

    expect(report.missingItems).toEqual([]);
    expect(report.totalEdm).toBeCloseTo(80, 6);  // 2 scrap × 40
  });

  it('leaves a user override alone', () => {
    const opts = planOpts([concentrateRecipe, recycledBarRecipe]);
    const settings = { ...baseSettings, edmValues: { ...baseSettings.edmValues, 'Iron Scrap': 3 } };
    const derived = withDerivedEdmValues(settings, opts.tagsIndex, opts);

    expect(derived.edmValues['Iron Scrap']).toBe(3);
  });

  it('skips an item whose source cannot be planned, rather than throwing', () => {
    const opts = planOpts([recycledBarRecipe]);   // no concentrate recipe at all
    const derived = withDerivedEdmValues(baseSettings, opts.tagsIndex, opts);

    expect(resolveItemEdmValue('Iron Scrap', derived, opts.tagsIndex)).toBeNull();
  });

  it('skips an item whose source has an unresolved cost of its own', () => {
    // No EDM for Iron Ore, so the concentrate's own total is null.
    const opts = planOpts([concentrateRecipe, recycledBarRecipe]);
    const settings = { ...baseSettings, edmValues: {} };
    const derived = withDerivedEdmValues(settings, opts.tagsIndex, opts);

    expect(derived.edmValues['Iron Scrap']).toBeUndefined();
  });

  it('names a concentrate for each metal scrap', () => {
    expect(EDM_DERIVED_FROM).toEqual({
      'Iron Scrap': 'Iron Concentrate',
      'Copper Scrap': 'Copper Concentrate',
      'Gold Scrap': 'Gold Concentrate',
    });
  });
});
