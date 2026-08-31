#!/usr/bin/env node
// Extracts the Eco 14 plugin-module model from the game's C# mod sources.
//
// Eco 14 replaced the old progressive "Upgrade 0-5" ladder with four independent
// slots (Basic / Advanced / Modern / Specialty). Resource-cost bonuses use
// BonusEffectAdditivePercent, which the engine pools additively and applies once
// as x(1 + sum), so a slot combination collapses to a single reduction fraction.
//
// Usage: node scripts/extract-modules.mjs [--mods <dir>] [--out <file>]
//
// The default --mods is the Steam install, which is the build the live GoodPrice
// endpoint serves. ../ecoserv_14/Mods is the Eco 14 *Beta* and has weaker
// Advanced/Modern values -- see the header of scripts/refresh-eco14.sh.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_MODS = '/mnt/c/Games/Steam/steamapps/common/Eco/Eco_Data/Server/Mods';

const args = process.argv.slice(2);
let modsDir = DEFAULT_MODS;
let outFile = 'static/modules.eco14.json';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mods') modsDir = args[++i];
  else if (args[i] === '--out') outFile = args[++i];
  else if (args[i] === '--help' || args[i] === '-h') {
    process.stdout.write('Usage: node scripts/extract-modules.mjs [--mods <dir>] [--out <file>]\n');
    process.exit(0);
  } else {
    process.stderr.write(`Error: unknown argument ${args[i]}\n`);
    process.exit(1);
  }
}
if (!existsSync(modsDir)) {
  process.stderr.write(`Error: mods directory not found: ${modsDir}\n`);
  process.exit(1);
}

const SLOT_BY_TAG = {
  BasicModule:     'Basic',
  AdvancedModule:  'Advanced',
  ModernModule:    'Modern',
  SpecialtyModule: 'Specialty',
};

// Bonus blocks must be matched, not split on "new Bonus": that substring also
// occurs in "new BonusEffect...", which truncates every block before its Effects
// list and silently yields a 0% reduction for every module.
const BONUS_BLOCK = /new Bonus\s*\{(.*?)\n\s*\},/gs;

const read = (f) => readFileSync(f, 'utf8').replace(/^﻿/, '');
const csFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.cs')).map(f => join(dir, f)) : [];

// Skill class name -> the display name recipes use in SkillNeeds[].Skill.
// AdvancedSmeltingSkill -> "Advanced Smelting".
const skillDisplayName = (cls) => cls.replace(/(?<!^)(?=[A-Z])/g, ' ');

// ── Modules ────────────────────────────────────────────────────────────────
const modules = [];
for (const file of csFiles(join(modsDir, '__core__/AutoGen/PluginModule'))) {
  const src = read(file);

  const cls = src.match(/public partial class (\w+Item)\s*:/);
  if (!cls) continue;

  // Slot identity comes from the item's slot tag, not from ModuleTypes.
  const slotTag = [...src.matchAll(/\[Tag\("(\w+Module)"\)\]/g)].map(m => m[1])[0];
  const slot = SLOT_BY_TAG[slotTag];
  if (!slot) continue;  // no slot tag => routes into no slot (the Lvl1..4 leftovers)

  // The engine still ships deprecated items that would otherwise look installable.
  if (src.includes('deprecated item')) continue;

  let percent = 0;
  let skill = null;
  for (const [, block] of src.matchAll(BONUS_BLOCK)) {
    if (!block.includes('BonusAction.ResourceCost')) continue;
    const pct = block.match(/BonusEffectAdditivePercent\s*\{\s*Percent\s*=\s*(-?[\d.]+)f/);
    if (pct) percent = Math.abs(parseFloat(pct[1]));
    const scoped = block.match(/SkillTypes = new HashSet<Type> \{ typeof\((\w+)Skill\)/);
    skill = scoped ? skillDisplayName(scoped[1]) : null;
  }
  if (percent === 0) continue;  // contributes nothing to resource cost

  const display = src.match(/\[LocDisplayName\("([^"]+)"\)\]/);
  modules.push({
    item: cls[1],
    name: display ? display[1] : cls[1].replace(/Item$/, ''),
    slot,
    resourceCostPercent: percent,
    skill,
  });
}

// ── Tables ─────────────────────────────────────────────────────────────────
// A table's allow-list decides both which modules fit and which slots it exposes
// (ModuleSlotRegistry.CoreSlotNamesFor). UserCode overrides core.
const tables = {};
for (const root of ['__core__', 'UserCode']) {
  const files = [
    ...csFiles(join(modsDir, root, 'AutoGen/WorldObject')),
    ...csFiles(join(modsDir, root, 'Objects')),
  ];
  for (const file of files) {
    const src = read(file);
    const allow = src.match(/\[AllowPluginModules\(ItemTypes = new\[\] \{([^}]*)\}/);
    if (!allow) continue;
    const names = [...src.matchAll(/\[LocDisplayName\("([^"]+)"\)\]/g)].map(m => m[1]);
    if (names.length === 0) continue;
    // The attribute sits on the creating Item class, whose LocDisplayName is the
    // table name recipes refer to; it is the last one in the file.
    tables[names[names.length - 1]] = [...allow[1].matchAll(/typeof\((\w+Item)\)/g)].map(m => m[1]);
  }
}

modules.sort((a, b) => a.item.localeCompare(b.item));
const sortedTables = Object.fromEntries(Object.keys(tables).sort().map(k => [k, tables[k]]));

writeFileSync(outFile, JSON.stringify({ modules, tables: sortedTables }, null, 2) + '\n');

const bySlot = {};
for (const m of modules) bySlot[m.slot] = (bySlot[m.slot] ?? 0) + 1;
process.stdout.write(
  `${outFile}: ${modules.length} modules (${Object.entries(bySlot).map(([s, n]) => `${s} ${n}`).join(', ')}), ` +
  `${Object.keys(sortedTables).length} tables\n`
);
