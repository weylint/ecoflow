import { describe, it, expect } from 'vitest';
import {
  applySandboxPatch, applyTalentPatch, EMPTY_SANDBOX_PATCH, ingredientKey,
  isPatchEmpty, parseSandboxPatch, patchedVariantCount, talentNames
} from '$lib/sandbox.js';
import type { SandboxPatch } from '$lib/sandbox.js';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { buildTalentIndex } from '$lib/talentIndex.js';
import { buildGraph } from '$lib/planner.js';
import type { ProfessionData, RecipeObject, TablePlannerNode, UserChoices } from '$lib/types.js';

function emptyChoices(): UserChoices {
  return {
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(),
    marketItems: new Set(),
    upgradeByTable: new Map()
  };
}

// Two variants of one recipe, the shape the override keys have to tell apart.
const ironBar: RecipeObject = {
  Key: 'IronBar',
  Untranslated: 'Iron Bar Recipe',
  BaseCraftTime: 2,
  BaseLaborCost: 10,
  BaseXPGain: 1,
  CraftingTable: 'Bloomery',
  CraftingTableCanUseModules: false,
  DefaultVariant: 'Iron Bar',
  NumberOfVariants: 2,
  SkillNeeds: [{ Skill: 'Smelting', Level: 1 }],
  Variants: [
    {
      Key: 'IronBar',
      Name: 'Iron Bar',
      Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 2, IsStatic: true }],
      Products: [{ Name: 'Iron Bar', Ammount: 4 }],
    },
    {
      Key: 'SmeltIron',
      Name: 'Smelt Iron',
      Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 4, IsStatic: true }],
      Products: [{ Name: 'Iron Bar', Ammount: 8 }],
    },
  ],
};

const patchOf = (variants: SandboxPatch['variants'], disabledTalents: string[] = []): SandboxPatch =>
  ({ version: 1, variants, disabledTalents });

describe('applySandboxPatch', () => {
  it('overrides a product amount on one variant only', () => {
    const { recipes } = applySandboxPatch([ironBar], patchOf({ IronBar: { products: { 'Iron Bar': 3 } } }));

    expect(recipes[0].Variants[0].Products[0].Ammount).toBe(3);
    // The sibling variant of the same recipe is untouched — the whole reason
    // overrides are keyed by variant rather than by recipe.
    expect(recipes[0].Variants[1].Products[0].Ammount).toBe(8);
  });

  it('overrides an ingredient amount', () => {
    const { recipes } = applySandboxPatch([ironBar], patchOf({ SmeltIron: { ingredients: { 'Iron Ore': 6 } } }));
    expect(recipes[0].Variants[1].Ingredients[0].Ammount).toBe(6);
  });

  it('never mutates the source data another version may be indexing', () => {
    applySandboxPatch([ironBar], patchOf({ IronBar: { products: { 'Iron Bar': 3 } } }));
    expect(ironBar.Variants[0].Products[0].Ammount).toBe(4);
  });

  it('shares untouched recipes by reference rather than deep-copying the tree', () => {
    const other = { ...ironBar, Key: 'Other', Variants: [{ ...ironBar.Variants[0], Key: 'OtherVariant' }] };
    const { recipes } = applySandboxPatch([ironBar, other], patchOf({ IronBar: { products: { 'Iron Bar': 3 } } }));
    expect(recipes[1]).toBe(other);
  });

  it('reports overrides that match no variant instead of failing silently', () => {
    const { unmatched } = applySandboxPatch([ironBar], patchOf({ GoneVariant: { products: { X: 1 } } }));
    expect(unmatched).toEqual(['GoneVariant']);
  });

  it('returns the input untouched for an empty patch', () => {
    const input = [ironBar];
    expect(applySandboxPatch(input, EMPTY_SANDBOX_PATCH).recipes).toBe(input);
  });
});

