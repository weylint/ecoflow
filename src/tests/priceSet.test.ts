import { describe, it, expect } from 'vitest';
import { priceSetId } from '$lib/priceSet.js';
import { DEFAULT_SETTINGS, type AppSettings } from '$lib/settings.js';

const base = (): AppSettings => ({
  ...DEFAULT_SETTINGS,
  edmValues: { ...DEFAULT_SETTINGS.edmValues },
  edmTagDefaults: { ...DEFAULT_SETTINGS.edmTagDefaults },
});

describe('priceSetId', () => {
  it('is stable across key insertion order', () => {
    const a = base();
    const b = base();
    a.edmValues = { Iron: 1, Copper: 2 };
    b.edmValues = { Copper: 2, Iron: 1 };
    expect(priceSetId(a)).toBe(priceSetId(b));
  });

  it('changes when a price changes', () => {
    const a = base();
    const b = base();
    b.edmValues = { ...b.edmValues, Limestone: 99 };
    expect(priceSetId(a)).not.toBe(priceSetId(b));
  });

  it('changes when the markup or food model changes', () => {
    const a = base();
    const withMarkup = { ...base(), crossProfessionMarkup: 0.9 };
    const withoutFood = { ...base(), foodCostEnabled: !a.foodCostEnabled };
    expect(priceSetId(withMarkup)).not.toBe(priceSetId(a));
    expect(priceSetId(withoutFood)).not.toBe(priceSetId(a));
  });

  it('ignores settings that cannot move a number', () => {
    const a = base();
    const b: AppSettings = { ...base(), darkMode: !a.darkMode, groupByProfession: true, showNodeStats: !a.showNodeStats };
    // showNodeStats only hides the per-node breakdown; the plan's cost is the same.
    expect(priceSetId(b)).toBe(priceSetId(a));
  });

  it('is a short printable id', () => {
    expect(priceSetId(base())).toMatch(/^[0-9a-f]{8}$/);
  });
});
