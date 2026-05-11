import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { buildRecipeIndex } from '../src/lib/recipeIndex.js';
import { buildTagsIndex } from '../src/lib/tagsIndex.js';
import { buildTalentIndex } from '../src/lib/talentIndex.js';
import { buildGraph } from '../src/lib/planner.js';
import { computeEdmReport } from '../src/lib/edm.js';
import {
  getUpgradeLevels,
  DEFAULT_TAG_CHOICES,
  DEFAULT_RECIPE_CHOICES,
  type UserChoices,
  type RecipeFile,
  type TagsFile,
  type ProfessionData,
} from '../src/lib/types.js';
import { DEFAULT_SETTINGS, type AppSettings } from '../src/lib/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, '../static');

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function printHelp(): never {
  process.stdout.write(
    'Usage: ./edm "<item name>" <amount> [options]\n' +
    '\n' +
    'Options:\n' +
    '  --eco eco12|eco13   Game version (default: eco13)\n' +
    '  --upgrade 0-5       Module upgrade level (default: 5)\n' +
    '  --csv               Output base,labor,markup,total as a CSV line\n' +
    '  --help              Show this message\n'
  );
  process.exit(0);
}

function printUsage(): never {
  process.stderr.write(
    'Usage: ./edm "<item name>" <amount> [--eco eco12|eco13] [--upgrade 0-5] [--csv]\n' +
    'Run ./edm --help for details.\n'
  );
  process.exit(1);
}

let ecoMode: 'eco12' | 'eco13' = 'eco13';
let upgradeLevel = 5;
let csvMode = false;
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--eco') {
    const val = args[++i];
    if (val !== 'eco12' && val !== 'eco13') {
      process.stderr.write(`Error: --eco must be eco12 or eco13\n`);
      process.exit(1);
    }
    ecoMode = val;
  } else if (arg === '--upgrade') {
    const val = parseInt(args[++i], 10);
    if (isNaN(val) || val < 0 || val > 5) {
      process.stderr.write(`Error: --upgrade must be 0–5\n`);
      process.exit(1);
    }
    upgradeLevel = val;
  } else if (arg === '--csv') {
    csvMode = true;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
  } else if (arg.startsWith('--')) {
    process.stderr.write(`Error: unknown flag ${arg}\n`);
    printUsage();
  } else {
    positional.push(arg);
  }
}

if (positional.length < 2) printUsage();

const rawItemName = positional[0];
const totalAmount = parseFloat(positional[1]);
if (isNaN(totalAmount) || totalAmount <= 0) {
  process.stderr.write(`Error: amount must be a positive number\n`);
  process.exit(1);
}

// ── Load data ─────────────────────────────────────────────────────────────────

const recipesFile = ecoMode === 'eco13' ? 'recipes.wt56.json' : 'recipes.wt55.json';
const recipesData = JSON.parse(readFileSync(join(staticDir, recipesFile), 'utf8')) as RecipeFile;
const tagsData = JSON.parse(readFileSync(join(staticDir, 'tags.json'), 'utf8')) as TagsFile;
const professionsData = JSON.parse(readFileSync(join(staticDir, 'professions.json'), 'utf8')) as { professions: ProfessionData[] };

// ── Build indexes ─────────────────────────────────────────────────────────────

const recipeIndex = buildRecipeIndex(recipesData.Recipes);
const tagsIndex = buildTagsIndex(tagsData.Tags);
const talentIndex = ecoMode === 'eco13'
  ? buildTalentIndex(professionsData.professions, recipesData.Recipes, tagsData.Tags)
  : undefined;

// ── Resolve item name (case-insensitive) ──────────────────────────────────────

const allNames = recipeIndex.allCraftableNames;
const lower = rawItemName.toLowerCase();
const targetItem = allNames.find(n => n.toLowerCase() === lower);

if (!targetItem) {
  const suggestions = allNames.filter(n => n.toLowerCase().includes(lower)).slice(0, 5);
  process.stderr.write(`Error: item "${rawItemName}" not found in recipe index.\n`);
  if (suggestions.length > 0) {
    process.stderr.write(`Did you mean: ${suggestions.join(', ')}?\n`);
  }
  process.exit(1);
}

// ── Build choices with defaults ───────────────────────────────────────────────

const choices: UserChoices = {
  recipeByItem: new Map(),
  variantByItem: new Map(),
  itemByTag: new Map(Object.entries(DEFAULT_TAG_CHOICES)),
  marketItems: new Set(),
  upgradeByTable: new Map(),
};

for (const [itemName, recipeKey] of Object.entries(DEFAULT_RECIPE_CHOICES)) {
  const recipes = recipeIndex.byProduct.get(itemName) ?? [];
  const recipe = recipes.find(r => r.Key === recipeKey);
  if (recipe) choices.recipeByItem.set(itemName, recipe);
}

// ── Build graph & compute EDM ─────────────────────────────────────────────────

const globalUpgrade = getUpgradeLevels(ecoMode)[upgradeLevel].value;

const graph = buildGraph({
  targetItem,
  totalAmount,
  recipeIndex,
  tagsIndex,
  choices,
  globalUpgrade,
  talentData: talentIndex,
});

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  ecoMode,
  edmValues: { ...DEFAULT_SETTINGS.edmValues },
  edmTagDefaults: { ...DEFAULT_SETTINGS.edmTagDefaults },
};

const report = computeEdmReport(graph, settings, tagsIndex);

// ── Output ────────────────────────────────────────────────────────────────────

if (report.missingItems.length > 0) {
  process.stderr.write(`Error: missing EDM values for: ${report.missingItems.join(', ')}\n`);
  process.exit(1);
}

const base = report.baseEdm ?? 0;
const labor = report.laborFoodEdm ?? 0;
const markup = report.markupEdm ?? 0;
const total = report.totalEdm ?? 0;

if (csvMode) {
  process.stdout.write(`${base.toFixed(2)},${labor.toFixed(2)},${markup.toFixed(2)},${total.toFixed(2)}\n`);
} else {
  const upgradeLevels = getUpgradeLevels(ecoMode);
  process.stdout.write(
    `EDM for ${totalAmount}× ${targetItem} (${ecoMode}, ${upgradeLevels[upgradeLevel].label}):\n` +
    `  Base:   ${base.toFixed(2)}\n` +
    `  Labor:  ${labor.toFixed(2)}\n` +
    `  Markup: ${markup.toFixed(2)}\n` +
    `  Total:  ${total.toFixed(2)}\n`
  );
}
