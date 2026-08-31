import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { buildRecipeIndex } from '../src/lib/recipeIndex.js';
import { buildTagsIndex } from '../src/lib/tagsIndex.js';
import { resolveInput, scoreVariants, type ScoredVariant, type ResolvedInput } from '../src/lib/recipeMatch.js';
import { type EcoMode, type RecipeFile, type TagsFile, isEcoMode, EDM_MARKUP_EXCLUDED_RECIPES } from '../src/lib/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, '../static');

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function printHelp(): never {
  process.stdout.write(
    'Usage: ./recipes-using "<ingredient>" ["<ingredient>" ...] [options]\n' +
    '       ./recipes-using --file ingredients.csv [options]\n' +
    '       cat ingredients.csv | ./recipes-using [options]\n' +
    '\n' +
    'Find recipes that consume the most of your provided ingredients.\n' +
    'Ingredients may be specific item names or tag names (e.g. "Crushed Rock").\n' +
    'CSV input: first column of each line used as ingredient name.\n' +
    '\n' +
    'Options:\n' +
    '  --file <path>        Read ingredients from a file (one per line or CSV)\n' +
    '  --top N              Number of results to show (default: 10)\n' +
    '  --min-coverage N     Minimum ingredient coverage % to include (0–100, default: 0)\n' +
    '  --eco MODE           eco12 | eco13 | eco14 (default: eco14)\n' +
    '  --no-include-tags    Disable cross-kind tag matching\n' +
    '  --csv                Output as CSV\n' +
    '  --help               Show this message\n' +
    '\n' +
    'Example:\n' +
    '  ./recipes-using "iron concentrate, crushed coal, quicklime"\n' +
    '  ./recipes-using --file stockpile.csv --top 5\n' +
    '  cat stockpile.csv | ./recipes-using\n'
  );
  process.exit(0);
}

function printUsage(): never {
  process.stderr.write(
    'Usage: ./recipes-using "<ingredient>" [...] [--top N] [--eco eco12|eco13|eco14] [--csv]\n' +
    'Run ./recipes-using --help for details.\n'
  );
  process.exit(1);
}

let ecoMode: EcoMode = 'eco14';
let topN = 10;
let minCoverage = 0;
let csvMode = false;
let includeTags = true;
let inputFile: string | null = null;
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--file') {
    inputFile = args[++i];
    if (!inputFile) {
      process.stderr.write(`Error: --file requires a path argument\n`);
      process.exit(1);
    }
  } else if (arg === '--eco') {
    const val = args[++i];
    if (!isEcoMode(val)) {
      process.stderr.write(`Error: --eco must be eco12, eco13 or eco14\n`);
      process.exit(1);
    }
    ecoMode = val;
  } else if (arg === '--top') {
    const val = parseInt(args[++i], 10);
    if (isNaN(val) || val < 1) {
      process.stderr.write(`Error: --top must be a positive integer\n`);
      process.exit(1);
    }
    topN = val;
  } else if (arg === '--min-coverage') {
    const val = parseFloat(args[++i]);
    if (isNaN(val) || val < 0 || val > 100) {
      process.stderr.write(`Error: --min-coverage must be a number between 0 and 100\n`);
      process.exit(1);
    }
    minCoverage = val;
  } else if (arg === '--no-include-tags') {
    includeTags = false;
  } else if (arg === '--csv') {
    csvMode = true;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
  } else if (arg.startsWith('--')) {
    process.stderr.write(`Error: unknown flag ${arg}\n`);
    printUsage();
  } else {
    for (const part of arg.split(',')) {
      const trimmed = part.trim();
      if (trimmed) positional.push(trimmed);
    }
  }
}

function parseIngredientLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.split(',')[0].trim())
    .filter(Boolean);
}

const stdinIsPiped = !process.stdin.isTTY;

if (inputFile) {
  positional.push(...parseIngredientLines(readFileSync(inputFile, 'utf8')));
} else if (stdinIsPiped) {
  positional.push(...parseIngredientLines(readFileSync(0, 'utf8')));
}

if (positional.length === 0) printUsage();

// ── Load data ─────────────────────────────────────────────────────────────────

