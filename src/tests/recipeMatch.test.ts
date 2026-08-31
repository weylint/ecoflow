import { describe, it, expect } from 'vitest';
import { resolveInput, scoreVariants, type ResolvedInput } from '$lib/recipeMatch.js';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import {
  simpleRecipe,
  tagRecipe,
  pathRecipe,
  slabRecipe,
  crushedRockTags,
  sampleTags,
} from './fixtures.js';
import type { RecipeObject } from '$lib/types.js';

const crushedRockTagsIndex = buildTagsIndex(crushedRockTags);
const woodTagsIndex = buildTagsIndex(sampleTags);
const emptyTagsIndex = buildTagsIndex({});

// Helper: collect all specific-item ingredient names from a set of recipes
function itemNames(recipes: RecipeObject[]): string[] {
  const names = new Set<string>();
  for (const r of recipes)
    for (const v of r.Variants)
      for (const ing of v.Ingredients)
        if (ing.IsSpecificItem) names.add(ing.Name);
  return [...names].sort();
}

// ── resolveInput ──────────────────────────────────────────────────────────────

describe('resolveInput', () => {
  it('resolves a specific item name case-insensitively', () => {
    const names = ['Iron Ore', 'Coal'];
    const result = resolveInput('iron ore', names, emptyTagsIndex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.kind).toBe('item');
    expect(result.input.name).toBe('Iron Ore');
  });

  it('populates tags for an item input', () => {
    const names = ['Birch Log'];
    const result = resolveInput('Birch Log', names, woodTagsIndex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.kind).toBe('item');
    if (result.input.kind !== 'item') return;
    expect(result.input.tags.has('Wood')).toBe(true);
  });

  it('resolves a tag name case-insensitively', () => {
    const result = resolveInput('crushed rock', [], crushedRockTagsIndex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.kind).toBe('tag');
    expect(result.input.name).toBe('Crushed Rock');
    if (result.input.kind !== 'tag') return;
    expect(result.input.items.has('Crushed Granite')).toBe(true);
    expect(result.input.items.has('Crushed Sandstone')).toBe(true);
  });

  it('strips a trailing " Tag" suffix before resolution', () => {
    const result1 = resolveInput('Crushed Rock Tag', [], crushedRockTagsIndex);
    const result2 = resolveInput('Crushed Rock TAG', [], crushedRockTagsIndex);
    for (const result of [result1, result2]) {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.input.kind).toBe('tag');
      expect(result.input.name).toBe('Crushed Rock');
    }
  });

  it('item lookup takes precedence over tag when names collide', () => {
    // If an item and tag share a name, the item wins
    const names = ['Wood'];
    const tagsIndex = buildTagsIndex({ 'Wood': ['Birch Log'] });
    const result = resolveInput('Wood', names, tagsIndex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.kind).toBe('item');
  });

  it('returns error with suggestions for unknown input', () => {
    const names = ['Iron Ore', 'Coal'];
    const result = resolveInput('totally fake item', names, emptyTagsIndex);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.suggestions).toBeInstanceOf(Array);
  });

  it('suggestions include both item and tag matches', () => {
    const names = ['Crushed Granite', 'Crushed Sandstone'];
    const result = resolveInput('crushed', names, crushedRockTagsIndex);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Should suggest both the items and the "Crushed Rock" tag
    expect(result.suggestions.some(s => s.includes('Crushed'))).toBe(true);
  });
});

// ── scoreVariants — item inputs ───────────────────────────────────────────────

describe('scoreVariants with item inputs', () => {
  it('matches a specific-item ingredient', () => {
    // simpleRecipe: Iron Ore → Iron Bar
    const input: ResolvedInput = { kind: 'item', name: 'Iron Ore', tags: new Set() };
    const scored = scoreVariants([simpleRecipe], [input], { includeTags: true });
    expect(scored).toHaveLength(1);
    expect(scored[0].productName).toBe('Iron Bar');
    expect(scored[0].matchCount).toBe(1);
    expect(scored[0].matchedInputs).toContain('Iron Ore');
  });

  it('does not match an unrelated recipe', () => {
    const input: ResolvedInput = { kind: 'item', name: 'Stone', tags: new Set() };
    const scored = scoreVariants([simpleRecipe], [input], { includeTags: true });
    expect(scored).toHaveLength(0);
  });

  it('item input matches tag-typed ingredient slot when includeTags=true', () => {
    // tagRecipe: tag:Wood → Wooden Plank; Birch Log is in Wood tag
    const input: ResolvedInput = { kind: 'item', name: 'Birch Log', tags: new Set(['Wood']) };
    const scored = scoreVariants([tagRecipe], [input], { includeTags: true });
    expect(scored).toHaveLength(1);
    expect(scored[0].productName).toBe('Wooden Plank');
  });

  it('item input does NOT match tag-typed slot when includeTags=false', () => {
    const input: ResolvedInput = { kind: 'item', name: 'Birch Log', tags: new Set(['Wood']) };
    const scored = scoreVariants([tagRecipe], [input], { includeTags: false });
    expect(scored).toHaveLength(0);
  });
});

