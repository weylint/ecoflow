import { describe, it, expect } from 'vitest';
import { unionRows, previousValue, serializeColumnTargets, parseColumnTargets } from '$lib/reportColumns.js';
import type { ReportColumn, ColumnSnapshot } from '$lib/reportColumns.js';

// Only the fields these helpers touch matter; the rest of ColumnSnapshot is unused here.
function snapshot(raw: Record<string, number>): ColumnSnapshot {
  return { rawByItem: new Map(Object.entries(raw)) } as unknown as ColumnSnapshot;
}

function column(mode: 'eco12' | 'eco13' | 'eco14', raw: Record<string, number> | null, isActive = false): ReportColumn {
  return {
    mode,
    label: mode,
    target: mode === 'eco14' ? { mode, slots: [] } : { mode, value: 0 },
    isActive,
    snapshot: raw === null ? null : snapshot(raw),
  };
}

const pick = (s: ColumnSnapshot) => s.rawByItem;

describe('unionRows', () => {
  it('returns the union of keys across all columns', () => {
    const rows = unionRows(
      [column('eco12', { Iron: 1 }), column('eco13', { Copper: 2 }), column('eco14', { Clay: 3 })],
      pick
    );
    expect(rows.map(r => r.key).sort()).toEqual(['Clay', 'Copper', 'Iron']);
  });

  it('fills 0 for a key a column simply does not use', () => {
    const rows = unionRows([column('eco13', { Iron: 5 }), column('eco14', { Copper: 2 })], pick);
    expect(rows.find(r => r.key === 'Iron')!.values).toEqual([5, 0]);
    expect(rows.find(r => r.key === 'Copper')!.values).toEqual([0, 2]);
  });

  it('distinguishes an absent column from a zero value', () => {
    // null = that version could not be planned at all; 0 = planned, but does not use it.
    const rows = unionRows([column('eco12', null), column('eco14', { Iron: 5 })], pick);
    expect(rows[0].values).toEqual([null, 5]);
  });

  it('sorts by the active column, not the first one', () => {
    const rows = unionRows(
      [column('eco12', { A: 100, B: 1 }), column('eco14', { A: 1, B: 100 }, true)],
      pick
    );
    expect(rows.map(r => r.key)).toEqual(['B', 'A']);
  });

  it('falls back to the first column with data when the active one has none', () => {
    const rows = unionRows(
      [column('eco12', { A: 1, B: 100 }), column('eco14', null, true)],
      pick
    );
    expect(rows.map(r => r.key)).toEqual(['B', 'A']);
  });

  it('derives meta from the first column that has the key', () => {
    const rows = unionRows(
      [column('eco12', null), column('eco13', { Iron: 5 }), column('eco14', { Iron: 3 })],
      pick,
      (key, s) => ({ amount: s.rawByItem.get(key) })
    );
    // eco12 has no snapshot, so meta comes from eco13 — the row still labels itself.
    expect(rows[0].meta).toEqual({ amount: 5 });
  });
});

describe('previousValue', () => {
  it('returns null for the first column', () => {
    expect(previousValue([10, 20, 30], 0)).toBeNull();
  });

  it('returns the immediately preceding value', () => {
    expect(previousValue([10, 20, 30], 2)).toBe(20);
  });

  it('skips columns with no data rather than blanking the delta', () => {
    // Steam Truck missing from Eco 13 must not stop Eco 14 comparing against Eco 12.
    expect(previousValue([10, null, 30], 2)).toBe(10);
  });

  it('returns null when nothing earlier has data', () => {
    expect(previousValue([null, null, 30], 2)).toBeNull();
  });

  it('treats a real zero as data, not as missing', () => {
    expect(previousValue([0, 5], 1)).toBe(0);
  });
});

describe('column target URL codec', () => {
  const targets = {
    eco12: { mode: 'eco12', value: 0.5 },
    eco13: { mode: 'eco13', value: 0.25 },
    eco14: { mode: 'eco14', slots: ['Basic', 'Modern'] },
  } as const;

  it('round-trips every version', () => {
    const encoded = serializeColumnTargets(targets as any);
    expect(encoded).toBe('eco12:0.5;eco13:0.25;eco14:basic,modern');
    expect(parseColumnTargets(encoded)).toEqual(targets);
  });

  it('encodes an empty Eco 14 slot set distinctly from a missing one', () => {
    const encoded = serializeColumnTargets({ ...targets, eco14: { mode: 'eco14', slots: [] } } as any);
    expect(encoded).toContain('eco14:');
    expect(parseColumnTargets(encoded).eco14).toEqual({ mode: 'eco14', slots: [] });
  });

  it('normalises slot order and casing so equivalent links match', () => {
    expect(parseColumnTargets('eco14:MODERN,basic').eco14).toEqual({ mode: 'eco14', slots: ['Basic', 'Modern'] });
  });

  it('skips entries it cannot parse rather than discarding the whole link', () => {
    const parsed = parseColumnTargets('eco12:0.5;eco99:1;eco14:bogus;eco13:0.25');
    expect(Object.keys(parsed).sort()).toEqual(['eco12', 'eco13']);
  });

  it('rejects an out-of-range upgrade fraction', () => {
    expect(parseColumnTargets('eco13:7').eco13).toBeUndefined();
    expect(parseColumnTargets('eco13:-1').eco13).toBeUndefined();
  });

  it('returns nothing for an absent parameter', () => {
    expect(parseColumnTargets(null)).toEqual({});
    expect(parseColumnTargets('')).toEqual({});
  });
});
