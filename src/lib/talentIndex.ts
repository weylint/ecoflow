import type { RecipeObject, ProfessionData, TalentEffect, AppliedTalent } from './types.js';

export type TalentIndex = Map<string, { totalReduction: number; talents: AppliedTalent[] }>;

function parseResourceCostReduction(effectStr: string | undefined): number | null {
  if (!effectStr || !effectStr.includes('resource cost')) return null;
  // Stackable talents have "(cap: X%)" — use the cap since we assume max takes
  const capMatch = effectStr.match(/\(cap:\s*([+-]?\d+(?:\.\d+)?)%\)/);
  if (capMatch) return Math.abs(parseFloat(capMatch[1])) / 100;
  const flatMatch = effectStr.match(/^([+-]?\d+(?:\.\d+)?)%/);
  if (!flatMatch) return null;
  return Math.abs(parseFloat(flatMatch[1])) / 100;
}

// All scope conditions present in the effect must be satisfied (AND logic).
function effectCoversRecipe(
  effect: TalentEffect,
  recipe: RecipeObject,
  recipeProductTags: Map<string, Set<string>>
): boolean {
  if (effect.skills) {
    if (!effect.skills.includes(recipe.SkillNeeds[0]?.Skill ?? '')) return false;
  }
  if (effect.craft_stations) {
    if (!effect.craft_stations.includes(recipe.CraftingTable)) return false;
  }
  if (effect.recipes) {
    if (!effect.recipes.includes(recipe.Key)) return false;
  }
  if (effect.item_tags) {
    const productNames = recipe.Variants.flatMap(v => v.Products.map(p => p.Name));
    const hasTaggedProduct = productNames.some(name =>
      effect.item_tags!.some(tag => recipeProductTags.get(name)?.has(tag))
    );
    if (!hasTaggedProduct) return false;
  }
  return true;
}

// Returns TalentIndex: Map<recipeKey, { totalReduction, talents }>.
// Assumes every non-penalty resource-cost talent effect is taken at maximum.
// Multiple talents on the same recipe compound multiplicatively.
export function buildTalentIndex(
  professions: ProfessionData[],
  recipes: RecipeObject[],
  tags: Record<string, string[]>
): TalentIndex {
  // Invert tags: item name → set of tag names that include it
  const recipeProductTags = new Map<string, Set<string>>();
  for (const [tagName, items] of Object.entries(tags)) {
    for (const item of items) {
      if (!recipeProductTags.has(item)) recipeProductTags.set(item, new Set());
      recipeProductTags.get(item)!.add(tagName);
    }
  }

  const multipliers = new Map<string, number>();
  const talentsByRecipe = new Map<string, AppliedTalent[]>();

  for (const profession of professions) {
    for (const skill of profession.skills) {
      for (const talent of skill.talents) {
        if (!talent.effects) continue;
        const talentName = talent.display_name.split(':')[0].trim();

        for (const effect of talent.effects) {
          if (effect.penalty) continue;
          const reduction = parseResourceCostReduction(effect.effect);
          if (reduction === null) continue;

          for (const recipe of recipes) {
            if (!effectCoversRecipe(effect, recipe, recipeProductTags)) continue;
            multipliers.set(recipe.Key, (multipliers.get(recipe.Key) ?? 1) * (1 - reduction));
            const list = talentsByRecipe.get(recipe.Key) ?? [];
            if (!list.some(t => t.name === talentName)) {
              list.push({ name: talentName, description: talent.description, reduction });
              talentsByRecipe.set(recipe.Key, list);
            }
          }
        }
      }
    }
  }

  return new Map(
    [...multipliers.entries()].map(([k, m]) => [k, {
      totalReduction: 1 - m,
      talents: talentsByRecipe.get(k) ?? []
    }])
  );
}
