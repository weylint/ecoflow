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

// slabRecipe: 2 Stone → 1 Stone Slab + 2 Crushed Granite (byproduct)
export const slabRecipe: RecipeObject = {
  Key: 'StoneSlab',
  Untranslated: 'Stone Slab Recipe',
  BaseCraftTime: 2,
  BaseLaborCost: 10,
  BaseXPGain: 1,
  CraftingTable: 'Masonry Table',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Stone Slab',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'StoneSlab',
    Name: 'Stone Slab',
    Ingredients: [
      { IsSpecificItem: true, Tag: null, Name: 'Stone', Ammount: 2, IsStatic: false }
    ],
    Products: [
      { Name: 'Stone Slab', Ammount: 1 },
      { Name: 'Crushed Granite', Ammount: 2 }
    ]
  }]
};

// pathRecipe: needs tag "Crushed Rock" (2/cycle) → 1 Stone Path
export const pathRecipe: RecipeObject = {
  Key: 'StonePath',
  Untranslated: 'Stone Path Recipe',
  BaseCraftTime: 1,
  BaseLaborCost: 5,
  BaseXPGain: 0.5,
  CraftingTable: 'Masonry Table',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Stone Path',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'StonePath',
    Name: 'Stone Path',
    Ingredients: [
      { IsSpecificItem: false, Tag: 'Crushed Rock', Name: '', Ammount: 2, IsStatic: false }
    ],
    Products: [{ Name: 'Stone Path', Ammount: 1 }]
  }]
};

// tags: 'Crushed Rock' includes 'Crushed Granite' and 'Crushed Sandstone'
export const crushedRockTags: Record<string, string[]> = {
  'Crushed Rock': ['Crushed Granite', 'Crushed Sandstone']
};

// multiVariantRecipe: models Composite Lumber — one recipe with 3 variants, each
// producing a different primary product. Only "Composite Lumber" is the default variant.
export const multiVariantRecipe: RecipeObject = {
  Key: 'CompositeLumber',
  Untranslated: 'Composite Lumber Recipe',
  BaseCraftTime: 2,
  BaseLaborCost: 10,
  BaseXPGain: 1,
  CraftingTable: 'Carpentry Table',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Composite Lumber',
  NumberOfVariants: 3,
  SkillNeeds: [],
  Variants: [
    {
      Key: 'CompositeLumber',
      Name: 'Composite Lumber',
      Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Wood Pulp', Ammount: 2, IsStatic: false }],
      Products: [{ Name: 'Composite Lumber', Ammount: 1 }]
    },
    {
      Key: 'CompositeOakLumber',
      Name: 'Composite Oak Lumber',
      Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Oak Log', Ammount: 2, IsStatic: false }],
      Products: [{ Name: 'Composite Oak Lumber', Ammount: 1 }]
    },
    {
      Key: 'CompositeSpruceLumber',
      Name: 'Composite Spruce Lumber',
      Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Spruce Log', Ammount: 2, IsStatic: false }],
      Products: [{ Name: 'Composite Spruce Lumber', Ammount: 1 }]
    }
  ]
};

// byproductOnlyRecipe: models Butcher recipes — "Wool" is a secondary product that is
// never Products[0] in any variant. It should NOT appear in allCraftableNames.
export const byproductOnlyRecipe: RecipeObject = {
  Key: 'ButcherSheep',
  Untranslated: 'Butcher Sheep Recipe',
  BaseCraftTime: 3,
  BaseLaborCost: 15,
  BaseXPGain: 1,
  CraftingTable: 'Butchery Table',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Butcher Sheep',
  NumberOfVariants: 1,
  SkillNeeds: [],
  Variants: [{
    Key: 'ButcherSheep',
    Name: 'Butcher Sheep',
    Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Sheep Carcass', Ammount: 1, IsStatic: false }],
    Products: [
      { Name: 'Raw Meat', Ammount: 5 },
      { Name: 'Wool', Ammount: 2 }
    ]
  }]
};
