import { describe, it, expect } from 'vitest';
import {
  parseChoiceOverrides,
  serializeChoiceOverrides,
  overridesFromChoices,
  applyChoiceOverrides,
  EMPTY_CHOICE_OVERRIDES,
  type ChoiceBaseline,
} from '$lib/choiceCodec.js';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import type { RecipeObject, UserChoices } from '$lib/types.js';

function recipe(key: string, product: string, variants = [key]): RecipeObject {
  return {
    Key: key,
    BaseCraftTime: 1,
    BaseLaborCost: 10,
    BaseXPGain: 1,
    CraftingTable: 'Anvil',
    CraftingTableCanUseModules: true,
    DefaultVariant: variants[0],
    NumberOfVariants: variants.length,
    SkillNeeds: [{ Skill: 'Smelting', Level: 1 }],
    Variants: variants.map(name => ({
      Key: name,
      Name: name,
      Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 2, IsStatic: false }],
      Products: [{ Name: product, Ammount: 1 }],
    })),
  };
}

const index = buildRecipeIndex([
  recipe('Steel Bar', 'Steel Bar', ['Steel Bar', 'Smelt Steel']),
  recipe('Charcoal Steel', 'Steel Bar'),
  recipe('Iron Bar', 'Iron Bar'),
]);

function emptyChoices(): UserChoices {
  return {
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(),
    marketItems: new Set(),
    upgradeByTable: new Map(),
    moduleSlotsByTable: new Map(),
  };
}

const baseline: ChoiceBaseline = { recipeByItem: {}, itemByTag: {}, marketItems: [] };

describe('parse / serialize round trip', () => {
  const raw = 'r:Steel Bar=Charcoal Steel;v:Iron Bar=Iron Bar;t:Silica=Crushed Sandstone;'
            + 'm:Copper Bar;s:Machinist Table=basic,modern;u:Bakery Oven=0.25';

  it('survives a round trip unchanged', () => {
    expect(serializeChoiceOverrides(parseChoiceOverrides(raw))).toBe(raw);
  });

  it('reads every field', () => {
    const ov = parseChoiceOverrides(raw);
    expect(ov.recipe).toEqual({ 'Steel Bar': 'Charcoal Steel' });
    expect(ov.variant).toEqual({ 'Iron Bar': 'Iron Bar' });
    expect(ov.tag).toEqual({ Silica: 'Crushed Sandstone' });
    expect(ov.market).toEqual(['Copper Bar']);
    expect(ov.slots).toEqual({ 'Machinist Table': ['Basic', 'Modern'] });
    expect(ov.upgrade).toEqual({ 'Bakery Oven': 0.25 });
  });

  it('normalises slot order, so two equivalent links compare equal', () => {
    expect(serializeChoiceOverrides(parseChoiceOverrides('s:T=modern,basic')))
      .toBe(serializeChoiceOverrides(parseChoiceOverrides('s:T=basic,modern')));
  });

  it('keeps an emptied slot list distinct from an absent one', () => {
    expect(parseChoiceOverrides('s:T=').slots).toEqual({ T: [] });
    expect(parseChoiceOverrides('s:T').slots).toEqual({});
  });

  it('escapes separators inside names', () => {
    const ov = { ...EMPTY_CHOICE_OVERRIDES, recipe: { 'Odd;Name=X': 'Key' } };
    expect(serializeChoiceOverrides(parseChoiceOverrides(serializeChoiceOverrides(ov))))
      .toBe(serializeChoiceOverrides(ov));
  });

  it('is empty for an empty string', () => {
    expect(serializeChoiceOverrides(parseChoiceOverrides(''))).toBe('');
    expect(serializeChoiceOverrides(parseChoiceOverrides(null))).toBe('');
  });
});

describe('leniency', () => {
  it('skips a garbage entry without losing its neighbours', () => {
    const ov = parseChoiceOverrides('r:Steel Bar=Charcoal Steel;garbage;u:T=nope;m:Copper Bar');
    expect(ov.recipe).toEqual({ 'Steel Bar': 'Charcoal Steel' });
    expect(ov.market).toEqual(['Copper Bar']);
    expect(ov.upgrade).toEqual({});
  });

  it('rejects an out-of-range upgrade and an unknown slot', () => {
    expect(parseChoiceOverrides('u:T=1.5').upgrade).toEqual({});
    expect(parseChoiceOverrides('s:T=basic,teapot').slots).toEqual({});
  });
});

describe('overridesFromChoices', () => {
  it('emits nothing when every choice matches the baseline', () => {
    const choices = emptyChoices();
    choices.recipeByItem.set('Steel Bar', index.byProduct.get('Steel Bar')![0]);
    choices.itemByTag.set('Silica', 'Crushed Granite');
    const withBaseline: ChoiceBaseline = {
      recipeByItem: { 'Steel Bar': 'Steel Bar' },
      itemByTag: { Silica: 'Crushed Granite' },
      marketItems: [],
    };
    expect(serializeChoiceOverrides(overridesFromChoices(choices, withBaseline))).toBe('');
  });

  it('emits a deviation from the baseline', () => {
    const choices = emptyChoices();
    choices.recipeByItem.set('Steel Bar', index.byProduct.get('Steel Bar')!.find(r => r.Key === 'Charcoal Steel')!);
    expect(serializeChoiceOverrides(overridesFromChoices(choices, baseline)))
      .toBe('r:Steel Bar=Charcoal Steel');
  });

  it('omits a variant that is the recipe default', () => {
    const steel = index.byProduct.get('Steel Bar')![0];
    const choices = emptyChoices();
    choices.recipeByItem.set('Steel Bar', steel);
    choices.variantByItem.set('Steel Bar', steel.Variants[0]);
    expect(overridesFromChoices(choices, { ...baseline, recipeByItem: { 'Steel Bar': 'Steel Bar' } }).variant)
      .toEqual({});
  });
});

describe('applyChoiceOverrides', () => {
  it('resolves a recipe key to the recipe object', () => {
    const { choices, unmatched } = applyChoiceOverrides(
      emptyChoices(), parseChoiceOverrides('r:Steel Bar=Charcoal Steel'), index
    );
    expect(choices.recipeByItem.get('Steel Bar')?.Key).toBe('Charcoal Steel');
    expect(unmatched).toEqual([]);
  });

  it('reports an override that matches nothing rather than dropping it silently', () => {
    const { unmatched } = applyChoiceOverrides(
      emptyChoices(), parseChoiceOverrides('r:Steel Bar=Adamantium'), index
    );
    expect(unmatched).toEqual(['r:Steel Bar=Adamantium']);
  });

  it('makes market and recipe mutually exclusive, whichever came first', () => {
    const marketed = applyChoiceOverrides(
      emptyChoices(), parseChoiceOverrides('r:Steel Bar=Charcoal Steel;m:Steel Bar'), index
    ).choices;
    expect(marketed.marketItems.has('Steel Bar')).toBe(true);
    expect(marketed.recipeByItem.has('Steel Bar')).toBe(false);
  });

  it('round-trips through choices and back to the same string', () => {
    const raw = 'r:Steel Bar=Charcoal Steel;s:Machinist Table=basic,modern;u:Bakery Oven=0.25';
    const { choices } = applyChoiceOverrides(emptyChoices(), parseChoiceOverrides(raw), index);
    expect(serializeChoiceOverrides(overridesFromChoices(choices, baseline))).toBe(raw);
  });
});