describe('sandbox patch and the planner', () => {
  it('changes how much ore a plan needs', () => {
    const tagsIndex = buildTagsIndex({});
    const plan = (recipes: RecipeObject[]) => {
      const graph = buildGraph({
        targetItem: 'Iron Bar', totalAmount: 8,
        recipeIndex: buildRecipeIndex(recipes), tagsIndex,
        choices: emptyChoices(), globalUpgrade: 0,
      });
      return graph.nodes.filter((n): n is TablePlannerNode => n.type === 'table')[0].cycles;
    };

    // Stock: the default variant makes 4 per craft, so 8 bars is 2 crafts.
    expect(plan([ironBar])).toBe(2);
    // Halve the yield and the same order takes twice the crafts.
    const { recipes } = applySandboxPatch([ironBar], patchOf({ IronBar: { products: { 'Iron Bar': 2 } } }));
    expect(plan(recipes)).toBe(4);
  });
});

const professions: ProfessionData[] = [{
  profession: 'Smith',
  source_file: 'x',
  skills: [{
    skill: 'Smelting',
    talents: [
      {
        display_name: 'Lean Smelting: Smelting', description: 'd', level: 1, class: 'c', max_takes: 1,
        effects: [{ effect: '50% resource cost', penalty: false, skills: ['Smelting'] }],
      },
      {
        display_name: 'Unrelated Talent', description: 'd', level: 1, class: 'c', max_takes: 1,
        effects: [{ effect: '10% faster crafting', penalty: false, skills: ['Smelting'] }],
      },
    ],
  }],
}];

describe('talent overrides', () => {
  it('lists only talents that reduce resource cost', () => {
    expect(talentNames(professions)).toEqual(['Lean Smelting']);
  });

  it('removes a disabled talent from the built index', () => {
    const withTalent = buildTalentIndex(professions, [ironBar], {});
    expect(withTalent.get('IronBar')?.totalReduction).toBeCloseTo(0.5, 6);

    const filtered = applyTalentPatch(professions, patchOf({}, ['Lean Smelting']));
    expect(buildTalentIndex(filtered, [ironBar], {}).has('IronBar')).toBe(false);
  });

  it('leaves the professions untouched when nothing is disabled', () => {
    expect(applyTalentPatch(professions, EMPTY_SANDBOX_PATCH)).toBe(professions);
  });
});

describe('patch bookkeeping', () => {
  it('counts an empty patch as empty', () => {
    expect(isPatchEmpty(EMPTY_SANDBOX_PATCH)).toBe(true);
    expect(isPatchEmpty(undefined)).toBe(true);
    expect(isPatchEmpty(patchOf({ IronBar: {} }))).toBe(true);   // an emptied entry is not an edit
    expect(isPatchEmpty(patchOf({}, ['Lean Smelting']))).toBe(false);
  });

  it('counts edited variants, not empty entries', () => {
    expect(patchedVariantCount(patchOf({ A: { products: { x: 1 } }, B: {} }))).toBe(1);
  });

  it('derives an ingredient key from the name, falling back to the tag', () => {
    expect(ingredientKey({ Name: 'Iron Ore', Tag: null })).toBe('Iron Ore');
    expect(ingredientKey({ Name: '', Tag: 'Wood' })).toBe('Wood');
  });
});

describe('parseSandboxPatch', () => {
  it('rejects anything that is not a version 1 patch', () => {
    expect(parseSandboxPatch(null)).toBeNull();
    expect(parseSandboxPatch({})).toBeNull();
    expect(parseSandboxPatch({ version: 2, variants: {} })).toBeNull();
  });

  it('drops non-numeric and negative amounts rather than trusting the file', () => {
    const parsed = parseSandboxPatch({
      version: 1,
      variants: { A: { products: { good: 3, bad: 'x', negative: -1 } } },
      disabledTalents: ['Real', 42],
    });
    expect(parsed?.variants.A.products).toEqual({ good: 3 });
    expect(parsed?.disabledTalents).toEqual(['Real']);
  });

  it('drops an entry left with no usable amounts', () => {
    expect(parseSandboxPatch({ version: 1, variants: { A: { products: { bad: 'x' } } } })?.variants).toEqual({});
  });
});
