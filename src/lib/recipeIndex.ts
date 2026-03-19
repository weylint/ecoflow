import type { RecipeObject } from './types.js';

export interface RecipeIndex {
  byProduct: Map<string, RecipeObject[]>;
  byIngredient: Map<string, RecipeObject[]>;  // item name → recipes that consume it
  allCraftableNames: string[];
}

export function buildRecipeIndex(recipes: RecipeObject[]): RecipeIndex {
  const byProduct = new Map<string, RecipeObject[]>();

  for (const recipe of recipes) {
    const defaultVariant =
      recipe.Variants.find(v => v.Name === recipe.DefaultVariant) ??
      recipe.Variants[0];

    if (!defaultVariant) continue;

    for (const product of defaultVariant.Products) {
      const list = byProduct.get(product.Name) ?? [];
      list.push(recipe);
      byProduct.set(product.Name, list);
    }
  }

  // Sort each recipe list so the best default comes first:
  // 1. Recipes where this item is the primary (first) product outrank byproduct recipes.
  // 2. De-prioritize the Bioplastic recipe (produces Plastic from Corn — rarely the intended default).
  // 3. Higher primary-output / total-input ratio first (more efficient recipe wins).
  // 4. Shorter BaseCraftTime as tie-break.
  for (const [itemName, list] of byProduct) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      const va = a.Variants.find(v => v.Name === a.DefaultVariant) ?? a.Variants[0];
      const vb = b.Variants.find(v => v.Name === b.DefaultVariant) ?? b.Variants[0];

      // 1. Primary product rank
      const rankA = va.Products[0]?.Name === itemName ? 0 : 1;
      const rankB = vb.Products[0]?.Name === itemName ? 0 : 1;
      if (rankA !== rankB) return rankA - rankB;

      // 2. De-prioritize the Bioplastic recipe explicitly
      const bioA = a.Key === 'Bioplastic' ? 1 : 0;
      const bioB = b.Key === 'Bioplastic' ? 1 : 0;
      if (bioA !== bioB) return bioA - bioB;

      // 3. Higher primary-output / total-input ratio first
      const primaryA = va.Products.find(p => p.Name === itemName)?.Ammount ?? 0;
      const primaryB = vb.Products.find(p => p.Name === itemName)?.Ammount ?? 0;
      const totalInA = va.Ingredients.reduce((s, i) => s + i.Ammount, 0);
      const totalInB = vb.Ingredients.reduce((s, i) => s + i.Ammount, 0);
      const rateA = totalInA > 0 ? primaryA / totalInA : 0;
      const rateB = totalInB > 0 ? primaryB / totalInB : 0;
      if (rateA !== rateB) return rateB - rateA;

      // 4. Shorter BaseCraftTime first
      return a.BaseCraftTime - b.BaseCraftTime;
    });
  }

  const byIngredient = new Map<string, RecipeObject[]>();
  for (const recipe of recipes) {
    const defaultVariant =
      recipe.Variants.find(v => v.Name === recipe.DefaultVariant) ??
      recipe.Variants[0];
    if (!defaultVariant) continue;
    for (const ingredient of defaultVariant.Ingredients) {
      if (!ingredient.IsSpecificItem) continue;
      const list = byIngredient.get(ingredient.Name) ?? [];
      list.push(recipe);
      byIngredient.set(ingredient.Name, list);
    }
  }

  return {
    byProduct,
    byIngredient,
    allCraftableNames: [...byProduct.keys()].sort()
  };
}
