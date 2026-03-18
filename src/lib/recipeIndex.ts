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

  // Sort each recipe list so the best default comes first:
  // 1. Recipes where this item is the primary (first) product outrank byproduct recipes.
  // 2. Within that group, prefer fewer craftable ingredients (i.e. closer to raw).
  for (const [itemName, list] of byProduct) {
    if (list.length < 2) continue;
    list.sort((a, b) => {
      const va = a.Variants.find(v => v.Name === a.DefaultVariant) ?? a.Variants[0];
      const vb = b.Variants.find(v => v.Name === b.DefaultVariant) ?? b.Variants[0];
      const rankA = (va.Products[0]?.Name === itemName ? 0 : 1);
      const rankB = (vb.Products[0]?.Name === itemName ? 0 : 1);
      if (rankA !== rankB) return rankA - rankB;
      const craftA = va.Ingredients.filter(i => i.IsSpecificItem && byProduct.has(i.Name)).length;
      const craftB = vb.Ingredients.filter(i => i.IsSpecificItem && byProduct.has(i.Name)).length;
      return craftA - craftB;
    });
  }

  return {
    byProduct,
    allCraftableNames: [...byProduct.keys()].sort()
  };
}
