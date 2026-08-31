import { describe, it, expect } from 'vitest';
import { buildModuleIndex } from '$lib/moduleIndex.js';
import type { ModulesFile } from '$lib/moduleIndex.js';
import { MODULE_SLOTS } from '$lib/types.js';
import type { ModuleSlot } from '$lib/types.js';

// Mirrors the real Eco 14 values: generic modules pool to -35%, specialty modules
// are skill-scoped, and the Mining line is far stronger than the -5% norm.
const modulesFile: ModulesFile = {
  modules: [
    { item: 'BasicUpgradeItem',            name: 'Basic Upgrade',            slot: 'Basic',     resourceCostPercent: 0.10, skill: null },
    { item: 'AdvancedUpgradeItem',         name: 'Advanced Upgrade',         slot: 'Advanced',  resourceCostPercent: 0.10, skill: null },
    { item: 'ModernUpgradeItem',           name: 'Modern Upgrade',           slot: 'Modern',    resourceCostPercent: 0.15, skill: null },
    { item: 'MechanicsAdvancedUpgradeItem', name: 'Mechanics Advanced Upgrade', slot: 'Specialty', resourceCostPercent: 0.05, skill: 'Mechanics' },
    { item: 'MiningBasicUpgradeItem',      name: 'Mining Basic Upgrade',     slot: 'Specialty', resourceCostPercent: 0.15, skill: 'Mining' },
    { item: 'MiningAdvancedUpgradeItem',   name: 'Mining Advanced Upgrade',  slot: 'Specialty', resourceCostPercent: 0.20, skill: 'Mining' },
  ],
  tables: {
    // Hosts three skills — the case that matters most.
    'Machinist Table': ['MechanicsAdvancedUpgradeItem', 'MiningAdvancedUpgradeItem',
                        'BasicUpgradeItem', 'AdvancedUpgradeItem', 'ModernUpgradeItem'],
    // Exposes only Basic + Specialty, so it can never reach the generic -35%.
    'Rocker Box': ['MiningBasicUpgradeItem', 'BasicUpgradeItem'],
    'Bloomery': ['BasicUpgradeItem', 'AdvancedUpgradeItem', 'ModernUpgradeItem'],
  },
};

const index = buildModuleIndex(modulesFile);
const allSlots = new Set<ModuleSlot>(MODULE_SLOTS);
const slots = (...s: ModuleSlot[]) => new Set<ModuleSlot>(s);

describe('buildModuleIndex', () => {
  it('pools generic module percentages additively', () => {
    // 10 + 10 + 15, not compounded — the engine sums AdditivePercent then applies once.
    expect(index.reductionFor('Bloomery', 'Smelting', allSlots)).toBeCloseTo(0.35);
  });

  it('adds the best applicable specialty on top of the generics', () => {
    expect(index.reductionFor('Machinist Table', 'Mechanics', allSlots)).toBeCloseTo(0.40);
  });

  it('picks the strongest specialty when a table allows several for one skill', () => {
    expect(index.reductionFor('Machinist Table', 'Mining', allSlots)).toBeCloseTo(0.55);
  });

  it('gives one table different reductions for different skills', () => {
    // The regression this guards: dropping the skill from the memo key would make
    // whichever skill was queried first leak into the others.
    expect(index.reductionFor('Machinist Table', 'Mining', allSlots)).toBeCloseTo(0.55);
    expect(index.reductionFor('Machinist Table', 'Mechanics', allSlots)).toBeCloseTo(0.40);
    expect(index.reductionFor('Machinist Table', 'Blacksmith', allSlots)).toBeCloseTo(0.35);
    // …and again, to prove the cache returns per-skill entries rather than the first one.
    expect(index.reductionFor('Machinist Table', 'Mining', allSlots)).toBeCloseTo(0.55);
  });

  it('ignores a specialty whose skill does not match the recipe', () => {
    const applied = index.breakdownFor('Machinist Table', 'Blacksmith', allSlots);
    expect(applied.map(m => m.slot)).toEqual(['Basic', 'Advanced', 'Modern']);
  });

  it('only counts slots the table exposes', () => {
    // Rocker Box allows no Advanced/Modern module, so those slots contribute nothing.
    expect(index.reductionFor('Rocker Box', 'Mining', allSlots)).toBeCloseTo(0.25);
  });

  it('honours a partial slot selection', () => {
    expect(index.reductionFor('Machinist Table', 'Mining', slots('Basic'))).toBeCloseTo(0.10);
    expect(index.reductionFor('Machinist Table', 'Mining', slots('Basic', 'Advanced'))).toBeCloseTo(0.20);
    expect(index.reductionFor('Machinist Table', 'Mining', slots('Basic', 'Advanced', 'Modern'))).toBeCloseTo(0.35);
    expect(index.reductionFor('Machinist Table', 'Mining', new Set())).toBe(0);
  });

  it('returns no reduction for a table with no allow-list', () => {
    expect(index.reductionFor('Workbench', 'Carpentry', allSlots)).toBe(0);
    expect(index.breakdownFor('Workbench', 'Carpentry', allSlots)).toEqual([]);
  });

  it('names the module each slot contributed', () => {
    expect(index.breakdownFor('Machinist Table', 'Mining', allSlots)).toEqual([
      { slot: 'Basic',     module: 'Basic Upgrade',           reduction: 0.10 },
      { slot: 'Advanced',  module: 'Advanced Upgrade',        reduction: 0.10 },
      { slot: 'Modern',    module: 'Modern Upgrade',          reduction: 0.15 },
      { slot: 'Specialty', module: 'Mining Advanced Upgrade', reduction: 0.20 },
    ]);
  });
});
