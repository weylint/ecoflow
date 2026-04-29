// ── Raw JSON types ─────────────────────────────────────────────────
export interface RecipeFile { Recipes: RecipeObject[] }
export interface RecipeObject {
  Key: string;
  Untranslated?: string;
  BaseCraftTime: number;
  BaseLaborCost: number;
  BaseXPGain: number;
  CraftingTable: string;
  CraftingTableCanUseModules: boolean;
  DefaultVariant: string;
  NumberOfVariants: number;
  SkillNeeds: SkillRequirement[];
  Variants: Variant[];
}
export interface SkillRequirement { Skill: string; Level: number }
export interface Variant {
  Key: string;
  Name: string;
  Ingredients: Ingredient[];
  Products: Product[];
}
export interface Ingredient {
  IsSpecificItem: boolean;
  Tag: string | null;
  Name: string;
  Ammount: number;   // intentional double-m
  IsStatic: boolean;
}
export interface Product { Name: string; Ammount: number }  // intentional double-m

// ── Tags JSON type ─────────────────────────────────────────────────
export interface TagsFile { Tags: Record<string, string[]> }

// ── Upgrade levels ─────────────────────────────────────────────────
export const ECO12_UPGRADE_LEVELS = [
  { label: 'Upgrade 0', value: 0 },
  { label: 'Upgrade 1', value: 0.15 },
  { label: 'Upgrade 2', value: 0.25 },
  { label: 'Upgrade 3', value: 0.40 },
  { label: 'Upgrade 4', value: 0.45 },
  { label: 'Upgrade 5', value: 0.50 },
] as const;

export const ECO13_UPGRADE_LEVELS = [
  { label: 'Upgrade 0', value: 0 },
  { label: 'Upgrade 1', value: 0.05 },
  { label: 'Upgrade 2', value: 0.10 },
  { label: 'Upgrade 3', value: 0.15 },
  { label: 'Upgrade 4', value: 0.20 },
  { label: 'Upgrade 5', value: 0.25 },
] as const;

export function getUpgradeLevels(mode: 'eco12' | 'eco13') {
  return mode === 'eco13' ? ECO13_UPGRADE_LEVELS : ECO12_UPGRADE_LEVELS;
}

// Byproducts that are waste products and should never satisfy tag requirements
export const EXCLUDED_BYPRODUCTS = new Set(['Garbage', 'Wet Tailings', 'Tailings']);

// Recipes that are intentionally multi-profession and should not incur cross-profession markup
// on their own inputs (the chains feeding into them are still marked up normally).
export const EDM_MARKUP_EXCLUDED_RECIPES = new Set([
  'Laser',
  'Laser Upgrade',
  'Laser Internals',
  'Laser Body',
  'Final Assembly Instructions',
  'Exquisite Meal',
  'Premium Meal',
  'Enhanced Precision Tools',
  'Laser Blueprint',
  'Special Alloy',
  'Enhanced Meal',
  'Balanced Meal',
  'Precision Tools',
  // Profession upgrade recipes that feed into Laser Upgrade (produced from Adv/Basic/Modern Upgrade 4)
  'Advanced Baking Upgrade',
  'Advanced Cooking Upgrade',
  'Advanced Masonry Upgrade',
  'Advanced Smelting Upgrade',
  'Baking Upgrade',
  'Basic Engineering Upgrade',
  'Blacksmith Upgrade',
  'Butchery Upgrade',
  'Campfire Cooking Upgrade',
  'Carpentry Advanced Upgrade',
  'Composites Upgrade',
  'Cooking Upgrade',
  'Electronics Upgrade',
  'Farming Upgrade',
  'Fertilizers Upgrade',
  'Gathering Advanced Upgrade',
  'Glassworking Modern Upgrade',
  'Hunting Upgrade',
  'Industry Upgrade',
  'Logging Advanced Upgrade',
  'Masonry Advanced Upgrade',
  'Mechanics Modern Upgrade',
  'Milling Upgrade',
  'Mining Advanced Upgrade',
  'Oil Drilling Upgrade',
  'Painting Upgrade',
  'Paper Milling Upgrade',
  'Pottery Upgrade',
  'Shipwright Basic Upgrade',
  'Smelting Upgrade',
  'Tailoring Basic Upgrade',
]);

