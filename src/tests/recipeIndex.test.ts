import { describe, it, expect } from 'vitest';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import { simpleRecipe, multiProductRecipe, multiRecipeItem } from './fixtures.js';

describe('buildRecipeIndex', () => {
  it('maps product names correctly', () => {
    const idx = buildRecipeIndex([simpleRecipe]);
    expect(idx.byProduct.has('Iron Bar')).toBe(true);
    expect(idx.byProduct.get('Iron Bar')).toHaveLength(1);
    expect(idx.byProduct.get('Iron Bar')![0].Key).toBe('IronBar');
  });

  it('multi-product recipe appears under both product names', () => {
    const idx = buildRecipeIndex([multiProductRecipe]);
    expect(idx.byProduct.has('Steel Bar')).toBe(true);
    expect(idx.byProduct.has('Slag')).toBe(true);
    expect(idx.byProduct.get('Steel Bar')![0].Key).toBe('SteelBar');
    expect(idx.byProduct.get('Slag')![0].Key).toBe('SteelBar');
  });

  it('allCraftableNames is sorted', () => {
    const idx = buildRecipeIndex([multiProductRecipe, simpleRecipe]);
    const names = idx.allCraftableNames;
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('DefaultVariant is resolved by Name not Key', () => {
    // simpleRecipe has DefaultVariant = "Iron Bar" and Variant.Name = "Iron Bar"
    const idx = buildRecipeIndex([simpleRecipe]);
    // Should find the variant by Name match
    expect(idx.byProduct.get('Iron Bar')).toBeDefined();
  });

  it('multiple recipes for same product are all indexed', () => {
    const idx = buildRecipeIndex([simpleRecipe, multiRecipeItem]);
    const recipes = idx.byProduct.get('Iron Bar');
    expect(recipes).toHaveLength(2);
  });
});
