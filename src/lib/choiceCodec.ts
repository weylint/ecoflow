import type { ModuleSlot, RecipeObject, UserChoices } from './types.js';
import { MODULE_SLOTS, isModuleSlot } from './types.js';
import type { RecipeIndex } from './recipeIndex.js';

/**
 * Per-node plan decisions as flat strings — the `ov` URL parameter and the CLI's
 * `--overrides` argument are the same text, so a shared link is also a command line.
 *
 * `ov=r:Steel Bar=SteelBarCharcoal;t:Silica=Crushed Sandstone;m:Copper Bar;s:Machinist Table=basic,modern`
 *
 * Parsing is deliberately split from resolution: this module never needs the
 * recipe index, so a link can be validated (and tested) without loading 1.1 MB
 * of recipes. `applyChoiceOverrides` does the half that needs the data.
 */
export interface ChoiceOverrides {
  recipe: Record<string, string>;        // item name → recipe key
  variant: Record<string, string>;       // item name → variant name
  tag: Record<string, string>;           // tag name → chosen item
  market: string[];                      // items bought rather than crafted
  slots: Record<string, ModuleSlot[]>;   // table name → filled module slots
  upgrade: Record<string, number>;       // table name → reduction fraction
}

export const EMPTY_CHOICE_OVERRIDES: ChoiceOverrides = {
  recipe: {}, variant: {}, tag: {}, market: [], slots: {}, upgrade: {},
};

/** What a plan looks like before the user touches anything, so only real deviations are emitted. */
export interface ChoiceBaseline {
  recipeByItem: Record<string, string>;  // the DEFAULT_RECIPE_CHOICES in force
  itemByTag: Record<string, string>;     // the user's tag defaults
  marketItems: readonly string[];
}

