import type { RecipeObject } from './types.js';
import type { TagsIndex } from './tagsIndex.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResolvedInput =
  | { kind: 'item'; name: string; tags: Set<string> }
  | { kind: 'tag';  name: string; items: Set<string> };

export interface ScoredVariant {
  productName: string;
  recipeKey: string;
  table: string;
  matchCount: number;
  extraCount: number;
  totalIngredientCount: number;
  baseCraftTime: number;
  matchedInputs: string[];  // display labels: tag inputs suffixed with " (tag)"
}

// ── resolveInput ──────────────────────────────────────────────────────────────

export function resolveInput(
  raw: string,
  allItemNames: string[],
  tagsIndex: TagsIndex,
): { ok: true; input: ResolvedInput } | { ok: false; suggestions: string[] } {
  // Strip optional trailing " tag" (e.g. "Ashlar Stone Tag" → "Ashlar Stone")
  const stripped = raw.replace(/ tag$/i, '').trim();
  const lower = stripped.toLowerCase();

  const itemMatch = allItemNames.find(n => n.toLowerCase() === lower);
  if (itemMatch) {
    return {
      ok: true,
      input: { kind: 'item', name: itemMatch, tags: new Set(tagsIndex.itemToTags.get(itemMatch) ?? []) },
    };
  }

  const allTagNames = [...tagsIndex.byTag.keys()];
  const tagMatch = allTagNames.find(t => t.toLowerCase() === lower);
  if (tagMatch) {
    return {
      ok: true,
      input: { kind: 'tag', name: tagMatch, items: new Set(tagsIndex.byTag.get(tagMatch) ?? []) },
    };
  }

  const combined = [...allItemNames, ...allTagNames];
  const suggestions = combined.filter(n => n.toLowerCase().includes(lower)).slice(0, 5);
  return { ok: false, suggestions };
}

// ── scoreVariants ─────────────────────────────────────────────────────────────

export function scoreVariants(
  recipes: RecipeObject[],
  inputs: ResolvedInput[],
  opts: { includeTags: boolean },
): ScoredVariant[] {
  const scored: ScoredVariant[] = [];

  for (const recipe of recipes) {
    for (const variant of recipe.Variants) {
      const primaryProduct = variant.Products[0];
      if (!primaryProduct) continue;

      // Which user inputs are matched by this variant's ingredients?
      const matchedSet = new Set<string>();

      for (const ing of variant.Ingredients) {
        for (const input of inputs) {
          let matched = false;

          if (ing.IsSpecificItem) {
            if (input.kind === 'item') {
              matched = ing.Name === input.name;                         // same-kind
            } else if (opts.includeTags) {
              matched = input.items.has(ing.Name);                       // cross-kind (tag input covers specific slot)
            }
          } else if (ing.Tag) {
            if (input.kind === 'item') {
              matched = opts.includeTags && input.tags.has(ing.Tag);     // cross-kind (item satisfies tag slot)
            } else {
              matched = input.name === ing.Tag;                          // same-kind
            }
          }

          if (matched) {
            const label = input.kind === 'tag' ? `${input.name} (tag)` : input.name;
            matchedSet.add(label);
            break;
          }
        }
      }

      if (matchedSet.size === 0) continue;

      scored.push({
        productName: primaryProduct.Name,
        recipeKey: recipe.Key,
        table: recipe.CraftingTable,
        matchCount: matchedSet.size,
        extraCount: variant.Ingredients.length - matchedSet.size,
        totalIngredientCount: variant.Ingredients.length,
        baseCraftTime: recipe.BaseCraftTime,
        matchedInputs: [...matchedSet],
      });
    }
  }

  return scored;
}
