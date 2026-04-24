import { describe, it, expect } from 'vitest';
import { buildGraph } from '$lib/planner.js';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { computeEdmReport } from '$lib/edm.js';
import type { AppSettings } from '$lib/settings.js';
import type { PlannerGraph, RecipeObject, UserChoices } from '$lib/types.js';

function emptyChoices(): UserChoices {
  return {
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(),
    marketItems: new Set(),
    upgradeByTable: new Map()
  };
}

const crushedSandstoneRecipe: RecipeObject = {
  Key: 'CrushedSandstone',
  Untranslated: 'Crushed Sandstone Recipe',
  BaseCraftTime: 1,
  BaseLaborCost: 10,
  BaseXPGain: 1,
  CraftingTable: 'Jaw Crusher',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Crushed Sandstone',
  NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Mining', Level: 2 }],
  Variants: [{
    Key: 'CrushedSandstone',
    Name: 'Crushed Sandstone',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Sandstone', Ammount: 20, IsStatic: true }
    ],
    Products: [{ Name: 'Crushed Sandstone', Ammount: 5 }]
  }]
};

const glassRecipe: RecipeObject = {
  Key: 'Glass',
  Untranslated: 'Glass Recipe',
  BaseCraftTime: 1,
  BaseLaborCost: 10,
  BaseXPGain: 1,
  CraftingTable: 'Furnace',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Glass',
  NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Smelting', Level: 1 }],
  Variants: [{
    Key: 'Glass',
    Name: 'Glass',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Crushed Sandstone', Ammount: 5, IsStatic: false }
    ],
    Products: [{ Name: 'Glass', Ammount: 1 }]
  }]
};

const settings: AppSettings = {
  ecoMode: 'eco13',
  edmValues: { Sandstone: 0.05 },
  edmTagDefaults: {},
  crossProfessionMarkup: 0.1
};

