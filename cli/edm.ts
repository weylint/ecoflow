import { readFileSync } from 'fs';

import { setupPlan, PlanSetupError } from './planSetup.js';
import { parseChoiceOverrides, EMPTY_CHOICE_OVERRIDES, serializeChoiceOverrides, type ChoiceOverrides } from '../src/lib/choiceCodec.js';
import { buildPlanExport } from '../src/lib/planExport.js';
import { priceSetId } from '../src/lib/priceSet.js';
import { parseSandboxPatch, EMPTY_SANDBOX_PATCH } from '../src/lib/sandbox.js';
import type { SandboxPatch } from '../src/lib/sandbox.js';
import {
  getUpgradeLevels,
  usesModuleSlots,
  isEcoMode,
  isModuleSlot,
  DEFAULT_MODULE_SLOTS,
  MODULE_SLOTS,
  type EcoMode,
  type ModuleSlot,
} from '../src/lib/types.js';

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function printHelp(): never {
  process.stdout.write(
    'Usage: ./edm "<item name>" <amount> [options]\n' +
    '\n' +
    'Options:\n' +
    '  --eco MODE          eco12 | eco13 | eco14 | sandbox (default: eco14)\n' +
  '  --patch FILE        sandbox override JSON, as exported by the UI (--eco sandbox)\n' +
    '  --upgrade 0-5       Module upgrade level, eco12/eco13 only (default: 5)\n' +
    '  --slots LIST        Eco 14 module slots: all | none | a comma list of\n' +
    '                      basic,advanced,modern,specialty (default: all)\n' +
    '  --overrides OV      Per-node choices, in the same syntax the app puts in\n' +
    '                      the URL\'s ov= parameter. Copy it out of a shared link:\n' +
    '                        r:Item=RecipeKey  v:Item=Variant  t:Tag=Item\n' +
    '                        m:Item            s:Table=basic,modern  u:Table=0.25\n' +
    '  --overrides-file F  Read that same string from a file\n' +
    '  --csv               Output base,labor,markup,total as a CSV line\n' +
    '  --json              Output the whole plan as JSON (nodes, edges, EDM)\n' +
    '  --verbose           Print per-node breakdown for debugging\n' +
    '  --help              Show this message\n'
  );
  process.exit(0);
}

function printUsage(): never {
  process.stderr.write(
    'Usage: ./edm "<item name>" <amount> [--eco eco12|eco13|eco14|sandbox] [--upgrade 0-5 | --slots LIST] [--overrides OV] [--csv|--json]\n' +
    'Run ./edm --help for details.\n'
  );
  process.exit(1);
}

