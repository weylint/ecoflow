<script lang="ts">
  import type { ReportColumn, ReportRow } from '../reportColumns.js';
  import { previousValue } from '../reportColumns.js';
  import { fmtDeltaPct } from '../format.js';

  interface TrailingColumn {
    header: string;
    /** Rendered text for this row, or null for an em dash. */
    cell: (row: ReportRow<any>) => string | null;
    /** Dims the cell the way a missing EDM value is dimmed elsewhere. */
    dim?: (row: ReportRow<any>) => boolean;
  }

  interface Props {
    columns: readonly ReportColumn[];
    /** One header per leading label column; rows supply the same number of labels. */
    labelHeaders: string[];
    rows: ReportRow<any>[];
    labels: (row: ReportRow<any>) => string[];
    format: (n: number) => string;
    /** Costs: a drop is good (green). Yields: a drop is bad (red). */
    lowerIsBetter?: boolean;
    /** Per-row values that are not per-version, e.g. EDM per unit. */
    trailing?: TrailingColumn[];
    /** Marks a row as having a problem (missing EDM value). */
    warn?: (row: ReportRow<any>) => boolean;
    empty?: string;
  }

  let {
    columns, labelHeaders, rows, labels, format,
    lowerIsBetter = true, trailing = [], warn, empty = 'None'
  }: Props = $props();

  // A delta is only meaningful once a previous version has data to compare against.
  const deltaClass = (from: number | null, to: number | null) => {
    if (from === null || to === null || from === to) return '';
    const cheaper = to < from;
    return (cheaper === lowerIsBetter) ? 'delta-good' : 'delta-bad';
  };

  // Direction glyph so the good/bad signal is not carried by colour alone —
  // it survives greyscale, printing and red-green colour deficiency.
  const deltaGlyph = (from: number | null, to: number | null) => {
    if (from === null || to === null || from === to) return '';
    return to > from ? '▲ ' : '▼ ';
  };

  // Every section's table shares one column grid, so a version's column sits at
  // the same x all the way down the report — the way a spreadsheet's column B
  // does not move between sheets. Percentages of the table width (each table is
  // width: 100% of the same body) with `table-layout: fixed`, which makes the
  // widths binding instead of a hint the content can push around.
  // These must sum to under 100% even for the widest section (Raw Ingredients,
  // the only one with trailing columns), or the browser scales every column down
  // and the grid stops matching the sections that have none.
  // Four versions (Sandbox is showing) need a tighter grid than three.
  const wide = $derived(columns.length >= 4);
  const LABEL_BLOCK = $derived(wide ? 30 : 38);   // % shared by all leading label columns
  const DELTA_W = $derived(wide ? 5.2 : 6.2);     // % per Δ column
  const VALUE_W = $derived(wide ? 10.5 : 12);     // % per version column
  const TRAILING_W = $derived(wide ? 6 : 6.5);    // % per trailing column

  // The name columns carry the content worth reading — 'Table' and '→ Item'
  // get the room, 'Profession' is a short fixed vocabulary.
  const LABEL_WEIGHTS = [1.6, 1.4, 1];

  const labelWidths = $derived(
    labelHeaders.map((_, i) => LABEL_WEIGHTS[i] ?? 1)
      .map((w, _, all) => (LABEL_BLOCK * w) / all.reduce((a, b) => a + b, 0))
  );

  /** The version each Δ compares against, for its header tooltip. */
  const comparedWith = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      if (columns[j].snapshot) return columns[j].label;
    }
    return columns[i - 1]?.label ?? '';
  };
</script>

