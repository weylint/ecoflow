import type { Ingredient, TablePlannerNode } from './types.js';

type ReductionSource = Pick<TablePlannerNode, 'effectiveReduction'> & Partial<Pick<TablePlannerNode, 'upgradeReduction' | 'talentReduction'>>;

export function ingredientReductionMultiplier(ingredient: Ingredient, source: ReductionSource): number {
  const upgradeReduction = source.upgradeReduction ?? source.effectiveReduction ?? 0;
  const talentReduction = source.talentReduction ?? 0;
  return (ingredient.IsStatic ? 1 : (1 - upgradeReduction)) * (1 - talentReduction);
}

export function ingredientAmountPerCycle(ingredient: Ingredient, source: ReductionSource): number {
  return ingredient.Ammount * ingredientReductionMultiplier(ingredient, source);
}
