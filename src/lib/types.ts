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

// ── Planner graph types ────────────────────────────────────────────
export type PlannerNodeType = 'table' | 'item' | 'raw' | 'tag';

export interface TablePlannerNode {
  type: 'table';
  id: string;
  itemName: string;         // the item this table node is producing
  table: string;
  recipe: RecipeObject;
  variant: Variant;
  cycles: number;           // ceil(requiredAmount / productAmount)
  availableRecipes: RecipeObject[];
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
  amount: number;
}
export interface TagPlannerNode {
  type: 'tag';
  id: string;
  tag: string;
  amount: number;
  availableItems: string[];
  selectedItem: string | null;
}
export interface MarketPlannerNode {
  type: 'market';
  id: string;
  itemName: string;
  amount: number;
  availableRecipes: RecipeObject[];  // so user can switch back to crafting
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
}
