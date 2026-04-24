import { describe, it, expect } from 'vitest';
import { buildTalentIndex } from '$lib/talentIndex.js';
import type { RecipeObject, ProfessionData } from '$lib/types.js';

const lumberRecipe: RecipeObject = {
  Key: 'Lumber',
  Untranslated: 'Lumber Recipe',
  BaseCraftTime: 1, BaseLaborCost: 10, BaseXPGain: 1,
  CraftingTable: 'Sawmill', CraftingTableCanUseModules: false,
  DefaultVariant: 'Lumber', NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Carpentry', Level: 1 }],
  Variants: [{ Key: 'Lumber', Name: 'Lumber',
    Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Hewn Log', Ammount: 1, IsStatic: false }],
    Products: [{ Name: 'Lumber', Ammount: 1 }] }]
};

const lumberDresserRecipe: RecipeObject = {
  Key: 'Lumber Dresser',
  Untranslated: 'Lumber Dresser Recipe',
  BaseCraftTime: 2, BaseLaborCost: 20, BaseXPGain: 2,
  CraftingTable: 'Sawmill', CraftingTableCanUseModules: false,
  DefaultVariant: 'Lumber Dresser', NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Carpentry', Level: 5 }],
  Variants: [{ Key: 'Lumber Dresser', Name: 'Lumber Dresser',
    Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Lumber', Ammount: 6, IsStatic: false }],
    Products: [{ Name: 'Lumber Dresser', Ammount: 1 }] }]
};

const largeLumberStockpileRecipe: RecipeObject = {
  Key: 'Large Lumber Stockpile',
  Untranslated: 'Large Lumber Stockpile Recipe',
  BaseCraftTime: 12, BaseLaborCost: 1200, BaseXPGain: 3,
  CraftingTable: 'Sawmill', CraftingTableCanUseModules: true,
  DefaultVariant: 'Large Lumber Stockpile', NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Carpentry', Level: 5 }],
  Variants: [{ Key: 'LargeLumberStockpile', Name: 'Large Lumber Stockpile',
    Ingredients: [
      { IsSpecificItem: false, Tag: 'Lumber', Name: '', Ammount: 20, IsStatic: false },
      { IsSpecificItem: false, Tag: 'Wood Board', Name: '', Ammount: 15, IsStatic: false }
    ],
    Products: [{ Name: 'Large Lumber Stockpile', Ammount: 1 }] }]
};

const steelBarRecipe: RecipeObject = {
  Key: 'Steel Bar',
  Untranslated: 'Steel Bar Recipe',
  BaseCraftTime: 3, BaseLaborCost: 30, BaseXPGain: 3,
  CraftingTable: 'Blast Furnace', CraftingTableCanUseModules: false,
  DefaultVariant: 'Steel Bar', NumberOfVariants: 1,
  SkillNeeds: [{ Skill: 'Advanced Smelting', Level: 1 }],
  Variants: [{ Key: 'Steel Bar', Name: 'Steel Bar',
    Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 4, IsStatic: false }],
    Products: [{ Name: 'Steel Bar', Ammount: 1 }] }]
};

// Tags: Housing contains Lumber Dresser; Lumber contains Lumber
const testTags: Record<string, string[]> = {
  Housing: ['Lumber Dresser'],
  Lumber: ['Lumber', 'Hardwood Lumber', 'Softwood Lumber'],
};

// Fine Carpentry: -60% for Housing items made with Carpentry
// Lumber Investment: -40% for Lumber items made with Carpentry
// Smelt Boost: -10% for all Advanced Smelting recipes
const testProfessions: ProfessionData[] = [
  {
    profession: 'Carpenter',
    source_file: 'test',
    skills: [{
      skill: 'Carpentry',
      talents: [
        {
          display_name: 'Fine Carpentry: Carpentry',
          description: '',
          level: 3,
          class: 'CarpentryFineCarpentryTalentGroup',
          max_takes: 5,
          effects: [{
            effect: '-12% resource cost per take (cap: -60%)',
            penalty: false,
            skills: ['Carpentry'],
            item_tags: ['Housing']
          }]
        },
        {
          display_name: 'Lumber Investment: Carpentry',
          description: '',
          level: 3,
          class: 'CarpentryLumberInvestmentTalentGroup',
          max_takes: 5,
          effects: [{
            effect: '-8% resource cost per take (cap: -40%)',
            penalty: false,
            skills: ['Carpentry'],
            item_tags: ['Lumber']
          }]
        }
      ]
    }]
  },
  {
    profession: 'Smith',
    source_file: 'test',
    skills: [{
      skill: 'Advanced Smelting',
      talents: [{
        display_name: 'Smelt Boost: AdvancedSmelting',
        description: '',
        level: 3,
        class: 'SmeltBoostTalentGroup',
        max_takes: 1,
        effects: [{
          effect: '-10% resource cost',
          penalty: false,
          skills: ['Advanced Smelting']
        }]
      }]
    }]
  }
];

describe('buildTalentIndex', () => {
  it('Lumber gets only Lumber Investment (40%) — Fine Carpentry targets Housing, not Lumber', () => {
    const index = buildTalentIndex(testProfessions, [lumberRecipe, lumberDresserRecipe, steelBarRecipe], testTags);
    expect(index.get('Lumber')?.totalReduction).toBeCloseTo(0.40);
    expect(index.get('Lumber')?.talents).toHaveLength(1);
    expect(index.get('Lumber')?.talents[0].name).toBe('Lumber Investment');
  });

  it('Lumber Dresser gets only Fine Carpentry (60%) — Lumber Investment targets Lumber, not Housing', () => {
    const index = buildTalentIndex(testProfessions, [lumberRecipe, lumberDresserRecipe, steelBarRecipe], testTags);
    expect(index.get('Lumber Dresser')?.totalReduction).toBeCloseTo(0.60);
    expect(index.get('Lumber Dresser')?.talents).toHaveLength(1);
    expect(index.get('Lumber Dresser')?.talents[0].name).toBe('Fine Carpentry');
  });

  it('Large Lumber Stockpile gets no direct talent reduction — it is neither Housing nor Lumber', () => {
    const recipes = [lumberRecipe, lumberDresserRecipe, largeLumberStockpileRecipe, steelBarRecipe];
    const index = buildTalentIndex(testProfessions, recipes, testTags);
    // The stockpile recipe itself has no reduction; the Lumber ingredient is cheaper
    // because the Lumber recipe (a separate node) carries the 40% Lumber Investment reduction.
    expect(index.get('Large Lumber Stockpile')).toBeUndefined();
  });

  it('Steel Bar (Advanced Smelting) is not affected by Carpentry talents', () => {
    const index = buildTalentIndex(testProfessions, [lumberRecipe, lumberDresserRecipe, steelBarRecipe], testTags);
    expect(index.get('Steel Bar')?.totalReduction).toBeCloseTo(0.10);
    expect(index.get('Steel Bar')?.talents[0].name).toBe('Smelt Boost');
  });
});