// `;` and `=` are the separators and `%` starts an escape; nothing else is touched,
// so item names stay readable in the URL bar.
const enc = (s: string) => s.replace(/[%;=]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const dec = (s: string) => s.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const sortedKeys = (o: Record<string, unknown>) => Object.keys(o).sort();

export function serializeChoiceOverrides(ov: ChoiceOverrides): string {
  const parts: string[] = [];
  for (const item of sortedKeys(ov.recipe)) parts.push(`r:${enc(item)}=${enc(ov.recipe[item])}`);
  for (const item of sortedKeys(ov.variant)) parts.push(`v:${enc(item)}=${enc(ov.variant[item])}`);
  for (const tag of sortedKeys(ov.tag)) parts.push(`t:${enc(tag)}=${enc(ov.tag[tag])}`);
  for (const item of [...ov.market].sort()) parts.push(`m:${enc(item)}`);
  for (const table of sortedKeys(ov.slots)) {
    parts.push(`s:${enc(table)}=${ov.slots[table].map(s => s.toLowerCase()).join(',')}`);
  }
  for (const table of sortedKeys(ov.upgrade)) parts.push(`u:${enc(table)}=${ov.upgrade[table]}`);
  return parts.join(';');
}

/** Lenient by design, like `parseColumnTargets`: one unparseable entry is skipped
 *  so the rest of a hand-edited or truncated link still applies. */
export function parseChoiceOverrides(raw: string | null | undefined): ChoiceOverrides {
  const out: ChoiceOverrides = { recipe: {}, variant: {}, tag: {}, market: [], slots: {}, upgrade: {} };
  if (!raw) return out;
  for (const part of raw.split(';')) {
    if (!part) continue;
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const kind = part.slice(0, colon);
    const rest = part.slice(colon + 1);
    const eq = rest.indexOf('=');
    const key = dec(eq < 0 ? rest : rest.slice(0, eq));
    const val = eq < 0 ? null : dec(rest.slice(eq + 1));
    if (!key) continue;

    if (kind === 'm') { if (!out.market.includes(key)) out.market.push(key); continue; }
    if (val === null || val === '') {
      // `s:Table=` is a real value: every slot emptied. The others need a value.
      if (kind === 's' && val === '') out.slots[key] = [];
      continue;
    }
    switch (kind) {
      case 'r': out.recipe[key] = val; break;
      case 'v': out.variant[key] = val; break;
      case 't': out.tag[key] = val; break;
      case 's': {
        const parsed = val.split(',').map(s => s.trim()).filter(Boolean)
          .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
        // Normalised to canonical slot order so two equivalent links compare equal.
        if (parsed.every(isModuleSlot)) out.slots[key] = MODULE_SLOTS.filter(s => parsed.includes(s));
        break;
      }
      case 'u': {
        const n = parseFloat(val);
        if (isFinite(n) && n >= 0 && n <= 1) out.upgrade[key] = n;
        break;
      }
    }
  }
  return out;
}

/** Reduce live `UserChoices` to only what deviates from `baseline`. */
export function overridesFromChoices(choices: UserChoices, baseline: ChoiceBaseline): ChoiceOverrides {
  const out: ChoiceOverrides = { recipe: {}, variant: {}, tag: {}, market: [], slots: {}, upgrade: {} };

  for (const [item, recipe] of choices.recipeByItem) {
    if (baseline.recipeByItem[item] !== recipe.Key) out.recipe[item] = recipe.Key;
  }
  for (const [item, variant] of choices.variantByItem) {
    // A variant equal to the recipe's own default says nothing.
    if (choices.recipeByItem.get(item)?.DefaultVariant !== variant.Name) out.variant[item] = variant.Name;
  }
  for (const [tag, item] of choices.itemByTag) {
    if (baseline.itemByTag[tag] !== item) out.tag[tag] = item;
  }
  for (const item of choices.marketItems) {
    if (!baseline.marketItems.includes(item)) out.market.push(item);
  }
  for (const [table, slots] of choices.moduleSlotsByTable ?? []) out.slots[table] = [...slots];
  for (const [table, value] of choices.upgradeByTable) out.upgrade[table] = value;

  return out;
}

/**
 * Resolve string overrides against the real recipe data, returning a new
 * `UserChoices` plus the entries that matched nothing — surfaced rather than
 * silently dropped, the way `applySandboxPatch` reports its `unmatched`.
 */
export function applyChoiceOverrides(
  base: UserChoices,
  ov: ChoiceOverrides,
  recipeIndex: RecipeIndex
): { choices: UserChoices; unmatched: string[] } {
  const unmatched: string[] = [];
  const recipeByItem = new Map(base.recipeByItem);
  const variantByItem = new Map(base.variantByItem);
  const itemByTag = new Map(base.itemByTag);
  const marketItems = new Set(base.marketItems);
  const upgradeByTable = new Map(base.upgradeByTable);
  const moduleSlotsByTable = new Map(base.moduleSlotsByTable ?? []);

  const findRecipe = (item: string, key: string): RecipeObject | undefined =>
    (recipeIndex.byProduct.get(item) ?? []).find(r => r.Key === key);

  for (const [item, key] of Object.entries(ov.recipe)) {
    const recipe = findRecipe(item, key);
    if (!recipe) { unmatched.push(`r:${item}=${key}`); continue; }
    recipeByItem.set(item, recipe);
    marketItems.delete(item);
  }
  for (const [item, name] of Object.entries(ov.variant)) {
    const recipe = recipeByItem.get(item);
    const variant = recipe?.Variants.find(v => v.Name === name);
    if (!variant) { unmatched.push(`v:${item}=${name}`); continue; }
    variantByItem.set(item, variant);
  }
  for (const [tag, item] of Object.entries(ov.tag)) itemByTag.set(tag, item);
  for (const item of ov.market) {
    marketItems.add(item);
    recipeByItem.delete(item);
    variantByItem.delete(item);
  }
  for (const [table, slots] of Object.entries(ov.slots)) moduleSlotsByTable.set(table, [...slots]);
  for (const [table, value] of Object.entries(ov.upgrade)) upgradeByTable.set(table, value);

  return {
    choices: { recipeByItem, variantByItem, itemByTag, marketItems, upgradeByTable, moduleSlotsByTable },
    unmatched,
  };
}
