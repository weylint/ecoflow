import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { buildRecipeIndex } from '../src/lib/recipeIndex.js';
import { buildTagsIndex } from '../src/lib/tagsIndex.js';
import { buildTalentIndex } from '../src/lib/talentIndex.js';
import { buildModuleIndex, type ModulesFile } from '../src/lib/moduleIndex.js';
import { buildGraph } from '../src/lib/planner.js';
import { computeEdmReport, type EdmReport } from '../src/lib/edm.js';
import { withDerivedEdmValues } from '../src/lib/edmDerived.js';
import { applySandboxPatch, applyTalentPatch } from '../src/lib/sandbox.js';
import type { SandboxPatch } from '../src/lib/sandbox.js';
import { applyChoiceOverrides, type ChoiceOverrides } from '../src/lib/choiceCodec.js';
import {
  getUpgradeLevels,
  usesModuleSlots,
  dataVersionOf,
  DEFAULT_TAG_CHOICES,
  DEFAULT_RECIPE_CHOICES,
  type EcoMode,
  type ModuleSlot,
  type PlannerGraph,
  type UserChoices,
  type RecipeFile,
  type TagsFile,
  type ProfessionData,
} from '../src/lib/types.js';
import { DEFAULT_SETTINGS, type AppSettings } from '../src/lib/settings.js';
import { resolveInput } from '../src/lib/recipeMatch.js';

const staticDir = join(dirname(fileURLToPath(import.meta.url)), '../static');

// Recipes, tags and talents are all version-specific. Eco 12 predates the talent
// data, so it gets none.
type DataVersion = 'eco12' | 'eco13' | 'eco14';

const RECIPES_FILE: Record<DataVersion, string> = {
  eco12: 'recipes.wt55.json',
  eco13: 'recipes.wt56.json',
  eco14: 'recipes.eco14.json',
};
const TAGS_FILE: Record<DataVersion, string> = {
  eco12: 'tags.json',
  eco13: 'tags.json',
  eco14: 'tags.eco14.json',
};
const PROFESSIONS_FILE: Record<DataVersion, string> = {
  eco12: 'professions.json',
  eco13: 'professions.json',
  eco14: 'professions.eco14.json',
};

/** A failure the caller should report and exit on, rather than a crash. */
export class PlanSetupError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'PlanSetupError';
  }
}

export interface PlanSetupOptions {
  ecoMode: EcoMode;
  rawItemName: string;
  totalAmount: number;
  /** eco12 / eco13 only — index into that version's upgrade ladder. */
  upgradeLevel: number;
  /** eco14 / sandbox only. */
  moduleSlots: ModuleSlot[];
  sandboxPatch: SandboxPatch;
  overrides: ChoiceOverrides;
}

export interface PlanSetupResult {
  targetItem: string;
  graph: PlannerGraph;
  report: EdmReport;
  settings: AppSettings;
  /** Before `withDerivedEdmValues` — what `priceSetId` must hash. */
  baseSettings: AppSettings;
  choices: UserChoices;
  globalUpgrade: number;
  tagsIndex: ReturnType<typeof buildTagsIndex>;
  recipeIndex: ReturnType<typeof buildRecipeIndex>;
  dataFiles: { recipes: string; tags: string; professions: string };
  /** Non-fatal notes for stderr: unmatched sandbox overrides, tag resolution, etc. */
  warnings: string[];
}

/**
 * Everything between "read the data files" and "here is a costed plan" — the
 * headless equivalent of what `+page.svelte` does on load. Kept out of the CLI
 * entry point so `--json` and the human summary are two renderers of one result.
 */