let ecoMode: EcoMode = 'eco14';
let patchFile: string | null = null;
let upgradeLevel = 5;
let upgradeLevelGiven = false;
let moduleSlots: ModuleSlot[] = [...DEFAULT_MODULE_SLOTS];
let moduleSlotsGiven = false;
let csvMode = false;
let jsonMode = false;
let verboseMode = false;
let overridesRaw = '';
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--eco') {
    const val = args[++i];
    if (!isEcoMode(val)) {
      process.stderr.write(`Error: --eco must be eco12, eco13, eco14 or sandbox\n`);
      process.exit(1);
    }
    ecoMode = val;
  } else if (arg === '--patch') {
    patchFile = args[++i] ?? null;
    if (!patchFile) {
      process.stderr.write(`Error: --patch needs a file path\n`);
      process.exit(1);
    }
  } else if (arg === '--upgrade') {
    const val = parseInt(args[++i], 10);
    if (isNaN(val) || val < 0 || val > 5) {
      process.stderr.write(`Error: --upgrade must be 0–5\n`);
      process.exit(1);
    }
    upgradeLevel = val;
    upgradeLevelGiven = true;
  } else if (arg === '--slots') {
    const val = (args[++i] ?? '').trim().toLowerCase();
    if (val === 'all') {
      moduleSlots = [...DEFAULT_MODULE_SLOTS];
    } else if (val === 'none') {
      moduleSlots = [];
    } else {
      const parsed = val.split(',').map(s2 => s2.trim()).filter(Boolean)
        .map(s2 => s2.charAt(0).toUpperCase() + s2.slice(1));
      const bad = parsed.filter(s2 => !isModuleSlot(s2));
      if (parsed.length === 0 || bad.length > 0) {
        process.stderr.write(
          `Error: --slots must be all, none, or a comma list of ${MODULE_SLOTS.join(',').toLowerCase()}\n`
        );
        process.exit(1);
      }
      moduleSlots = parsed as ModuleSlot[];
    }
    moduleSlotsGiven = true;
  } else if (arg === '--overrides') {
    overridesRaw = args[++i] ?? '';
  } else if (arg === '--overrides-file') {
    const file = args[++i] ?? null;
    if (!file) {
      process.stderr.write(`Error: --overrides-file needs a file path\n`);
      process.exit(1);
    }
    overridesRaw = readFileSync(file, 'utf8').trim();
  } else if (arg === '--csv') {
    csvMode = true;
  } else if (arg === '--json') {
    jsonMode = true;
  } else if (arg === '--verbose') {
    verboseMode = true;
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

if (moduleSlotsGiven && !usesModuleSlots(ecoMode)) {
  process.stderr.write(`Error: --slots applies to eco14/sandbox only; use --upgrade for ${ecoMode}\n`);
  process.exit(1);
}
if (patchFile && ecoMode !== 'sandbox') {
  process.stderr.write(`Error: --patch applies to --eco sandbox only\n`);
  process.exit(1);
}

let sandboxPatch: SandboxPatch = { ...EMPTY_SANDBOX_PATCH };
if (patchFile) {
  const parsed = parseSandboxPatch(JSON.parse(readFileSync(patchFile, 'utf8')));
  if (!parsed) {
    process.stderr.write(`Error: ${patchFile} is not a valid sandbox patch file\n`);
    process.exit(1);
  }
  sandboxPatch = parsed;
}

if (upgradeLevelGiven && usesModuleSlots(ecoMode)) {
  process.stderr.write(`Error: --upgrade applies to eco12/eco13 only; use --slots for eco14/sandbox\n`);
  process.exit(1);
}

const overrides: ChoiceOverrides = overridesRaw
  ? parseChoiceOverrides(overridesRaw)
  : { ...EMPTY_CHOICE_OVERRIDES };

let setup;
try {
  setup = setupPlan({ ecoMode, rawItemName, totalAmount, upgradeLevel, moduleSlots, sandboxPatch, overrides });
} catch (e) {
  if (!(e instanceof PlanSetupError)) throw e;
  process.stderr.write(`Error: ${e.message}\n`);
  if (e.hint) process.stderr.write(`${e.hint}\n`);
  process.exit(1);
}

for (const w of setup.warnings) process.stderr.write(`Warning: ${w}\n`);

const { targetItem, graph, report, settings } = setup;

// ── Verbose output ────────────────────────────────────────────────────────────

if (verboseMode) {
  process.stderr.write(`=== EDM Verbose (ecoflow) ===\n\n`);

  process.stderr.write(`Raw costs:\n`);
  for (const r of report.rawCosts) {
    process.stderr.write(
      `  ${r.itemName} ×${r.amount.toFixed(4)}` +
      `  edm/unit=${(r.edmPerUnit ?? 0).toFixed(4)}` +
      `  total=${(r.totalEdm ?? 0).toFixed(4)}\n`
    );
  }

  process.stderr.write(`\nCross-prof transitions (markup=${(settings.crossProfessionMarkup * 100).toFixed(0)}%):\n`);
  for (const t of report.crossProfTransitions) {
    process.stderr.write(
      `  ${t.itemName}  ${t.fromProf} → ${t.toProf}` +
      `  baseEdm=${(t.baseEdm ?? 0).toFixed(4)}` +
      `  markup=${(t.markupAmount ?? 0).toFixed(4)}\n`
    );
    for (const e of t.pathEntries) {
      if (e.kind === 'table') {
        const primaryPerCycle = e.cycles > 0 ? e.outputAmount / e.cycles : 1;
        process.stderr.write(
          `    [table] ${e.itemName} ×${e.neededAmount.toFixed(4)}` +
          `  cycles=${e.cycles}  primary/cycle=${primaryPerCycle.toFixed(4)}` +
          `  subtreeEdm=${(e.subtreeEdm ?? 0).toFixed(4)}\n`
        );
      } else {
        process.stderr.write(
          `    [leaf] ${e.itemName} ×${e.amount.toFixed(4)}` +
          `  edm/unit=${(e.edmPerUnit ?? 0).toFixed(4)}` +
          `  total=${(e.totalEdm ?? 0).toFixed(4)}\n`
        );
      }
    }
  }

  const foodTiersMap: Record<string, string> = {
    'Farming': 'baseline', 'Butchery': 'baseline', 'Mining': 'baseline',
    'Logging': 'baseline', 'Gathering': 'baseline', 'Hunting': 'baseline',
    'Masonry': 'basic', 'Carpentry': 'basic', 'Shipwright': 'basic',
    'Basic Engineer': 'basic', 'Tailoring': 'basic', 'Milling': 'basic',
    'Smelting': 'basic', 'Fertilizers': 'basic', 'Blacksmith': 'basic',
    'Pottery': 'basic', 'Glassworking': 'basic', 'Painting': 'basic',
    'Cooking': 'basic', 'Baking': 'basic',
    'Mechanics': 'advanced', 'Paper Milling': 'advanced',
    'Advanced Smelting': 'advanced', 'Advanced Cooking': 'advanced',
    'Advanced Bakery': 'advanced',
    'Electronics': 'modern', 'Industry': 'modern', 'Oil Drilling': 'modern',
    'Advanced Masonry': 'modern', 'Composites': 'modern',
  };
  const tierCosts: Record<string, number> = { baseline: 1, basic: 3, advanced: 8, modern: 20 };

  const tableNodes = graph.nodes.filter(n => n.type === 'table');
  if (tableNodes.length > 0) {
    process.stderr.write(`\nLabor per table:\n`);
    for (const n of tableNodes) {
      if (n.type !== 'table') continue;
      const tn = n as unknown as { itemName: string; recipe: { SkillNeeds: Array<{Skill: string}>; BaseLaborCost: number }; cycles: number };
      const prof = tn.recipe.SkillNeeds[0]?.Skill ?? '(none)';
      const foodTier = foodTiersMap[prof] ?? 'basic';
      const calories = tn.recipe.BaseLaborCost * tn.cycles / 2;
      const labor = (calories / 1000) * tierCosts[foodTier];
      process.stderr.write(
        `  ${tn.itemName} (${prof}): cycles=${tn.cycles}  labor=${labor.toFixed(4)}\n`
      );
    }
  }

  process.stderr.write(`\n`);
}

// ── Output ────────────────────────────────────────────────────────────────────

// JSON is the agent-facing renderer, so it still emits on a priced-out plan:
// `missingItems` is part of the document and is the diagnosis. The exit code
// stays non-zero either way.
if (jsonMode) {
  process.stdout.write(JSON.stringify(buildPlanExport(graph, report, {
    ecoMode,
    targetItem,
    amount: totalAmount,
    ...(usesModuleSlots(ecoMode) ? { moduleSlots } : { globalUpgrade: setup.globalUpgrade }),
    priceSetId: priceSetId(setup.baseSettings),
    generatedAt: new Date().toISOString(),
  }, serializeChoiceOverrides(overrides)), null, 2) + '\n');
}

if (report.missingItems.length > 0) {
  process.stderr.write(`Error: missing EDM values for: ${report.missingItems.join(', ')}\n`);
  // `process.exit` truncates a large pending stdout write on a pipe, and the JSON
  // document is ~1 MB, so the exit code is set and the process left to drain.
  if (jsonMode) { process.exitCode = 1; } else { process.exit(1); }
}

const base = report.baseEdm ?? 0;
const labor = report.laborFoodEdm ?? 0;
const markup = report.markupEdm ?? 0;
const total = report.totalEdm ?? 0;

if (jsonMode) {
  // JSON already written above; the human summary would corrupt it.
} else if (csvMode) {
  process.stdout.write(`${base.toFixed(2)},${labor.toFixed(2)},${markup.toFixed(2)},${total.toFixed(2)}\n`);
} else {
  const modeLabel = usesModuleSlots(ecoMode)
    ? `modules: ${moduleSlots.length > 0 ? moduleSlots.join('+') : 'none'}`
    : getUpgradeLevels(ecoMode)[upgradeLevel].label;
  process.stdout.write(
    `EDM for ${totalAmount}× ${targetItem} (${ecoMode}, ${modeLabel}):\n` +
    `  Base:   ${base.toFixed(2)}\n` +
    `  Labor:  ${labor.toFixed(2)}\n` +
    `  Markup: ${markup.toFixed(2)}\n` +
    `  Total:  ${total.toFixed(2)}\n`
  );
}