// Default recipe key for specific items (overrides recipeIndex sort order)
export const DEFAULT_RECIPE_CHOICES: Record<string, string> = {
  'Raw Fish': 'Clean Medium Fish',
};

// Items that are bought/gathered by default rather than crafted
export const DEFAULT_MARKET_ITEMS: string[] = [];

// Items forced to raw nodes even when a recipe exists (gathered, not craftable in practice)
export const RAW_OVERRIDES: Set<string> = new Set(['Dirt', 'Plant Fibers']);

// Default item selections for common tags
export const DEFAULT_TAG_CHOICES: Record<string, string> = {
  'Fat':              'Oil',
  'Wood':             'Redwood Log',
  'Medium Fish':      'Salmon',
  'Raw Food':         'Tomato',
  'Campfire Salad':   'Beet Campfire Salad',
  'Tiny Leather Carcass': 'Turkey Carcass',
  'Greens':           'Fiddleheads',
  'Tiny Fur Carcass': 'Otter Carcass',
  'Petals':           'Rose',
  'Vegetable':        'Tomato',
  'Grain':            'Wheat',
  'Silica':           'Crushed Sandstone',
  'Fruit':            'Huckleberries',
  'Natural Fiber':    'Plant Fibers',
  'Mortared Stone':   'Mortared Stone',
  'Rock':             'Sandstone',
  'Crop Seed':        'Flax Seed',
  'Crushed Rock':     'Crushed Sandstone',
  'Fried Vegetable':  'Fried Tomatoes',
  'Ore':              'Iron Ore',
  'Salad':            'Fruit Salad',
  'Baked Vegetable':  'Baked Tomato',
  'Wood Board':       'Board',
  'Hewn Log':         'Hewn Log',
  'Composite Lumber': 'Composite Lumber',
  'Lumber':           'Lumber',
  'Basic Research':   'Geology Research Paper Basic',
  'Ashlar Stone':       'Ashlar Sandstone',
  'Fertilizer Filler':  'Pulp Filler',
  'Oil':                'Oil',
  'Fungus':             'Crimini Mushrooms',
};

export interface LayoutOptions {
  thoroughness: number;
  nodePlacement: 'BRANDES_KOPP' | 'LINEAR_SEGMENTS' | 'NETWORK_SIMPLEX';
  direction: 'RIGHT' | 'DOWN';
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  thoroughness: 7,
  nodePlacement: 'BRANDES_KOPP',
  direction: 'RIGHT'
};

// ── Planner graph types ────────────────────────────────────────────
export type PlannerNodeType = 'table' | 'item' | 'raw' | 'tag';

export interface AppliedTalent {
  name: string;        // display_name stripped of ": SkillName" suffix
  description: string;
  reduction: number;   // this talent's stated reduction fraction (e.g. 0.60)
}

export interface IngredientStats {
  name: string;
  amount: number;      // total across all cycles, post-reduction
  edmPerUnit: number | null;
  totalEdm: number | null;
}

export interface ProductStats {
  name: string;
  amount: number;      // product.Ammount * cycles
  edmPerUnit: number | null;
  totalEdm: number | null;
}

export interface InlinedProduction {
  itemName: string;           // e.g. "Petroleum"
  producerTable: string;      // e.g. "Pump Jack"
  recipe: RecipeObject;
  variant: Variant;
  cycles: number;             // producer cycles needed for this plan
  upgradeReduction: number;
  talentReduction: number;
  effectiveReduction: number;
  appliedTalents: AppliedTalent[];
  grossIngredients: { name: string; amount: number; isStatic: boolean }[];
  netIngredients: { name: string; amount: number }[];
}

