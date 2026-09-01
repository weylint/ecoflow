import type {
  AppliedModule, AppliedTalent, EcoMode, ModuleSlot, PlannerEdge, PlannerGraph, PlannerNode,
} from './types.js';
import type { EdmReport } from './edm.js';

/**
 * The plan as machine-readable JSON — the same document from the CLI's `--json`
 * and from `window.ecoPlanner.getPlan()`, built here once so the two can never
 * drift. The app is `adapter-static`, so there is no server route to ask; this
 * is the interface an agent gets instead.
 *
 * Node ids are the planner's own `table:Name` / `item:Name` / `tag:Name` scheme,
 * which is also the DOM's, so a JSON node and a rendered card share a key.
 * Numbers are raw, never locale-formatted.
 */
export interface PlanExportMeta {
  ecoMode: EcoMode;
  targetItem: string;
  amount: number;
  moduleSlots?: ModuleSlot[];   // eco14 / sandbox
  globalUpgrade?: number;       // eco12 / eco13
  priceSetId: string;
  generatedAt: string;
}

export interface ExportedTableNode {
  type: 'table';
  id: string;
  itemName: string;
  table: string;
  recipeKey: string;
  recipeName: string;
  variant: string;
  skill: string | null;
  cycles: number;
  craftTimeSeconds: number;
  laborCost: number;
  effectiveReduction: number;
  upgradeReduction: number | null;
  talentReduction: number | null;
  appliedModules: AppliedModule[];
  appliedTalents: AppliedTalent[];
  availableRecipeKeys: string[];
  ingredients: { name: string; tag: string | null; amount: number; isStatic: boolean }[];
  products: { name: string; amount: number }[];
  loopbackItems: { itemName: string; grossAmount: number; returnAmount: number; netAmount: number }[];
  edm: number | null;
  valueAdded: number | null;
}

export interface ExportedSimpleNode {
  type: 'item' | 'raw' | 'market' | 'byproduct' | 'product';
  id: string;
  itemName: string;
  amount: number;
  byproductSupply?: number;
  producedAmount?: number;
  edm: number | null;
}

export interface ExportedTagNode {
  type: 'tag';
  id: string;
  tag: string;
  amount: number;
  selectedItem: string | null;
  availableItems: string[];
  craftableItems: string[];
  byproductContributors: { itemName: string; contribution: number }[];
  edm: number | null;
}

export type ExportedNode = ExportedTableNode | ExportedSimpleNode | ExportedTagNode;

export interface PlanExport {
  meta: PlanExportMeta;
  overrides: string;   // the `ov` string that reproduces this plan
  plan: { nodes: ExportedNode[]; edges: PlannerEdge[] };
  edm: {
    baseEdm: number | null;
    laborFoodEdm: number | null;
    markupEdm: number | null;
    totalEdm: number | null;
    missingItems: string[];
    rawCosts: EdmReport['rawCosts'];
    crossProfTransitions: { itemName: string; fromProf: string; toProf: string; baseEdm: number | null; markupAmount: number | null }[];
  };
}

function exportNode(node: PlannerNode, report: EdmReport | null): ExportedNode {
  const edm = report?.nodeEdm.get(node.id) ?? null;
  if (node.type === 'table') {
    return {
      type: 'table',
      id: node.id,
      itemName: node.itemName,
      table: node.table,
      recipeKey: node.recipe.Key,
      recipeName: node.recipe.DefaultVariant,
      variant: node.variant.Name,
      skill: node.recipe.SkillNeeds[0]?.Skill ?? null,
      cycles: node.cycles,
      craftTimeSeconds: node.recipe.BaseCraftTime * 60 * node.cycles * (1 - (node.upgradeReduction ?? 0)),
      laborCost: node.recipe.BaseLaborCost * node.cycles,
      effectiveReduction: node.effectiveReduction,
      upgradeReduction: node.upgradeReduction ?? null,
      talentReduction: node.talentReduction ?? null,
      appliedModules: node.appliedModules ?? [],
      appliedTalents: node.appliedTalents ?? [],
      availableRecipeKeys: node.availableRecipes.map(r => r.Key),
      ingredients: node.variant.Ingredients.map(i => ({
        name: i.Name, tag: i.Tag, amount: i.Ammount * node.cycles, isStatic: i.IsStatic,
      })),
      products: node.variant.Products.map(p => ({ name: p.Name, amount: p.Ammount * node.cycles })),
      loopbackItems: node.loopbackItems ?? [],
      edm: report?.tableEdm.get(node.id) ?? edm,
      valueAdded: report?.tableValueAdded.get(node.id) ?? node.valueAdded ?? null,
    };
  }
  if (node.type === 'tag') {
    return {
      type: 'tag',
      id: node.id,
      tag: node.tag,
      amount: node.amount,
      selectedItem: node.selectedItem,
      availableItems: node.availableItems,
      craftableItems: node.craftableItems,
      byproductContributors: node.byproductContributors ?? [],
      edm,
    };
  }
  return {
    type: node.type,
    id: node.id,
    itemName: node.itemName,
    amount: node.amount,
    ...('byproductSupply' in node && node.byproductSupply !== undefined
      ? { byproductSupply: node.byproductSupply } : {}),
    ...(node.type === 'product' ? { producedAmount: node.producedAmount } : {}),
    edm,
  };
}

export function buildPlanExport(
  graph: PlannerGraph,
  report: EdmReport | null,
  meta: PlanExportMeta,
  overrides = ''
): PlanExport {
  return {
    meta,
    overrides,
    plan: {
      nodes: graph.nodes.map(n => exportNode(n, report)),
      edges: graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target })),
    },
    edm: {
      baseEdm: report?.baseEdm ?? null,
      laborFoodEdm: report?.laborFoodEdm ?? null,
      markupEdm: report?.markupEdm ?? null,
      totalEdm: report?.totalEdm ?? null,
      missingItems: report?.missingItems ?? [],
      rawCosts: report?.rawCosts ?? [],
      // The full path entries behind each transition are a debugging view, not an
      // interface; --verbose still prints them.
      crossProfTransitions: (report?.crossProfTransitions ?? []).map(t => ({
        itemName: t.itemName, fromProf: t.fromProf, toProf: t.toProf,
        baseEdm: t.baseEdm, markupAmount: t.markupAmount,
      })),
    },
  };
}
