import { describe, it, expect } from 'vitest';
import { buildGraph } from '$lib/planner.js';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { computeEdmReport } from '$lib/edm.js';
import { displayedProductEdmPerUnit, tableEdmPerUnit } from '$lib/nodeEdmDisplay.js';
import type { AppSettings } from '$lib/settings.js';
import type { PlannerGraph, RecipeObject, UserChoices, ItemPlannerNode } from '$lib/types.js';

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
  crossProfessionMarkup: 0.1,
  foodCostEnabled: false,
  foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
  showNodeStats: true,
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
      crossProfessionMarkup: 0.1,
      foodCostEnabled: false,
      foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
      showNodeStats: true,
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

  it('tracks table-local EDM separately from graph-global node EDM for shared crafted inputs', () => {
    const mortarRecipe: RecipeObject = {
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
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Sand', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Mortar', Ammount: 1 }]
      }]
    };

    const frameRecipe: RecipeObject = {
      Key: 'Frame',
      Untranslated: 'Frame Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Assembly Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Frame',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Industry', Level: 1 }],
      Variants: [{
        Key: 'Frame',
        Name: 'Frame',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Mortar', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Frame', Ammount: 1 }]
      }]
    };

    const panelRecipe: RecipeObject = {
      Key: 'Panel',
      Untranslated: 'Panel Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Assembly Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Panel',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Industry', Level: 1 }],
      Variants: [{
        Key: 'Panel',
        Name: 'Panel',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Mortar', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Panel', Ammount: 1 }]
      }]
    };

    const kitRecipe: RecipeObject = {
      Key: 'Kit',
      Untranslated: 'Kit Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Assembly Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Kit',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Industry', Level: 1 }],
      Variants: [{
        Key: 'Kit',
        Name: 'Kit',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Frame', Ammount: 1, IsStatic: false },
          { IsSpecificItem: true, Tag: null, Name: 'Panel', Ammount: 1, IsStatic: false }
        ],
        Products: [{ Name: 'Kit', Ammount: 1 }]
      }]
    };

    const localSettings: AppSettings = {
      ecoMode: 'eco13',
      edmValues: { Sand: 2 },
      edmTagDefaults: {},
      crossProfessionMarkup: 0.1,
      foodCostEnabled: false,
      foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
      showNodeStats: true,
    };

    const recipeIndex = buildRecipeIndex([
      mortarRecipe,
      frameRecipe,
      panelRecipe,
      kitRecipe
    ]);
    const tagsIndex = buildTagsIndex({});

    const graph = buildGraph({
      targetItem: 'Kit',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0
    });

    const report = computeEdmReport(graph, localSettings, tagsIndex);
    const mortarTableEdm = report.tableEdm.get('table:Mortar');

    expect(report.totalEdm).toBeCloseTo(4.2, 6);
    expect(mortarTableEdm).toBeCloseTo(4, 6);
    expect((mortarTableEdm ?? 0) / 2).toBeCloseTo(2, 6);
    expect(report.nodeEdm.get('table:Kit')).toBeGreaterThan(report.totalEdm ?? 0);
  });

  it('uses report total for the selected product display when shared subtrees would inflate local table EDM', () => {
    const mortarRecipe: RecipeObject = {
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
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Sand', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Mortar', Ammount: 1 }]
      }]
    };

    const frameRecipe: RecipeObject = {
      Key: 'Frame',
      Untranslated: 'Frame Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Assembly Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Frame',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Industry', Level: 1 }],
      Variants: [{
        Key: 'Frame',
        Name: 'Frame',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Mortar', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Frame', Ammount: 1 }]
      }]
    };

    const panelRecipe: RecipeObject = {
      Key: 'Panel',
      Untranslated: 'Panel Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Assembly Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Panel',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Industry', Level: 1 }],
      Variants: [{
        Key: 'Panel',
        Name: 'Panel',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Mortar', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Panel', Ammount: 1 }]
      }]
    };

    const kitRecipe: RecipeObject = {
      Key: 'Kit',
      Untranslated: 'Kit Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Assembly Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Kit',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Industry', Level: 1 }],
      Variants: [{
        Key: 'Kit',
        Name: 'Kit',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Frame', Ammount: 1, IsStatic: false },
          { IsSpecificItem: true, Tag: null, Name: 'Panel', Ammount: 1, IsStatic: false }
        ],
        Products: [{ Name: 'Kit', Ammount: 1 }]
      }]
    };

    const localSettings: AppSettings = {
      ecoMode: 'eco13',
      edmValues: { Sand: 2 },
      edmTagDefaults: {},
      crossProfessionMarkup: 0.1,
      foodCostEnabled: false,
      foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
      showNodeStats: true,
    };

    const recipeIndex = buildRecipeIndex([mortarRecipe, frameRecipe, panelRecipe, kitRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Kit',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0
    });

    const report = computeEdmReport(graph, localSettings, tagsIndex);
    const kitTable = graph.nodes.find(
      (node): node is Extract<PlannerGraph['nodes'][number], { type: 'table' }> => node.type === 'table' && node.itemName === 'Kit'
    );

    expect(kitTable).toBeDefined();
    if (!kitTable) return;

    expect(tableEdmPerUnit(kitTable, report)).toBeCloseTo(4.4, 6);
    expect(report.totalEdm).toBeCloseTo(4.2, 6);
    expect(displayedProductEdmPerUnit(kitTable, report, 'Kit', 1)).toBeCloseTo(4.2, 6);
    expect(displayedProductEdmPerUnit(kitTable, report, 'Other', 1)).toBeCloseTo(4.4, 6);
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

  it('computes work party cost at 50 EDM per 1k Labour (BaseLaborCost × cycles) for excluded recipes', () => {
    const baseLaborCost = 200;
    const cycles = 3;

    const wpGraph: PlannerGraph = {
      nodes: [
        {
          type: 'table',
          id: 'table:LaserBody',
          itemName: 'Laser Body',
          table: 'Power Hammer',
          recipe: {
            Key: 'Laser Body',
            BaseLaborCost: baseLaborCost,
            SkillNeeds: [{ Skill: 'Blacksmith', Level: 3 }],
          } as RecipeObject,
          variant: {
            Key: 'LaserBody',
            Name: 'Laser Body',
            Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Steel Bar', Ammount: 5, IsStatic: false }],
            Products: [{ Name: 'Laser Body', Ammount: 1 }]
          },
          cycles,
          effectiveReduction: 0,
          appliedTalents: [],
          availableRecipes: []
        },
        { type: 'item', id: 'item:Laser Body', itemName: 'Laser Body', amount: cycles },
        { type: 'raw',  id: 'raw:Steel Bar',   itemName: 'Steel Bar',   amount: 5 * cycles }
      ],
      edges: [
        { id: 'e1', source: 'table:LaserBody', target: 'item:Laser Body' },
        { id: 'e2', source: 'raw:Steel Bar',   target: 'table:LaserBody' }
      ]
    };

    const report = computeEdmReport(wpGraph, settings, buildTagsIndex({}));
    const expected = (baseLaborCost * cycles / 1000) * 50;
    expect(report.tableValueAdded.get('table:LaserBody')).toBeCloseTo(expected, 6);
  });

  it('uses primary recipe table over byproduct tables when an item is both crafted and a byproduct', () => {
    // Mirrors: Iron Ore → Barrel (primary recipe) → Petroleum (IsStatic barrel) →
    //          Epoxy/Plastic (both produce Barrel as byproduct).
    // Both Widget and Part produce Container as byproduct (supply=6), but Fuel needs
    // 8 containers → net=2 → table:Container IS in the graph.
    // Bug: byproduct edges from table:Widget/table:Part overwrote table:Container in
    // producerTableOf, making Container appear free (cycle → 0) and hiding Iron cost.
    const containerRecipe: RecipeObject = {
      Key: 'Container', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Iron Workshop', CraftingTableCanUseModules: false,
      DefaultVariant: 'Container', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Container', Name: 'Container',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron', Ammount: 4, IsStatic: false }],
        Products: [{ Name: 'Container', Ammount: 4 }]
      }]
    };
    const fuelRecipe: RecipeObject = {
      Key: 'Fuel', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Pump', CraftingTableCanUseModules: false,
      DefaultVariant: 'Fuel', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Fuel', Name: 'Fuel',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Container', Ammount: 1, IsStatic: true }],
        Products: [{ Name: 'Fuel', Ammount: 1 }]
      }]
    };
    const widgetRecipe: RecipeObject = {
      Key: 'Widget', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Refinery', CraftingTableCanUseModules: false,
      DefaultVariant: 'Widget', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Widget', Name: 'Widget',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Fuel', Ammount: 4, IsStatic: false }],
        Products: [{ Name: 'Widget', Ammount: 2 }, { Name: 'Container', Ammount: 3 }]
      }]
    };
    const partRecipe: RecipeObject = {
      Key: 'Part', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Refinery', CraftingTableCanUseModules: false,
      DefaultVariant: 'Part', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Part', Name: 'Part',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Fuel', Ammount: 4, IsStatic: false }],
        Products: [{ Name: 'Part', Ammount: 2 }, { Name: 'Container', Ammount: 3 }]
      }]
    };
    const productRecipe: RecipeObject = {
      Key: 'Product', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Assembly', CraftingTableCanUseModules: false,
      DefaultVariant: 'Product', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Product', Name: 'Product',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Widget', Ammount: 1, IsStatic: false },
          { IsSpecificItem: true, Tag: null, Name: 'Part',   Ammount: 1, IsStatic: false }
        ],
        Products: [{ Name: 'Product', Ammount: 1 }]
      }]
    };

    const recipeIndex = buildRecipeIndex([containerRecipe, fuelRecipe, widgetRecipe, partRecipe, productRecipe]);
    const tagsIndex = buildTagsIndex({});

    function buildReport(ironPrice: number) {
      const graph = buildGraph({
        targetItem: 'Product', totalAmount: 1, recipeIndex, tagsIndex,
        choices: emptyChoices(), globalUpgrade: 0
      });
      return computeEdmReport(graph, {
        ecoMode: 'eco13',
        edmValues: { Iron: ironPrice },
        edmTagDefaults: {},
        crossProfessionMarkup: 0,
        foodCostEnabled: false,
        foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
        showNodeStats: true,
      }, tagsIndex);
    }

    const report1 = buildReport(1);
    const report2 = buildReport(2);

    // 1 Widget cycle uses 4 Fuel; each Fuel needs 1 Container (IsStatic).
    // 4 Containers → 1 Container recipe cycle → 4 Iron.
    // tableEdm is for outputAmount=2 Widget (1 cycle), so equals 4 × ironPrice.
    expect(report1.tableEdm.get('table:Widget')).toBeCloseTo(4, 6);
    expect(report2.tableEdm.get('table:Widget')).toBeCloseTo(8, 6);
    expect(report1.tableEdm.get('table:Part')).toBeCloseTo(4, 6);
    expect(report2.tableEdm.get('table:Part')).toBeCloseTo(8, 6);

    // Total EDM scales with Iron price (no markup, no food).
    // resolveScaled accumulates 8 gross Iron units (2 Container cycles × 4 Iron each)
    // before byproduct netting reduces Container cycles to 1 in the graph.
    expect(report1.totalEdm).toBeCloseTo(8, 6);
    expect(report2.totalEdm).toBeCloseTo(16, 6);
  });

  it('uses local cycle count for food cost in buildLocalPath so shared intermediate tables do not inflate tableEdm', () => {
    // Chain: Raw → Intermediate (food cost) → WidgetA (uses Intermediate)
    //                                        → WidgetB (uses Intermediate, different context)
    //        WidgetA + WidgetB → Product
    //
    // When computing tableEdm for WidgetA (400 cycles in graph) by calling
    // buildLocalPath('table:WidgetA', outputAmount, 0), the local neededAmount for
    // Intermediate may require fewer cycles than the graph's table:Intermediate.cycles
    // (which also serves WidgetB). Without the fix, tableFoodEdm uses the graph's
    // inflated cycle count → WidgetA's tableEdm is too high relative to a graph
    // where WidgetA is the only consumer of Intermediate.

    const intermediateRecipe: RecipeObject = {
      Key: 'Intermediate', BaseCraftTime: 1, BaseLaborCost: 1000, BaseXPGain: 1,
      CraftingTable: 'Workshop A', CraftingTableCanUseModules: false,
      DefaultVariant: 'Intermediate', NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Smelting', Level: 1 }],
      Variants: [{
        Key: 'Intermediate', Name: 'Intermediate',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Raw', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Intermediate', Ammount: 1 }]
      }]
    };
    const widgetARecipe: RecipeObject = {
      Key: 'WidgetA', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Workshop B', CraftingTableCanUseModules: false,
      DefaultVariant: 'WidgetA', NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Smelting', Level: 1 }],
      Variants: [{
        Key: 'WidgetA', Name: 'WidgetA',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Intermediate', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'WidgetA', Ammount: 1 }]
      }]
    };
    const widgetBRecipe: RecipeObject = {
      Key: 'WidgetB', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Workshop B', CraftingTableCanUseModules: false,
      DefaultVariant: 'WidgetB', NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Smelting', Level: 1 }],
      Variants: [{
        Key: 'WidgetB', Name: 'WidgetB',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Intermediate', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'WidgetB', Ammount: 1 }]
      }]
    };
    const productRecipe: RecipeObject = {
      Key: 'Product2', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Assembly2', CraftingTableCanUseModules: false,
      DefaultVariant: 'Product2', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Product2', Name: 'Product2',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'WidgetA', Ammount: 1, IsStatic: false },
          { IsSpecificItem: true, Tag: null, Name: 'WidgetB', Ammount: 3, IsStatic: false }
        ],
        Products: [{ Name: 'Product2', Ammount: 1 }]
      }]
    };

    const recipeIndex = buildRecipeIndex([intermediateRecipe, widgetARecipe, widgetBRecipe, productRecipe]);
    const tagsIndex = buildTagsIndex({});

    // Product2 needs 1 WidgetA + 3 WidgetB → 4 total Intermediate → 4 graph cycles for Intermediate.
    // WidgetA needs 1 Intermediate (1 cycle). WidgetB needs 3 Intermediate (3 cycles).
    const graph = buildGraph({
      targetItem: 'Product2', totalAmount: 1, recipeIndex, tagsIndex,
      choices: emptyChoices(), globalUpgrade: 0
    });

    const testSettings: AppSettings = {
      ecoMode: 'eco13',
      edmValues: { Raw: 1 },
      edmTagDefaults: {},
      crossProfessionMarkup: 0,
      foodCostEnabled: true,
      foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
      showNodeStats: true,
    };
    const report = computeEdmReport(graph, testSettings, tagsIndex);

    // Intermediate: BaseLaborCost=1000, Smelting=basic tier=3 EDM/1k calories.
    // Food per Intermediate cycle = (1000 × 1cycle / 2) / 1000 × 3 = 1.5 EDM.
    // tableEdm for WidgetA: needs 1 Intermediate → 1 local cycle → food = 1.5 EDM.
    // tableEdm for WidgetB: needs 3 Intermediate → 3 local cycles → food = 4.5 EDM.
    // Without the fix, both would use the graph's 4-cycle count → food = 6 EDM each.
    const intermediateNode = graph.nodes.find(n => n.type === 'table' && n.id === 'table:Intermediate');
    expect(intermediateNode).toBeDefined();
    if (!intermediateNode || intermediateNode.type !== 'table') return;
    // Sanity: graph has 4 total Intermediate cycles
    expect((intermediateNode as import('$lib/types.js').TablePlannerNode).cycles).toBe(4);

    const widgetAEdmPerUnit = (report.tableEdm.get('table:WidgetA') ?? 0) / 1;
    const widgetBEdmPerUnit = (report.tableEdm.get('table:WidgetB') ?? 0) / 3;

    // Both should use 1.5 EDM food per Intermediate unit → same per-unit cost
    expect(widgetAEdmPerUnit).toBeCloseTo(widgetBEdmPerUnit, 6);
    // Raw=1 + food=1.5 per Intermediate unit
    expect(widgetAEdmPerUnit).toBeCloseTo(2.5, 6);
  });

  it('does not add work party cost for non-excluded recipes', () => {
    const normalGraph: PlannerGraph = {
      nodes: [
        {
          type: 'table',
          id: 'table:SteelBar',
          itemName: 'Steel Bar',
          table: 'Blast Furnace',
          recipe: {
            Key: 'Steel Bar',
            BaseLaborCost: 200,
            SkillNeeds: [{ Skill: 'Smelting', Level: 3 }],
          } as RecipeObject,
          variant: {
            Key: 'SteelBar',
            Name: 'Steel Bar',
            Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 2, IsStatic: false }],
            Products: [{ Name: 'Steel Bar', Ammount: 1 }]
          },
          cycles: 3,
          effectiveReduction: 0,
          appliedTalents: [],
          availableRecipes: []
        },
        { type: 'item', id: 'item:Steel Bar', itemName: 'Steel Bar', amount: 3 },
        { type: 'raw',  id: 'raw:Iron Ore',   itemName: 'Iron Ore',   amount: 6 }
      ],
      edges: [
        { id: 'e1', source: 'table:SteelBar',  target: 'item:Steel Bar' },
        { id: 'e2', source: 'raw:Iron Ore',     target: 'table:SteelBar' }
      ]
    };

    const report = computeEdmReport(normalGraph, settings, buildTagsIndex({}));
    expect(report.tableValueAdded.has('table:SteelBar')).toBe(false);
  });

  it('applies byproduct fraction when a craftable item has partial byproduct coverage so tableEdm matches totalEdm per unit', () => {
    // Container has its own primary recipe (1 Iron → 1 Container) AND is produced as a
    // byproduct by Widget (3 per cycle). Fuel consumes Container as IsStatic.
    //
    // Chain: Iron → Container ← Widget (byproduct)
    //                         Fuel (IsStatic consumer)
    //        Widget ← Fuel ← Container
    //        Product ← Widget (×2)
    //
    // For Product × 1 (needs 2 Widget cycles):
    //   8 Fuel → 32 Container gross (IsStatic, 4 per Fuel), Widget byproduces 6 → net 26
    //   item:Container: amount=26, byproductSupply=6
    //
    // tableEdm for Widget (outputAmount=1, 1 cycle):
    //   Needs 4 Fuel → 16 Container gross.
    //   Fix: fraction = 26/32 → neededAmount = 16 × 13/16 = 13 → 13 Iron → tableEdm=13.
    //   Bug (without fix): neededAmount = 16 → 16 Iron → tableEdm=16.
    //
    // Cross-check: Widget × 1 as target → 16 Container gross, 3 byproduced → net 13 → totalEdm=13.
    const containerRecipe3: RecipeObject = {
      Key: 'Container3', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Iron Workshop', CraftingTableCanUseModules: false,
      DefaultVariant: 'Container3', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Container3', Name: 'Container3',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron3', Ammount: 1, IsStatic: false }],
        Products: [{ Name: 'Container3', Ammount: 1 }]
      }]
    };
    const fuelRecipe3: RecipeObject = {
      Key: 'Fuel3', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Pump', CraftingTableCanUseModules: false,
      DefaultVariant: 'Fuel3', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Fuel3', Name: 'Fuel3',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Container3', Ammount: 4, IsStatic: true }],
        Products: [{ Name: 'Fuel3', Ammount: 1 }]
      }]
    };
    const widgetRecipe3: RecipeObject = {
      Key: 'Widget3', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Refinery', CraftingTableCanUseModules: false,
      DefaultVariant: 'Widget3', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Widget3', Name: 'Widget3',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Fuel3', Ammount: 4, IsStatic: false }],
        Products: [{ Name: 'Widget3', Ammount: 1 }, { Name: 'Container3', Ammount: 3 }]
      }]
    };
    const productRecipe3: RecipeObject = {
      Key: 'Product3', BaseCraftTime: 1, BaseLaborCost: 0, BaseXPGain: 1,
      CraftingTable: 'Assembly3', CraftingTableCanUseModules: false,
      DefaultVariant: 'Product3', NumberOfVariants: 1, SkillNeeds: [],
      Variants: [{
        Key: 'Product3', Name: 'Product3',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Widget3', Ammount: 2, IsStatic: false }],
        Products: [{ Name: 'Product3', Ammount: 1 }]
      }]
    };

    const noMarkupSettings: AppSettings = {
      ecoMode: 'eco13',
      edmValues: { Iron3: 1 },
      edmTagDefaults: {},
      crossProfessionMarkup: 0,
      foodCostEnabled: false,
      foodTierCosts: { baseline: 1, basic: 3, advanced: 8, modern: 20 },
      showNodeStats: true,
    };
    const recipeIndex3 = buildRecipeIndex([containerRecipe3, fuelRecipe3, widgetRecipe3, productRecipe3]);
    const tagsIndex3 = buildTagsIndex({});

    // Product × 1 graph: verify tableEdm for Widget uses the byproduct fraction (13, not 16)
    const productGraph = buildGraph({
      targetItem: 'Product3', totalAmount: 1, recipeIndex: recipeIndex3, tagsIndex: tagsIndex3,
      choices: emptyChoices(), globalUpgrade: 0
    });
    const productReport = computeEdmReport(productGraph, noMarkupSettings, tagsIndex3);

    // Sanity: Container3 is the net external input after inline detection clears byproductSupply.
    // The Widget3/Fuel3/Container3 loop is correctly inlined (Fuel3's only ingredient Container3
    // is covered by Widget3's byproduct), so byproductSupply is cleared by post-processing.
    const containerNode = productGraph.nodes.find(n => n.id === 'item:Container3');
    expect(containerNode).toBeDefined();
    expect((containerNode as ItemPlannerNode).amount).toBe(26);
    expect((containerNode as ItemPlannerNode).byproductSupply).toBeUndefined();

    // tableEdm for Widget3 (outputAmount=2, 2 cycles in Product3 graph):
    //   2 cycles × 4 Fuel × 4 Container = 32 gross → fraction 26/32 = 13/16
    //   → net 26 Container → 26 Iron → tableEdm = 26 (13/unit).
    //   Bug (without fix): 32 Iron → tableEdm = 32 (16/unit).
    expect(productReport.tableEdm.get('table:Widget3')).toBeCloseTo(26, 6);

    // Cross-check: Widget3 × 1 as target → tableEdm = 13 (1 cycle, fraction 13/16 applied, 13 Iron)
    // Per-unit cost must match: 26/2 === 13/1 proves tableEdm is context-independent.
    const widgetGraph = buildGraph({
      targetItem: 'Widget3', totalAmount: 1, recipeIndex: recipeIndex3, tagsIndex: tagsIndex3,
      choices: emptyChoices(), globalUpgrade: 0
    });
    const widgetReport = computeEdmReport(widgetGraph, noMarkupSettings, tagsIndex3);
    expect(widgetReport.tableEdm.get('table:Widget3')).toBeCloseTo(13, 6);
  });
});