const RECIPES_FILE: Record<EcoMode, string> = {
  eco12: 'recipes.wt55.json',
  eco13: 'recipes.wt56.json',
  eco14: 'recipes.eco14.json',
};
const TAGS_FILE: Record<EcoMode, string> = {
  eco12: 'tags.json',
  eco13: 'tags.json',
  eco14: 'tags.eco14.json',
};
const recipesFile = RECIPES_FILE[ecoMode];
const recipesData = JSON.parse(readFileSync(join(staticDir, recipesFile), 'utf8')) as RecipeFile;
const tagsData = JSON.parse(readFileSync(join(staticDir, TAGS_FILE[ecoMode]), 'utf8')) as TagsFile;

// ── Build indexes ─────────────────────────────────────────────────────────────

const recipeIndex = buildRecipeIndex(recipesData.Recipes);
const tagsIndex = buildTagsIndex(tagsData.Tags);

// ── Collect all specific-item names for resolution ────────────────────────────

const allItemNamesSet = new Set<string>();
for (const recipe of recipesData.Recipes)
  for (const variant of recipe.Variants)
    for (const ing of variant.Ingredients)
      if (ing.IsSpecificItem) allItemNamesSet.add(ing.Name);
for (const name of recipeIndex.allCraftableNames) allItemNamesSet.add(name);
const allItemNames = [...allItemNamesSet].sort();

// ── Resolve inputs ────────────────────────────────────────────────────────────

const resolvedInputs: ResolvedInput[] = [];

for (const raw of positional) {
  const result = resolveInput(raw, allItemNames, tagsIndex);
  if (!result.ok) {
    process.stderr.write(`Warning: "${raw}" not found, skipping.`);
    if (result.suggestions.length > 0)
      process.stderr.write(` Did you mean: ${result.suggestions.join(', ')}?`);
    process.stderr.write('\n');
  } else {
    resolvedInputs.push(result.input);
  }
}

// ── Score variants ────────────────────────────────────────────────────────────

const scored = scoreVariants(recipesData.Recipes, resolvedInputs, { includeTags })
  .filter(sv => !EDM_MARKUP_EXCLUDED_RECIPES.has(sv.recipeKey))
  .filter(sv => sv.matchCount / sv.totalIngredientCount * 100 >= minCoverage);

// ── Group by primary product, keep best variant ───────────────────────────────

function compareVariants(a: ScoredVariant, b: ScoredVariant): number {
  if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
  if (a.extraCount !== b.extraCount) return a.extraCount - b.extraCount;
  return a.baseCraftTime - b.baseCraftTime;
}

const bestByProduct = new Map<string, ScoredVariant>();
for (const sv of scored) {
  const existing = bestByProduct.get(sv.productName);
  if (!existing || compareVariants(sv, existing) < 0) bestByProduct.set(sv.productName, sv);
}

const results = [...bestByProduct.values()].sort(compareVariants).slice(0, topN);

if (results.length === 0) {
  process.stderr.write(`No recipes found consuming any of the provided ingredients.\n`);
  process.exit(1);
}

// ── Output ────────────────────────────────────────────────────────────────────

const inputLabels = resolvedInputs.map(i => i.kind === 'tag' ? `${i.name} (tag)` : i.name);

if (csvMode) {
  // "coverage" = matched / recipe ingredient count — same definition as
  // --min-coverage and the text output.
  process.stdout.write('rank,product,recipe,table,matched,total_ingredients,coverage,matched_items\n');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const coverage = (r.matchCount / r.totalIngredientCount * 100).toFixed(1);
    process.stdout.write(
      `${i + 1},${r.productName},${r.recipeKey},${r.table},` +
      `${r.matchCount},${r.totalIngredientCount},${coverage}%,` +
      `${r.matchedInputs.join(';')}\n`
    );
  }
} else {
  process.stdout.write(`Top ${results.length} recipes consuming { ${inputLabels.join(', ')} }:\n\n`);

  const colProduct = Math.max(...results.map(r => r.productName.length), 12);
  const colTable = Math.max(...results.map(r => r.table.length + 2), 12);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rank = String(i + 1).padStart(2);
    const product = r.productName.padEnd(colProduct);
    const table = `[${r.table}]`.padEnd(colTable);
    const matched = `${r.matchCount}/${resolvedInputs.length} matched`;
    const ingCoverage = Math.round(r.matchCount / r.totalIngredientCount * 100);
    const details = `(${r.totalIngredientCount} ingredients, ${ingCoverage}% coverage)`;
    const coveredList = r.matchedInputs.join(', ');
    process.stdout.write(`${rank}. ${product}  ${table}  ${matched}  ${details}  ${coveredList}\n`);
  }
}
