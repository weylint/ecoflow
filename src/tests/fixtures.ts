import type { RecipeObject } from '$lib/types.js';

export const simpleRecipe: RecipeObject = {
  Key: 'IronBar',
  Untranslated: 'Iron Bar Recipe',
  BaseCraftTime: 2,
  BaseLaborCost: 10,
  BaseXPGain: 1,
  CraftingTable: 'Bloomery',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Iron Bar',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'IronBar',
    Name: 'Iron Bar',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 2, IsStatic: false }
    ],
    Products: [{ Name: 'Iron Bar', Ammount: 1 }]
  }]
};

export const tagRecipe: RecipeObject = {
  Key: 'WoodenPlank',
  Untranslated: 'Wooden Plank Recipe',
  BaseCraftTime: 1,
  BaseLaborCost: 5,
  BaseXPGain: 0.5,
  CraftingTable: 'Carpentry Table',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Wooden Plank',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'WoodenPlank',
    Name: 'Wooden Plank',
    Ingredients: [
      { IsSpecificItem: false, Tag: 'Wood', Name: '', Ammount: 3, IsStatic: false }
    ],
    Products: [{ Name: 'Wooden Plank', Ammount: 2 }]
  }]
};

export const multiProductRecipe: RecipeObject = {
  Key: 'SteelBar',
  Untranslated: 'Steel Bar Recipe',
  BaseCraftTime: 5,
  BaseLaborCost: 30,
  BaseXPGain: 2,
  CraftingTable: 'Blast Furnace',
  CraftingTableCanUseModules: true,
  DefaultVariant: 'Steel Bar',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'SteelBar',
    Name: 'Steel Bar',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Iron Bar', Ammount: 4, IsStatic: false },
      { IsSpecificItem: true, Tag: null, Name: 'Coal', Ammount: 1, IsStatic: true }
    ],
    Products: [
      { Name: 'Steel Bar', Ammount: 4 },
      { Name: 'Slag', Ammount: 1 }
    ]
  }]
};

export const multiRecipeItem: RecipeObject = {
  Key: 'IronBar2',
  Untranslated: 'Iron Bar Recipe 2',
  BaseCraftTime: 3,
  BaseLaborCost: 15,
  BaseXPGain: 1.5,
  CraftingTable: 'Electric Smelter',
  CraftingTableCanUseModules: true,
  DefaultVariant: 'Iron Bar',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'IronBar2',
    Name: 'Iron Bar',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 1.5, IsStatic: false }
    ],
    Products: [{ Name: 'Iron Bar', Ammount: 1 }]
  }]
};

// Widget uses Steel Bar (which produces Slag as byproduct) AND Slag itself.
// Planning Widget exercises byproduct-feeds-back-into-chain logic.
export const widgetRecipe: RecipeObject = {
  Key: 'Widget',
  Untranslated: 'Widget Recipe',
  BaseCraftTime: 2,
  BaseLaborCost: 10,
  BaseXPGain: 1,
  CraftingTable: 'Factory',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Widget',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'Widget',
    Name: 'Widget',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Steel Bar', Ammount: 4, IsStatic: false },
      { IsSpecificItem: true, Tag: null, Name: 'Slag',      Ammount: 1, IsStatic: false }
    ],
    Products: [{ Name: 'Widget', Ammount: 1 }]
  }]
};

export const sampleTags: Record<string, string[]> = {
  'Wood': ['Birch Log', 'Oak Log', 'Pine Log']
};
