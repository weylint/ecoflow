import type { RecipeObject } from './types.js';

export interface RecipeIndex {
  byProduct: Map<string, RecipeObject[]>;
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

  return {
    byProduct,
    allCraftableNames: [...byProduct.keys()].sort()
  };
}