export interface TablePlannerNode {
  type: 'table';
  id: string;
  itemName: string;         // the item this table node is producing
  table: string;
  recipe: RecipeObject;
  variant: Variant;
  cycles: number;           // ceil(requiredAmount / productAmount)
  upgradeReduction?: number;
  talentReduction?: number;
  effectiveReduction: number;
  appliedTalents: AppliedTalent[];
  availableRecipes: RecipeObject[];
  loopbackItems?: { itemName: string; grossAmount: number; returnAmount: number; netAmount: number }[];
  inlinedProductions?: InlinedProduction[];
  valueAdded?: number | null;
}
export interface ItemPlannerNode {
  type: 'item';
  id: string;
  itemName: string;
  amount: number;             // net amount still needed (after byproduct coverage)
  byproductSupply?: number;   // amount covered by byproducts (omitted when zero)
}
export interface RawPlannerNode {
  type: 'raw';
  id: string;
  itemName: string;
  amount: number;              // net amount (after byproduct coverage)
  byproductSupply?: number;    // amount covered by byproducts (omitted when zero)
}
export interface TagPlannerNode {
  type: 'tag';
  id: string;
  tag: string;
  amount: number;           // net remaining after byproduct coverage
  availableItems: string[];
  selectedItem: string | null;  // user-explicit choice only (not auto-byproduct)
  byproductContributors?: { itemName: string; contribution: number }[];  // auto-resolved byproducts
  craftableItems: string[];     // subset of availableItems that have recipes
}
export interface MarketPlannerNode {
  type: 'market';
  id: string;
  itemName: string;
  amount: number;              // net amount (after byproduct coverage)
  byproductSupply?: number;    // amount covered by byproducts (omitted when zero)
  availableRecipes: RecipeObject[];  // so user can switch back to crafting
}
// Resolution option for a byproduct: one way to use it (directly or via a crafting recipe)
export interface ByproductResolveOption {
  outputItem: string;           // item that satisfies the tag (may equal itemName for direct)
  tag: string;                  // unresolved tag this would satisfy
  tagAmount: number;
  via?: { tableName: string };  // undefined = direct tag match; set = crafted first
}

export interface ByproductPlannerNode {
  type: 'byproduct';
  id: string;
  itemName: string;
  amount: number;   // cycles × product.Ammount
}
export type PlannerNode = TablePlannerNode | ItemPlannerNode | RawPlannerNode | TagPlannerNode | MarketPlannerNode | ByproductPlannerNode;

export interface PlannerEdge {
  id: string;
  source: string;   // node id
  target: string;   // node id
}

export interface PlannerGraph {
  nodes: PlannerNode[];
  edges: PlannerEdge[];
}

// ── User choices (reactive state) ─────────────────────────────────
export interface UserChoices {
  recipeByItem: Map<string, RecipeObject>;    // item name → chosen recipe
  variantByItem: Map<string, Variant>;        // item name → chosen variant
  itemByTag: Map<string, string>;             // tag name → chosen specific item
  marketItems: Set<string>;                   // items to buy instead of craft
  upgradeByTable: Map<string, number>;        // CraftingTable name → reduction fraction
}

export interface TalentEffect {
  effect?: string;
  penalty: boolean;
  skills?: string[];
  recipes?: string[];
  craft_stations?: string[];
  item_tags?: string[];
  unlocks?: string[];
}

export interface TalentEntry {
  display_name: string;
  description: string;
  level: number;
  class: string;
  max_takes: number;
  effects?: TalentEffect[];
}

export interface ProfessionSkill {
  skill: string;
  talents: TalentEntry[];
}

export interface ProfessionData {
  profession: string;
  source_file: string;
  skills: ProfessionSkill[];
}
