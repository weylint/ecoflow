import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import ReportModal from '$lib/components/ReportModal.svelte';
import type { ColumnSnapshot, ReportColumn } from '$lib/reportColumns.js';
import { usesModuleSlots } from '$lib/types.js';
import type { EcoMode } from '$lib/types.js';
import { DEFAULT_SETTINGS } from '$lib/settings.js';

function snapshot(raw: Record<string, number>, produced = 1): ColumnSnapshot {
  return {
    rawByItem: new Map(Object.entries(raw)),
    marketByItem: new Map(),
    tagByName: new Map(),
    byproductByKey: new Map(),
    laborByTable: new Map(),
    laborByProfession: new Map(),
    valueAddedByTable: new Map(),
    edmReport: {
      // Priced, so the Raw Ingredients trailing columns have values and no ⚠ shows.
      rawCosts: Object.entries(raw).map(([itemName, amount]) => ({
        itemName, amount, edmPerUnit: 2, totalEdm: amount * 2,
      })),
      crossProfTransitions: [], baseEdm: 10, laborFoodEdm: 1,
      markupEdm: 2, totalEdm: 13, missingItems: [],
      nodeEdm: new Map(), tableEdm: new Map(), tableValueAdded: new Map(),
    },
    tableNodes: [],
    producedAmount: produced,
  } as ColumnSnapshot;
}

function column(mode: EcoMode, raw: Record<string, number> | null, isActive = false): ReportColumn {
  return {
    mode,
    label: mode,
    target: usesModuleSlots(mode) ? { mode, slots: [] } : { mode, value: 0 },
    isActive,
    snapshot: raw === null ? null : snapshot(raw),
  };
}

function renderReport(columns: ReportColumn[]) {
  return render(ReportModal, {
    props: {
      columns,
      settings: DEFAULT_SETTINGS,
      selectedProduct: 'Steam Truck',
      requestedAmount: 1,
      onTargetChange: () => {},
      onClose: () => {},
    },
  });
}

const rowFor = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('tbody tr')]
    .find(tr => tr.querySelector('td')?.textContent?.trim().startsWith(label));

describe('ReportModal', () => {
  it('renders one column per version, in the order given', () => {
    const { container } = renderReport([
      column('eco12', { Iron: 40 }),
      column('eco13', { Iron: 120 }),
      column('eco14', { Iron: 40 }, true),
    ]);
    const chips = [...container.querySelectorAll('.version-chip .chip-name')].map(e => e.textContent);
    expect(chips).toEqual(['Eco 12', 'Eco 13', 'Eco 14']);
  });

  it('shows a delta for every column after the first', () => {
    const { container } = renderReport([
      column('eco12', { Iron: 40 }),
      column('eco13', { Iron: 120 }),
      column('eco14', { Iron: 40 }, true),
    ]);
    const row = rowFor(container, 'Iron')!;
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent!.trim());
    // label, eco12, Δ, eco13, Δ, eco14, then the two per-item EDM columns.
    // Each Δ sits immediately before the version it explains; the first version
    // has nothing to compare against, so it carries no Δ.
    // The glyph pairs with the colour so the signal is not carried by colour alone.
    expect(cells.slice(0, 6)).toEqual(['Iron', '40', '▲ +200%', '120', '▼ -67%', '40']);
  });

  it('colours a cost increase as bad and a decrease as good', () => {
    const { container } = renderReport([
      column('eco12', { Iron: 40 }),
      column('eco13', { Iron: 120 }),
      column('eco14', { Iron: 40 }, true),
    ]);
    const deltas = [...rowFor(container, 'Iron')!.querySelectorAll('.col-delta')];
    expect(deltas[0].className).toContain('delta-bad');   // 40 → 120 costs more
    expect(deltas[1].className).toContain('delta-good');  // 120 → 40 costs less
  });

  it('marks a version that could not be planned and dashes its cells', () => {
    const { container } = renderReport([
      column('eco12', null),
      column('eco13', { Iron: 120 }),
      column('eco14', { Iron: 40 }, true),
    ]);
    expect(container.textContent).toContain('unavailable');
    const cells = [...rowFor(container, 'Iron')!.querySelectorAll('td')].map(td => td.textContent!.trim());
    expect(cells[1]).toBe('—');       // eco12 has no data
    expect(cells[2]).toBe('—');       // no earlier column to compare against
    expect(cells[3]).toBe('120');     // eco13
  });

  it('skips an unavailable version when computing the next delta', () => {
    const { container } = renderReport([
      column('eco12', { Iron: 40 }),
      column('eco13', null),
      column('eco14', { Iron: 20 }, true),
    ]);
    const cells = [...rowFor(container, 'Iron')!.querySelectorAll('td')].map(td => td.textContent!.trim());
    // Eco 14 compares against Eco 12 rather than blanking because Eco 13 is missing.
    expect(cells.slice(0, 6)).toEqual(['Iron', '40', '—', '—', '▼ -50%', '20']);
  });

  it('flags a raw item with no EDM value', () => {
    const col = column('eco14', { Iron: 40 }, true);
    col.snapshot!.edmReport.rawCosts = [{ itemName: 'Iron', amount: 40, edmPerUnit: null, totalEdm: null }];
    const { container } = renderReport([col]);
    expect(rowFor(container, 'Iron')!.textContent).toContain('⚠');
  });

  it('marks which version is being planned', () => {
    const { container } = renderReport([
      column('eco12', { Iron: 40 }),
      column('eco13', { Iron: 120 }, true),
      column('eco14', { Iron: 40 }),
    ]);
    const active = container.querySelector('.version-chip.chip-active');
    expect(active?.textContent).toContain('Eco 13');
    expect(active?.textContent).toContain('planning');
  });

  it('renders every section even when its data is empty', () => {
    const { container } = renderReport([column('eco14', { Iron: 40 }, true)]);
    // Section titles carry a muted note ("per Steam Truck"); compare the title only.
    const headings = [...container.querySelectorAll('h3')].map(h => {
      const clone = h.cloneNode(true) as HTMLElement;
      clone.querySelector('.sec-note')?.remove();
      return clone.textContent!.trim();
    });
    expect(headings).toEqual([
      'Summary', 'Resources', 'Labor', 'Value Added', 'Cross-profession transitions',
    ]);
    // Sections with no rows say so rather than vanishing.
    expect(container.querySelectorAll('.empty').length).toBeGreaterThan(0);
  });
});
