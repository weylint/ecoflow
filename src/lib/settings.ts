import type { EcoMode, LayoutOptions, ModuleSlot } from './types.js';
import type { SandboxPatch } from './sandbox.js';
import { EMPTY_SANDBOX_PATCH, parseSandboxPatch } from './sandbox.js';
import { DEFAULT_LAYOUT_OPTIONS, DEFAULT_MODULE_SLOTS, DEFAULT_TAG_CHOICES, isModuleSlot } from './types.js';

export interface FoodTierCosts {
  baseline: number;
  basic: number;
  advanced: number;
  modern: number;
}

export interface AppSettings {
  ecoMode: EcoMode;
  edmValues: Record<string, number>;
  edmTagDefaults: Record<string, number>;
  crossProfessionMarkup: number;
  foodCostEnabled: boolean;
  foodTierCosts: FoodTierCosts;
  showNodeStats: boolean;
  // Optional so existing AppSettings literals (tests, CLI) stay valid;
  // loadSettings always fills them.
  darkMode?: boolean;
  groupByProfession?: boolean;
  layoutOptions?: LayoutOptions;
  tagDefaults?: Record<string, string>;
  // Eco 14 only: which of the four module slots are filled. Eco 12/13 use the
  // globalUpgrade ladder instead.
  moduleSlots?: ModuleSlot[];
  // The Sandbox version's recipe and talent overrides.
  sandboxPatch?: SandboxPatch;
}

export const DEFAULT_EDM_TAG_DEFAULTS: Record<string, number> = {
  'Ore':            2.0,
  'Rock':           0.05,
  'Wood':           0.5,
  'Crop':           0.3,
  'Fungus':         0.3,
  'Grain':          0.3,
  'Fruit':          0.3,
  'Greens':         0.3,
  'Natural Fiber':  0.1,
  'Petals':         0.2,
  'Seeds':          0.3,
  'Vegetable':      0.3,
  'Medium Carcass': 15,
  'Small Carcass':  6,
  'Tiny Carcass':   3,
  'Medium Fish':    0.5,
  'Large Fish':     1.5,
};

export const DEFAULT_EDM_VALUES: Record<string, number> = {
  // Exceptions that override tag defaults
  'Limestone':     0.15, // Rock tag default is 0.05; Silica rocks (Granite, Sandstone) use tag default
  'Basalt':        0.025,
  'Gneiss':        0.025,
  'Shale':         0.025,
  'Stone':         0.025,
  'Pineapple':     0.4,  // Fruit tag default is 0.3
  'Crab Carcass':  0.3,  // Small Fish tag (no default set)
  'Bison Carcass': 30,   // No tag
  // Ore tag overrides (tag default is 2.0)
  'Copper Ore':    4,
  'Gold Ore':      4,
  'Coal':          1,
  // Individual raw resources (no tag default)
  'Dirt':          0.01, // gathered resource; Incinerate Garbage recipe is excluded by default
  'Compost':       0.01, // only ever a byproduct (raw node); negligible cost
  // Individual raw resources (no tag default)
  'Clay':         0.5,
  'Cotton Boll':  0.2,
  'Flax Stem':    0.2,
  'Peat':         3,
  'Shorn Wool':   1,
  'Sulfur':       0.4,
  'Acorn':        0.2,
  'Sunflower':    0.2,
  'Urchin':       0.2,
  // Waste / recycling feedstock: nothing produces these, so they arrive as raw
  // leaves. Negligible value, like Dirt and Compost above.
  'Bio Residue':       0.01,
  'Food Scrap':        0.01,
  'Glass Scrap':       0.01,
  'Plastic Scrap':     0.01,
  'Electronic Scrap':  0.01,
  'Tailings':          0.01,
  'Wet Tailings':      0.01,
  'Spoiled Food':      0.01, // eco12 / eco13 only
  // Marine life with no usable tag default. Deliberately per-item: a 'Fish' or
  // 'Small Fish' tag default would be picked ahead of 'Large Fish' for items
  // carrying both, since resolveItemEdmValue takes the first matching tag.
  'Clam':              0.2,
  'Moon Jellyfish':    0.2,
  'Pacific Sardine':   0.3,
};

export const DEFAULT_FOOD_TIER_COSTS: FoodTierCosts = {
  baseline: 1,
  basic: 3,
  advanced: 8,
  modern: 20,
};

export const DEFAULT_SETTINGS: AppSettings = {
  ecoMode: 'eco14',
  edmValues: { ...DEFAULT_EDM_VALUES },
  edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS },
  crossProfessionMarkup: 0.25,
  foodCostEnabled: true,
  foodTierCosts: { ...DEFAULT_FOOD_TIER_COSTS },
  showNodeStats: true,
  darkMode: true,
  groupByProfession: false,
  layoutOptions: { ...DEFAULT_LAYOUT_OPTIONS },
  tagDefaults: { ...DEFAULT_TAG_CHOICES },
  moduleSlots: [...DEFAULT_MODULE_SLOTS],
  sandboxPatch: { ...EMPTY_SANDBOX_PATCH },
};

const STORAGE_KEY = 'eco-planner-settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, edmValues: { ...DEFAULT_EDM_VALUES }, edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS } };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ecoMode: parsed.ecoMode ?? DEFAULT_SETTINGS.ecoMode,
      // Persisted maps are taken verbatim (not merged with defaults) so that
      // user deletions of default entries survive a reload.
      edmValues: parsed.edmValues ?? { ...DEFAULT_EDM_VALUES },
      edmTagDefaults: parsed.edmTagDefaults ?? { ...DEFAULT_EDM_TAG_DEFAULTS },
      crossProfessionMarkup: parsed.crossProfessionMarkup ?? DEFAULT_SETTINGS.crossProfessionMarkup,
      foodCostEnabled: parsed.foodCostEnabled ?? DEFAULT_SETTINGS.foodCostEnabled,
      foodTierCosts: { ...DEFAULT_FOOD_TIER_COSTS, ...(parsed.foodTierCosts ?? {}) },
      showNodeStats: parsed.showNodeStats ?? DEFAULT_SETTINGS.showNodeStats,
      darkMode: parsed.darkMode ?? true,
      groupByProfession: parsed.groupByProfession ?? false,
      layoutOptions: { ...DEFAULT_LAYOUT_OPTIONS, ...(parsed.layoutOptions ?? {}) },
      tagDefaults: parsed.tagDefaults ?? { ...DEFAULT_TAG_CHOICES },
      // Filter rather than trust: a slot name removed from a future Eco version
      // must not survive in localStorage and resolve to a module that is gone.
      moduleSlots: Array.isArray(parsed.moduleSlots)
        ? parsed.moduleSlots.filter(isModuleSlot)
        : [...DEFAULT_MODULE_SLOTS],
      // Validated rather than trusted: a hand-edited or stale patch must not
      // reach applySandboxPatch with a non-numeric amount in it.
      sandboxPatch: parseSandboxPatch(parsed.sandboxPatch) ?? { ...EMPTY_SANDBOX_PATCH },
    };
  } catch {
    return { ...DEFAULT_SETTINGS, edmValues: { ...DEFAULT_EDM_VALUES }, edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS } };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