export function setupPlan(opts: PlanSetupOptions): PlanSetupResult {
  const { ecoMode, rawItemName, totalAmount, upgradeLevel, moduleSlots, sandboxPatch, overrides } = opts;
  const warnings: string[] = [];
  const version = dataVersionOf(ecoMode);

  const dataFiles = {
    recipes: RECIPES_FILE[version],
    tags: TAGS_FILE[version],
    professions: PROFESSIONS_FILE[version],
  };

  const recipesData = JSON.parse(readFileSync(join(staticDir, dataFiles.recipes), 'utf8')) as RecipeFile;
  const tagsData = JSON.parse(readFileSync(join(staticDir, dataFiles.tags), 'utf8')) as TagsFile;
  const professionsData = JSON.parse(readFileSync(join(staticDir, dataFiles.professions), 'utf8')) as { professions: ProfessionData[] };

  // ── Build indexes ───────────────────────────────────────────────────────────

  // The Sandbox version is Eco 14 plus a patch file — the JSON the browser UI's
  // Export button writes. Without --patch it is just Eco 14 under another name.
  const patched = ecoMode === 'sandbox'
    ? applySandboxPatch(recipesData.Recipes, sandboxPatch)
    : { recipes: recipesData.Recipes, unmatched: [] as string[] };

  if (patched.unmatched.length > 0) {
    warnings.push(
      `${patched.unmatched.length} override(s) match no recipe and were ignored: ` +
      patched.unmatched.join(', ')
    );
  }

  const professions = ecoMode === 'sandbox'
    ? applyTalentPatch(professionsData.professions, sandboxPatch)
    : professionsData.professions;

  const recipeIndex = buildRecipeIndex(patched.recipes);
  const tagsIndex = buildTagsIndex(tagsData.Tags);
  const talentIndex = ecoMode === 'eco12'
    ? undefined
    : buildTalentIndex(professions, patched.recipes, tagsData.Tags);
  const moduleIndex = usesModuleSlots(ecoMode)
    ? buildModuleIndex(JSON.parse(readFileSync(join(staticDir, 'modules.eco14.json'), 'utf8')) as ModulesFile)
    : undefined;

  // ── Resolve item name (case-insensitive, items or tags) ─────────────────────

  const resolved = resolveInput(rawItemName, recipeIndex.allCraftableNames, tagsIndex);
  let targetItem: string;

  if (!resolved.ok) {
    throw new PlanSetupError(
      `item "${rawItemName}" not found in recipe index.`,
      resolved.suggestions.length > 0 ? `Did you mean: ${resolved.suggestions.join(', ')}?` : undefined
    );
  } else if (resolved.input.kind === 'item') {
    targetItem = resolved.input.name;
  } else {
    const tagMatch = resolved.input.name;
    const defaultItem = DEFAULT_TAG_CHOICES[tagMatch];
    if (!defaultItem) {
      throw new PlanSetupError(
        `Tag "${tagMatch}" has no default.`,
        `Specify one of: ${[...resolved.input.items].join(', ')}`
      );
    }
    warnings.push(`resolving tag "${tagMatch}" → "${defaultItem}" (default)`);
    targetItem = defaultItem;
  }

  // ── Build choices: defaults, then the caller's overrides ────────────────────

  const baseChoices: UserChoices = {
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(Object.entries(DEFAULT_TAG_CHOICES)),
    marketItems: new Set(),
    upgradeByTable: new Map(),
    moduleSlotsByTable: new Map(),
  };

  for (const [itemName, recipeKey] of Object.entries(DEFAULT_RECIPE_CHOICES)) {
    const recipe = (recipeIndex.byProduct.get(itemName) ?? []).find(r => r.Key === recipeKey);
    if (recipe) baseChoices.recipeByItem.set(itemName, recipe);
  }

  const applied = applyChoiceOverrides(baseChoices, overrides, recipeIndex);
  if (applied.unmatched.length > 0) {
    warnings.push(`${applied.unmatched.length} override(s) match nothing and were ignored: ${applied.unmatched.join(', ')}`);
  }
  const choices = applied.choices;

  // ── Build graph & compute EDM ───────────────────────────────────────────────

  // Eco 14 and Sandbox derive their reduction per recipe from moduleData; globalUpgrade is unused there.
  const globalUpgrade = usesModuleSlots(ecoMode) ? 0 : getUpgradeLevels(ecoMode)[upgradeLevel].value;

  const planOpts = {
    recipeIndex,
    tagsIndex,
    choices,
    globalUpgrade,
    talentData: talentIndex,
    moduleData: moduleIndex,
    moduleSlots: moduleIndex ? new Set(moduleSlots) : undefined,
  };

  const graph = buildGraph({ targetItem, totalAmount, ...planOpts });

  const baseSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ecoMode,
    edmValues: { ...DEFAULT_SETTINGS.edmValues },
    edmTagDefaults: { ...DEFAULT_SETTINGS.edmTagDefaults },
    sandboxPatch: ecoMode === 'sandbox' ? sandboxPatch : undefined,
  };

  // Fills in items priced off another item (metal scrap ← concentrate).
  const settings = withDerivedEdmValues(baseSettings, tagsIndex, planOpts);

  return {
    targetItem,
    graph,
    baseSettings,
    report: computeEdmReport(graph, settings, tagsIndex),
    settings,
    choices,
    globalUpgrade,
    tagsIndex,
    recipeIndex,
    dataFiles,
    warnings,
  };
}
