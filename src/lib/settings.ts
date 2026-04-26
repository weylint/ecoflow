export interface FoodTierCosts {
  baseline: number;
  basic: number;
  advanced: number;
  modern: number;
}

export interface AppSettings {
  ecoMode: 'eco12' | 'eco13';
  edmValues: Record<string, number>;
  edmTagDefaults: Record<string, number>;
  crossProfessionMarkup: number;
  foodCostEnabled: boolean;
  foodTierCosts: FoodTierCosts;
  showNodeStats: boolean;
}

export const DEFAULT_EDM_TAG_DEFAULTS: Record<string, number> = {
  'Ore':            1.0,
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
  // Individual raw resources (no tag default)
  'Dirt':          0.01, // gathered resource; Incinerate Garbage recipe is excluded by default
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
};

export const DEFAULT_FOOD_TIER_COSTS: FoodTierCosts = {
  baseline: 1,
  basic: 3,
  advanced: 8,
  modern: 20,
};

export const DEFAULT_SETTINGS: AppSettings = {
  ecoMode: 'eco13',
  edmValues: { ...DEFAULT_EDM_VALUES },
  edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS },
  crossProfessionMarkup: 0.25,
  foodCostEnabled: true,
  foodTierCosts: { ...DEFAULT_FOOD_TIER_COSTS },
  showNodeStats: true,
};

const STORAGE_KEY = 'eco-planner-settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, edmValues: { ...DEFAULT_EDM_VALUES }, edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS } };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ecoMode: parsed.ecoMode ?? DEFAULT_SETTINGS.ecoMode,
      edmValues: { ...DEFAULT_EDM_VALUES, ...(parsed.edmValues ?? {}) },
      edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS, ...(parsed.edmTagDefaults ?? {}) },
      crossProfessionMarkup: parsed.crossProfessionMarkup ?? DEFAULT_SETTINGS.crossProfessionMarkup,
      foodCostEnabled: parsed.foodCostEnabled ?? DEFAULT_SETTINGS.foodCostEnabled,
      foodTierCosts: { ...DEFAULT_FOOD_TIER_COSTS, ...(parsed.foodTierCosts ?? {}) },
      showNodeStats: parsed.showNodeStats ?? DEFAULT_SETTINGS.showNodeStats,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, edmValues: { ...DEFAULT_EDM_VALUES }, edmTagDefaults: { ...DEFAULT_EDM_TAG_DEFAULTS } };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