{#if rows.length === 0}
  <p class="empty">{empty}</p>
{:else}
  <table>
    <colgroup>
      {#each labelWidths as w}<col style="width: {w}%" />{/each}
      {#each columns as _, i}
        {#if i > 0}<col style="width: {DELTA_W}%" />{/if}
        <col style="width: {VALUE_W}%" />
      {/each}
      {#each trailing as _}<col style="width: {TRAILING_W}%" />{/each}
      <!-- Unsized, so it absorbs the slack and every other column keeps its exact
           width whether or not the section has trailing columns. -->
      <col />
    </colgroup>
    <thead>
      <tr>
        {#each labelHeaders as header}
          <th class="item-name col-hdr">{header}</th>
        {/each}
        {#each columns as col, i}
          {#if i > 0}
            <th
              class="item-amt col-hdr col-delta col-group-start"
              title="Δ {col.label} vs {comparedWith(i)}"
            >Δ</th>
          {/if}
          <th class="item-amt col-hdr" class:col-active={col.isActive} class:col-group-start={i === 0}>
            {col.label}{#if !col.snapshot}<span class="col-missing"> (n/a)</span>{/if}
          </th>
        {/each}
        {#each trailing as t}
          <th class="item-amt col-hdr col-group-start">{t.header}</th>
        {/each}
        <th class="col-spacer"></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row}
        {@const rowLabels = labels(row)}
        <tr>
          {#each rowLabels as label, i}
            <td
              class="item-name"
              class:muted={i > 0}
              class:edm-missing-name={i === 0 && warn?.(row)}
              title={label}
            >
              {label}{#if i === 0 && warn?.(row)} ⚠{/if}
            </td>
          {/each}
          {#each columns as col, i}
            {@const value = row.values[i]}
            {#if i > 0}
              {@const prev = previousValue(row.values, i)}
              <td class="item-amt col-delta col-group-start {deltaClass(prev, value)}">
                {#if prev === null || value === null}
                  —
                {:else}{deltaGlyph(prev, value)}{fmtDeltaPct(prev, value)}{/if}
              </td>
            {/if}
            <td
              class="item-amt"
              class:col-active={col.isActive}
              class:col-history={!col.isActive}
              class:col-group-start={i === 0}
            >
              {value === null ? '—' : format(value)}
            </td>
          {/each}
          {#each trailing as t}
            {@const text = t.cell(row)}
            <td class="item-amt col-group-start" class:edm-missing={t.dim?.(row)}>{text ?? '—'}</td>
          {/each}
          <td class="col-spacer"></td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  /* Fixed layout is what makes the colgroup binding: without it the widest
     cell in a section would still drag its column out of the shared grid. */
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }

  /* The report body is the scroll container, so top: 0 pins these directly
     under the header bars with no height coupling to nudge. */
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--bg-panel);
    box-shadow: inset 0 -1px 0 var(--border-subtle);
  }

  .col-hdr {
    font-size: 11px;
    color: var(--text-muted);
    text-align: right;
    font-weight: normal;
    padding: 2px 6px 3px;
  }

  /* Headers wrap rather than widen — the column width is fixed now, and
     'Eco 14 · all modules' would otherwise be clipped mid-word. Needs to
     out-specify .item-amt's nowrap, which the same cells also carry. */
  th.col-hdr {
    white-space: normal;
    overflow-wrap: anywhere;
    vertical-align: bottom;
  }

  .col-hdr.item-name { text-align: left; }
  .col-active { color: var(--num); }
  th.col-active { font-weight: bold; }
  .col-missing { color: var(--edm-missing); }

  /* Each Δ opens the group belonging to the version on its right. */
  .col-group-start { border-left: 1px solid var(--border-subtle); padding-left: 12px; }
  /* Neutral deltas stay quiet; .delta-good/.delta-bad below override the colour. */
  .col-delta { font-size: 11px; padding-right: 2px; color: var(--text-muted); }

  .item-name {
    text-align: left;
    padding: 1px 8px 1px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-name.muted { color: var(--text-muted); }

  .item-amt {
    text-align: right;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--num);
    white-space: nowrap;
  }

  /* Frozen versions stay readable but stop competing with the version being planned. */
  td.col-history { color: var(--num-history); }

  tbody tr:nth-child(even) { background: var(--row-zebra); }
  tbody tr:hover { background: var(--row-hover); }

  .delta-good { color: var(--delta-good); }
  .delta-bad { color: var(--delta-bad); }
  .edm-missing { color: var(--edm-missing); }
  .edm-missing-name { color: var(--edm-missing); }
  /* Eats the width no section uses, so the sized columns never get stretched. */
  .col-spacer { padding: 0; }

  .empty { color: var(--text-muted); font-style: italic; margin: 2px 0; }
</style>