describe('computeEdmReport', () => {
  it('tracks table path output amount so per-item EDM can use produced units, not cycles', () => {
    const recipeIndex = buildRecipeIndex([crushedSandstoneRecipe, glassRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Glass',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0
    });

    const report = computeEdmReport(graph, settings, tagsIndex);
    expect(report.crossProfTransitions).toHaveLength(1);

    const tableEntry = report.crossProfTransitions[0].pathEntries.find(
      entry => entry.kind === 'table' && entry.itemName === 'Crushed Sandstone'
    );

    expect(tableEntry).toBeDefined();
    if (tableEntry?.kind === 'table') {
      expect(tableEntry.cycles).toBe(1);
      expect(tableEntry.neededAmount).toBe(5);
      expect(tableEntry.outputAmount).toBe(5);
      expect(tableEntry.subtreeEdm).toBe(1);
    }
  });

  it('uses branch-local amounts in cross-profession details when raw inputs are shared elsewhere', () => {
    const mortaredSandstoneRecipe: RecipeObject = {
      Key: 'MortaredSandstone',
      Untranslated: 'Mortared Sandstone Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Masonry Table',
      CraftingTableCanUseModules: true,
      DefaultVariant: 'Mortared Sandstone',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Mining', Level: 1 }],
      Variants: [{
        Key: 'MortaredSandstone',
        Name: 'Mortared Sandstone',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Sandstone', Ammount: 4, IsStatic: false },
          { IsSpecificItem: true, Tag: null, Name: 'Mortar', Ammount: 1, IsStatic: false }
        ],
        Products: [{ Name: 'Mortared Sandstone', Ammount: 1 }]
      }]
    };

    const masonryMortarRecipe: RecipeObject = {
      Key: 'MasonryMortar',
      Untranslated: 'Masonry Mortar Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Masonry Table',
      CraftingTableCanUseModules: true,
      DefaultVariant: 'Masonry Mortar',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Masonry', Level: 1 }],
      Variants: [{
        Key: 'MasonryMortar',
        Name: 'Masonry Mortar',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Sand', Ammount: 1, IsStatic: false }
        ],
        Products: [{ Name: 'Mortar', Ammount: 3 }]
      }]
    };

    const sandRecipe: RecipeObject = {
      Key: 'SandConcentrateLv3',
      Untranslated: 'Sand Concentrate Lv3 Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Sensor Based Belt Sorter',
      CraftingTableCanUseModules: true,
      DefaultVariant: 'Sand Concentrate Lv3',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Mining', Level: 6 }],
      Variants: [{
        Key: 'SandConcentrateLv3',
        Name: 'Sand Concentrate Lv3',
        Ingredients: [
          { IsSpecificItem: false, Tag: 'Silica', Name: '', Ammount: 6, IsStatic: false }
        ],
        Products: [{ Name: 'Sand', Ammount: 3 }]
      }]
    };

    const localSettings: AppSettings = {
      ecoMode: 'eco13',
      edmValues: { Sandstone: 0.05 },
      edmTagDefaults: {},
      crossProfessionMarkup: 0.1
    };

    const recipeIndex = buildRecipeIndex([
      crushedSandstoneRecipe,
      sandRecipe,
      masonryMortarRecipe,
      mortaredSandstoneRecipe
    ]);
    const tagsIndex = buildTagsIndex({ Silica: ['Crushed Sandstone'] });
    const choices = emptyChoices();
    choices.itemByTag.set('Silica', 'Crushed Sandstone');

    const graph = buildGraph({
      targetItem: 'Mortared Sandstone',
      totalAmount: 100,
      recipeIndex,
      tagsIndex,
      choices,
      globalUpgrade: 0.25
    });

    const report = computeEdmReport(graph, localSettings, tagsIndex);
    const sandTransition = report.crossProfTransitions.find(
      t => t.fromProf === 'Mining' && t.toProf === 'Masonry' && t.itemName === 'Sand'
    );

    expect(sandTransition).toBeDefined();
    expect(sandTransition?.baseEdm).toBeCloseTo(7, 6);
    expect(sandTransition?.markupAmount).toBeCloseTo(0.7, 6);

    const crushedEntry = sandTransition?.pathEntries.find(
      entry => entry.kind === 'table' && entry.itemName === 'Crushed Sandstone'
    );
    expect(crushedEntry).toBeDefined();
    if (crushedEntry?.kind === 'table') {
      expect(crushedEntry.neededAmount).toBeCloseTo(31.5, 6);
      expect(crushedEntry.outputAmount).toBe(35);
      expect(crushedEntry.subtreeEdm).toBeCloseTo(7, 6);
    }

    const sandstoneLeaf = sandTransition?.pathEntries.find(
      entry => entry.kind === 'leaf' && entry.itemName === 'Sandstone'
    );
    expect(sandstoneLeaf).toBeDefined();
    if (sandstoneLeaf?.kind === 'leaf') {
      expect(sandstoneLeaf.amount).toBe(140);
      expect(sandstoneLeaf.totalEdm).toBeCloseTo(7, 6);
    }
  });

  it('does not recurse forever when transition detail paths contain cycles', () => {
    const cyclicGraph: PlannerGraph = {
      nodes: [
        {
          type: 'table',
          id: 'table:A',
          itemName: 'A',
          table: 'Machine A',
          recipe: {
            Key: 'A',
            SkillNeeds: [{ Skill: 'Engineering', Level: 1 }]
          } as RecipeObject,
          variant: {
            Key: 'A',
            Name: 'A',
            Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'B', Ammount: 1, IsStatic: false }],
            Products: [{ Name: 'A', Ammount: 1 }]
          },
          cycles: 1,
          effectiveReduction: 0,
          appliedTalents: [],
          availableRecipes: []
        },
        {
          type: 'item',
          id: 'item:A',
          itemName: 'A',
          amount: 1
        },
        {
          type: 'table',
          id: 'table:B',
          itemName: 'B',
          table: 'Machine B',
          recipe: {
            Key: 'B',
            SkillNeeds: [{ Skill: 'Smelting', Level: 1 }]
          } as RecipeObject,
          variant: {
            Key: 'B',
            Name: 'B',
            Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'A', Ammount: 1, IsStatic: false }],
            Products: [{ Name: 'B', Ammount: 1 }]
          },
          cycles: 1,
          effectiveReduction: 0,
          appliedTalents: [],
          availableRecipes: []
        },
        {
          type: 'item',
          id: 'item:B',
          itemName: 'B',
          amount: 1
        }
      ],
      edges: [
        { id: 'table:A->item:A', source: 'table:A', target: 'item:A' },
        { id: 'item:B->table:A', source: 'item:B', target: 'table:A' },
        { id: 'table:B->item:B', source: 'table:B', target: 'item:B' },
        { id: 'item:A->table:B', source: 'item:A', target: 'table:B' }
      ]
    };

    expect(() => computeEdmReport(cyclicGraph, settings, buildTagsIndex({}))).not.toThrow();
  });
});
