import type { AppliedModule, ModuleSlot } from './types.js';
import { MODULE_SLOTS } from './types.js';

// ── modules.eco14.json shape (see scripts/extract-modules.mjs) ──────
export interface ModuleDef {
  item: string;                 // C# item class, e.g. "MiningAdvancedUpgradeItem"
  name: string;                 // display name, e.g. "Mining Advanced Upgrade"
  slot: ModuleSlot;
  resourceCostPercent: number;  // positive fraction, e.g. 0.2 for -20%
  skill: string | null;         // null = applies to every recipe on the table
}

export interface ModulesFile {
  modules: ModuleDef[];
  tables: Record<string, string[]>;  // table display name → allowed module item names
}

export interface ModuleIndex {
  /** Pooled resource-cost reduction (0–1) for one recipe at the given slot selection. */
  reductionFor(table: string, skill: string, slots: ReadonlySet<ModuleSlot>): number;
  /** Which module each slot contributes — for showing what a reduction assumed. */
  breakdownFor(table: string, skill: string, slots: ReadonlySet<ModuleSlot>): AppliedModule[];
  /**
   * The slots this table exposes at all — those at least one allowed module can fill.
   * Skill-independent, matching ModuleSlotRegistry.CoreSlotNamesFor: a table shows a
   * Specialty slot if any allowed module is a specialty, even one for another skill.
   */
  availableSlotsFor(table: string): ModuleSlot[];
}

/**
 * Eco 14 module model.
 *
 * A table exposes at most one module per slot, drawn from its own allow-list.
 * Resource-cost bonuses are `BonusEffectAdditivePercent`, which the engine pools
 * additively and applies once as `x(1 + sum)` — so a slot selection collapses to a
 * single reduction fraction that slots straight into the existing planner math.
 *
 * Specialty modules are skill-scoped, so the reduction depends on the *recipe's*
 * skill, not just the table: a Machinist Table fitted with Mining Advanced Upgrade
 * gives -55% to Dynamite but only the generic -35% to its Mechanics recipes.
 *
 * Picking the best specialty per skill is an upper bound — one physical table holds
 * one specialty module — which is the intended reading of "maximum efficiency".
 */
export function buildModuleIndex(file: ModulesFile): ModuleIndex {
  // slot → modules offering it, strongest first, so the first allowed match wins.
  const bySlot = new Map<ModuleSlot, ModuleDef[]>();
  for (const slot of MODULE_SLOTS) {
    bySlot.set(
      slot,
      file.modules
        .filter(m => m.slot === slot)
        .sort((a, b) => b.resourceCostPercent - a.resourceCostPercent)
    );
  }

  const allowedByTable = new Map<string, Set<string>>(
    Object.entries(file.tables).map(([table, items]) => [table, new Set(items)])
  );

  // The skill must be part of the key: the same table yields different reductions
  // per skill whenever a specialty module is in play.
  const cache = new Map<string, AppliedModule[]>();

  function resolve(table: string, skill: string, slots: ReadonlySet<ModuleSlot>): AppliedModule[] {
    const slotKey = MODULE_SLOTS.filter(s => slots.has(s)).join(',');
    const key = `${table}|${skill}|${slotKey}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const allowed = allowedByTable.get(table);
    const applied: AppliedModule[] = [];
    // A table with no allow-list exposes no slots, so it takes no modules.
    if (allowed) {
      for (const slot of MODULE_SLOTS) {
        if (!slots.has(slot)) continue;
        const best = (bySlot.get(slot) ?? []).find(
          m => allowed.has(m.item) && (m.skill === null || m.skill === skill)
        );
        if (best) applied.push({ slot, module: best.name, reduction: best.resourceCostPercent });
      }
    }

    cache.set(key, applied);
    return applied;
  }

  const availableCache = new Map<string, ModuleSlot[]>();

  return {
    availableSlotsFor(table) {
      const cached = availableCache.get(table);
      if (cached) return cached;
      const allowed = allowedByTable.get(table);
      const slots = allowed
        ? MODULE_SLOTS.filter(slot => (bySlot.get(slot) ?? []).some(m => allowed.has(m.item)))
        : [];
      availableCache.set(table, slots);
      return slots;
    },
    reductionFor(table, skill, slots) {
      const total = resolve(table, skill, slots).reduce((sum, m) => sum + m.reduction, 0);
      // The engine clamps the pooled multiplier at 0 (MathF.Max(0f, 1f + sum)).
      return Math.min(total, 1);
    },
    breakdownFor(table, skill, slots) {
      return resolve(table, skill, slots);
    },
  };
}