// ── scoreVariants — tag inputs ────────────────────────────────────────────────

describe('scoreVariants with tag inputs', () => {
  it('tag input matches a tag-typed ingredient slot (same-kind)', () => {
    // pathRecipe: tag:Crushed Rock → Stone Path
    const input: ResolvedInput = {
      kind: 'tag', name: 'Crushed Rock', items: new Set(['Crushed Granite', 'Crushed Sandstone'])
    };
    const scored = scoreVariants([pathRecipe], [input], { includeTags: true });
    expect(scored).toHaveLength(1);
    expect(scored[0].productName).toBe('Stone Path');
    expect(scored[0].matchCount).toBe(1);
    expect(scored[0].matchedInputs).toContain('Crushed Rock (tag)');
  });

  it('tag input matches a specific-item ingredient when that item is in the tag (cross-kind, includeTags=true)', () => {
    // slabRecipe: Stone → Stone Slab + Crushed Granite byproduct
    // Use the slabRecipe but test with a recipe that has Crushed Granite as ingredient
    const concreteRecipe: RecipeObject = {
      Key: 'ConcreteTest',
      Untranslated: '',
      BaseCraftTime: 2,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Cement Kiln',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Concrete',
      NumberOfVariants: 1,
      SkillNeeds: [],
      Variants: [{
        Key: 'Concrete',
        Name: 'Concrete',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Crushed Granite', Ammount: 2, IsStatic: false }
        ],
        Products: [{ Name: 'Concrete', Ammount: 1 }]
      }]
    };
    const input: ResolvedInput = {
      kind: 'tag', name: 'Crushed Rock', items: new Set(['Crushed Granite', 'Crushed Sandstone'])
    };
    const scored = scoreVariants([concreteRecipe], [input], { includeTags: true });
    expect(scored).toHaveLength(1);
    expect(scored[0].matchCount).toBe(1);
  });

  it('tag input does NOT match a specific-item ingredient when includeTags=false', () => {
    const concreteRecipe: RecipeObject = {
      Key: 'ConcreteTest',
      Untranslated: '',
      BaseCraftTime: 2,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Cement Kiln',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Concrete',
      NumberOfVariants: 1,
      SkillNeeds: [],
      Variants: [{
        Key: 'Concrete',
        Name: 'Concrete',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Crushed Granite', Ammount: 2, IsStatic: false }
        ],
        Products: [{ Name: 'Concrete', Ammount: 1 }]
      }]
    };
    const input: ResolvedInput = {
      kind: 'tag', name: 'Crushed Rock', items: new Set(['Crushed Granite'])
    };
    const scored = scoreVariants([concreteRecipe], [input], { includeTags: false });
    expect(scored).toHaveLength(0);
  });
});

// ── scoreVariants — mixed inputs ──────────────────────────────────────────────

describe('scoreVariants with mixed item + tag inputs', () => {
  it('counts both item and tag matches toward matchCount', () => {
    const mixedRecipe: RecipeObject = {
      Key: 'MixedWidget',
      Untranslated: '',
      BaseCraftTime: 2,
      BaseLaborCost: 10,
      BaseXPGain: 1,
      CraftingTable: 'Factory',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Mixed Widget',
      NumberOfVariants: 1,
      SkillNeeds: [],
      Variants: [{
        Key: 'MixedWidget',
        Name: 'Mixed Widget',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Iron Bar', Ammount: 2, IsStatic: false },
          { IsSpecificItem: false, Tag: 'Crushed Rock', Name: '', Ammount: 1, IsStatic: false }
        ],
        Products: [{ Name: 'Mixed Widget', Ammount: 1 }]
      }]
    };
    const inputs: ResolvedInput[] = [
      { kind: 'item', name: 'Iron Bar', tags: new Set() },
      { kind: 'tag', name: 'Crushed Rock', items: new Set(['Crushed Granite']) },
    ];
    const scored = scoreVariants([mixedRecipe], inputs, { includeTags: true });
    expect(scored).toHaveLength(1);
    expect(scored[0].matchCount).toBe(2);
    expect(scored[0].matchedInputs).toContain('Iron Bar');
    expect(scored[0].matchedInputs).toContain('Crushed Rock (tag)');
  });
});
