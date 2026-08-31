<script lang="ts">
  import type { ReportColumn, ColumnTarget, ReportRow } from '../reportColumns.js';
  import { unionRows } from '../reportColumns.js';
  import type { AppSettings } from '../settings.js';
  import type { EcoMode, ModuleSlot } from '../types.js';
  import { ECO_MODE_LABELS, MODULE_SLOTS, getUpgradeLevels, usesModuleSlots } from '../types.js';
  import { fmtNum, fmtValue } from '../format.js';
  import ReportTable from './ReportTable.svelte';

  interface Props {
    columns: ReportColumn[];
    settings: AppSettings;
    selectedProduct: string;
    requestedAmount: number;
    onTargetChange: (mode: EcoMode, target: ColumnTarget) => void;
    onClose: () => void;
  }

  let { columns, settings, selectedProduct, requestedAmount, onTargetChange, onClose }: Props = $props();

  let expandedTransition = $state<string | null>(null);
  let copyLinkLabel = $state('Copy Link');
  let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
  let showAllTransitions = $state(false);
  let panelEl = $state<HTMLDivElement | null>(null);
  let bodyEl = $state<HTMLDivElement | null>(null);

  // The report runs to several thousand pixels; the tail of the transition list
  // is worth fractions of an EDM, so it is opt-in rather than always rendered.
  const TRANSITION_LIMIT = 30;

  const SECTIONS = [
    { id: 'report-summary', label: 'Summary' },
    { id: 'report-resources', label: 'Resources' },
    { id: 'report-labor', label: 'Labor' },
    { id: 'report-value-added', label: 'Value Added' },
    { id: 'report-cross-prof', label: 'Cross-profession' },
  ];

  // Section anchors live inside .report-body, which is the scroll container —
  // scrolling the window would do nothing here.
  function jumpTo(id: string) {
    const target = bodyEl?.querySelector<HTMLElement>(`#${id}`);
    if (!target || !bodyEl) return;
    bodyEl.scrollTo({ top: target.offsetTop - bodyEl.offsetTop, behavior: 'smooth' });
  }

  // Number shapes, stated once per kind of figure rather than per call site.
  const fmtEdmCell = (n: number) => fmtValue(n, { decimals: 2 });
  const fmtAmount = (n: number) => fmtValue(n, { decimals: 0 });
  const fmtLaborCell = (n: number) => fmtValue(n, { decimals: 1, compact: true });

  $effect(() => {
    // The overlay owns Escape and initial focus; before this the modal relied on
    // a window handler in +page.svelte and never took focus at all.
    const opener = document.activeElement as HTMLElement | null;
    panelEl?.focus();
    return () => opener?.focus?.();
  });

  // The version being planned. Its cross-profession chains and EDM detail are the
  // ones worth drilling into, since the other columns are hypothetical rebuilds.
  const active = $derived(columns.find(c => c.isActive && c.snapshot) ?? columns.find(c => c.snapshot) ?? null);
  const activeSnapshot = $derived(active?.snapshot ?? null);

  // Per-unit figures divide by what was actually produced — batch rounding can push
  // that above the requested amount, and it differs per version.
  const perUnit = (col: ReportColumn, total: number | null): number | null => {
    const produced = col.snapshot?.producedAmount ?? 0;
    return total === null || produced <= 0 ? null : total / produced;
  };

  // ── Rows ──────────────────────────────────────────────────────────────────
  const summaryRows = $derived.by((): ReportRow<{ emphasis: boolean }>[] => {
    const metric = (
      key: string,
      pick: (c: ReportColumn) => number | null,
      emphasis = false
    ): ReportRow<{ emphasis: boolean }> => ({
      key,
      values: columns.map(c => (c.snapshot ? perUnit(c, pick(c)) : null)),
      meta: { emphasis },
    });
    const rows = [
      metric('Base EDM', c => c.snapshot!.edmReport.baseEdm),
      metric('Food EDM', c => c.snapshot!.edmReport.laborFoodEdm),
      metric('Profession markup', c => c.snapshot!.edmReport.markupEdm),
      metric('Total EDM', c => c.snapshot!.edmReport.totalEdm, true),
    ];
    // Drop rows that are zero or absent everywhere, so the summary stays tight.
    return rows.filter(r => r.meta.emphasis || r.values.some(v => v !== null && v !== 0));
  });

  const outputRows = $derived.by((): ReportRow<undefined>[] => [
    { key: 'Produced', values: columns.map(c => c.snapshot?.producedAmount ?? null), meta: undefined },
  ]);

  const rawRows = $derived(unionRows(columns, s => s.rawByItem));
  const marketRows = $derived(unionRows(columns, s => s.marketByItem));
  const tagRows = $derived(unionRows(columns, s => s.tagByName));

  const byproductRows = $derived(unionRows(
    columns,
    s => s.byproductByKey,
    key => ({ item: key.split(':')[1] ?? key, from: key.split(':from:')[1] ?? '' })
  ));

  const laborProfRows = $derived(unionRows(columns, s => s.laborByProfession));

  const laborTableRows = $derived(unionRows(
    columns,
    s => new Map([...s.laborByTable].map(([id, v]) => [id, v.labor])),
    (key, s) => s.laborByTable.get(key)!
  ));

  const vaTableRows = $derived(unionRows(
    columns,
    s => new Map([...s.valueAddedByTable].map(([id, v]) => [id, v.va ?? 0])),
    (key, s) => s.valueAddedByTable.get(key)!
  ));

  const vaProfRows = $derived(unionRows(columns, s => {
    const map = new Map<string, number>();
    for (const v of s.valueAddedByTable.values()) {
      map.set(v.profession, (map.get(v.profession) ?? 0) + (v.va ?? 0));
    }
    return map;
  }));

  const rawCostOf = (item: string) => activeSnapshot?.edmReport.rawCosts.find(r => r.itemName === item) ?? null;
  const isMissingEdm = (row: ReportRow<any>) => {
    const cost = rawCostOf(row.key);
    // No cost entry means the active version does not use the item at all —
    // that is an absence, not an unpriced ingredient.
    return cost ? cost.edmPerUnit === null : false;
  };

  const transitions = $derived(
    [...(activeSnapshot?.edmReport.crossProfTransitions ?? [])]
      .sort((a, b) => (b.markupAmount ?? -Infinity) - (a.markupAmount ?? -Infinity))
  );

  const visibleTransitions = $derived(
    showAllTransitions ? transitions : transitions.slice(0, TRANSITION_LIMIT)
  );

  const activeProduced = $derived(activeSnapshot?.producedAmount || requestedAmount);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="report-overlay" role="dialog" aria-modal="true" aria-labelledby="report-title" tabindex="-1"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
  <div class="report-panel" bind:this={panelEl} tabindex="-1">
    <div class="report-header">
      <h2 id="report-title">Production Report</h2>
      <span class="report-subject">{fmtNum(requestedAmount)} × {selectedProduct}</span>
      <button
        class="copy-link-btn"
        onclick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            copyLinkLabel = 'Copied!';
            if (copyResetTimer) clearTimeout(copyResetTimer);
            copyResetTimer = setTimeout(() => { copyLinkLabel = 'Copy Link'; }, 1500);
          } catch {
            // No clipboard permission: the prompt is the confirmation.
            prompt('Copy this link:', window.location.href);
          }
        }}
      >{copyLinkLabel}</button>
      <button class="close-btn" onclick={onClose} aria-label="Close report">✕</button>
    </div>

    <div class="version-bar">
      {#each columns as col}
        <div class="version-chip" class:chip-active={col.isActive} class:chip-missing={!col.snapshot}>
          <span class="chip-name">{ECO_MODE_LABELS[col.mode]}</span>
          {#if col.isActive}<span class="chip-tag">planning</span>{/if}
          {#if usesModuleSlots(col.mode)}
            <!-- Four independent slots, matching the planner toolbar. This used to be
                 a select over cumulative presets (Basic → +Advanced → +Modern → max),
                 which made 11 of the 16 combinations unreachable — you could not drop
                 Modern alone and keep Specialty. -->
            {@const slots = new Set('slots' in col.target ? col.target.slots : [])}
            <span class="chip-slots">
              {#each MODULE_SLOTS as slot}
                <label class="chip-slot">
                  <input
                    type="checkbox"
                    checked={slots.has(slot)}
                    onchange={(e) => {
                      const next = new Set(slots);
                      if ((e.target as HTMLInputElement).checked) next.add(slot);
                      else next.delete(slot);
                      // Normalised through MODULE_SLOTS so the order matches what
                      // parseColumnTargets produces and shared links compare equal.
                      onTargetChange(col.mode, { mode: col.mode as 'eco14' | 'sandbox', slots: MODULE_SLOTS.filter(x => next.has(x)) });
                    }}
                  />
                  {slot}
                </label>
              {/each}
            </span>
          {:else}
            <select
              value={'value' in col.target ? col.target.value : 0}
              onchange={(e) => onTargetChange(col.mode, {
                mode: col.mode as 'eco12' | 'eco13',
                value: Number((e.target as HTMLSelectElement).value)
              })}
            >
              {#each getUpgradeLevels(col.mode as 'eco12' | 'eco13') as lvl}
                <option value={lvl.value}>{lvl.label}</option>
              {/each}
            </select>
          {/if}
          {#if !col.snapshot}<span class="chip-missing-note">unavailable</span>{/if}
        </div>
      {/each}
      <span class="version-hint">Δ vs. previous version · red = higher cost</span>
    </div>

    <nav class="jump-bar" aria-label="Report sections">
      {#each SECTIONS as sec, i}
        {#if i > 0}<span class="jump-sep">·</span>{/if}
        <button class="jump-link" onclick={() => jumpTo(sec.id)}>{sec.label}</button>
      {/each}
    </nav>

    <div class="report-body" bind:this={bodyEl}>
      <section id="report-summary">
        <h3>Summary <span class="sec-note">per {selectedProduct}</span></h3>
        <ReportTable
          {columns} labelHeaders={['']} rows={summaryRows}
          labels={(r) => [r.key]} format={fmtEdmCell} lowerIsBetter
        />
        <h4>Output</h4>
        <ReportTable
          {columns} labelHeaders={['']} rows={outputRows}
          labels={(r) => [r.key]} format={fmtAmount} lowerIsBetter={false}
        />
      </section>

      <section id="report-resources">
        <h3>Resources</h3>
        <h4>Raw Ingredients</h4>
        <ReportTable
          {columns} labelHeaders={['Item']} rows={rawRows}
          labels={(r) => [r.key]} format={fmtAmount} lowerIsBetter
          warn={isMissingEdm}
          trailing={[
            { header: 'EDM/u',
              cell: (r) => { const c = rawCostOf(r.key); return c?.edmPerUnit != null ? fmtEdmCell(c.edmPerUnit) : null; },
              dim: isMissingEdm },
            { header: `EDM/${selectedProduct}`,
              cell: (r) => { const c = rawCostOf(r.key); return c?.totalEdm != null ? fmtEdmCell(c.totalEdm / activeProduced) : null; },
              dim: isMissingEdm },
          ]}
        />
        <h4>Market Purchases</h4>
        <ReportTable
          {columns} labelHeaders={['Item']} rows={marketRows}
          labels={(r) => [r.key]} format={fmtAmount} lowerIsBetter
        />
        <h4>Unresolved Tags</h4>
        <ReportTable
          {columns} labelHeaders={['Tag']} rows={tagRows}
          labels={(r) => [r.key]} format={fmtAmount} lowerIsBetter
        />
        <h4>Byproducts</h4>
        <ReportTable
          {columns} labelHeaders={['Item', 'Producer']} rows={byproductRows}
          labels={(r) => [r.meta.item, r.meta.from ? `from ${r.meta.from}` : '']}
          format={fmtAmount} lowerIsBetter={false}
        />
      </section>

      <section id="report-labor">
        <h3>Labor</h3>
        <h4>By Profession</h4>
        <ReportTable
          {columns} labelHeaders={['Profession']} rows={laborProfRows}
          labels={(r) => [r.key]} format={fmtLaborCell} lowerIsBetter
        />
        <h4>By Table</h4>
        <ReportTable
          {columns} labelHeaders={['Table', 'Item']} rows={laborTableRows}
          labels={(r) => [r.meta?.table ?? r.key, r.meta?.item ? `→ ${r.meta.item}` : '']}
          format={fmtLaborCell} lowerIsBetter
        />
      </section>

      <section id="report-value-added">
        <h3>Value Added <span class="sec-note">per {selectedProduct}</span></h3>
        <h4>By Profession</h4>
        <ReportTable
          {columns} labelHeaders={['Profession']} rows={vaProfRows}
          labels={(r) => [r.key]} format={(n) => fmtEdmCell(n / activeProduced)} lowerIsBetter={false}
        />
        <h4>By Table</h4>
        <ReportTable
          {columns} labelHeaders={['Table', 'Item', 'Profession']} rows={vaTableRows}
          labels={(r) => [r.meta?.table ?? r.key, r.meta?.item ? `→ ${r.meta.item}` : '', r.meta?.profession ?? '']}
          format={(n) => fmtEdmCell(n / activeProduced)} lowerIsBetter={false}
        />
      </section>

      <section id="report-cross-prof">
        <h3>
          Cross-profession transitions
          <span class="sec-note">
            {active ? ECO_MODE_LABELS[active.mode] : ''} only · +{(settings.crossProfessionMarkup * 100).toFixed(0)}% markup each
          </span>
        </h3>
        {#if transitions.length === 0}
          <p class="empty">None</p>
        {:else}
          <div class="cross-prof-list">
            {#each visibleTransitions as t}
              {@const key = `${t.fromProf}→${t.toProf}:${t.itemName}`}
              {@const isExpanded = expandedTransition === key}
              <div
                class="cross-prof-row" class:cross-prof-expanded={isExpanded}
                role="button" tabindex="0"
                onclick={() => { expandedTransition = isExpanded ? null : key; }}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expandedTransition = isExpanded ? null : key; } }}
              >
                <span class="cross-prof-chevron">{isExpanded ? '▾' : '▸'}</span>
                <span class="cross-prof-profs">{t.fromProf} → {t.toProf}</span>
                <span class="cross-prof-item muted">via {t.itemName}</span>
                <span class="cross-prof-amt">{t.markupAmount != null ? '+' + fmtEdmCell(t.markupAmount / activeProduced) : '—'} EDM</span>
              </div>
              {#if isExpanded}
                <div class="cross-prof-detail">
                  <div class="cp-detail-title">Production chain for <strong>{t.itemName}</strong> ({t.fromProf})</div>
                  {#each t.pathEntries as entry}
                    <div class="cp-entry" style="padding-left: {entry.depth * 14 + 6}px">
                      {#if entry.kind === 'table'}
                        {@const per = entry.subtreeEdm != null && entry.outputAmount > 0 ? entry.subtreeEdm / entry.outputAmount : null}
                        <span class="cp-entry-profession">[{entry.profession}]</span>
                        <span class="cp-entry-table">{entry.tableName}</span>
                        <span class="cp-entry-item muted">→ {entry.itemName}</span>
                        <span class="cp-entry-amount muted">{fmtNum(entry.neededAmount)} needed / {fmtNum(entry.outputAmount)} produced</span>
                        {#if entry.markupApplied}<span class="cp-entry-markup">+{(settings.crossProfessionMarkup * 100).toFixed(0)}%</span>{/if}
                        <span class="cp-entry-edm">{entry.subtreeEdm != null ? fmtEdmCell(entry.subtreeEdm / activeProduced) : '—'} EDM</span>
                        <span class="cp-entry-per-item">{per != null ? fmtEdmCell(per) : '—'}/item</span>
                      {:else}
                        <span class="cp-entry-leaf-type muted">[{entry.nodeType}]</span>
                        <span class="cp-entry-item">{entry.itemName}</span>
                        <span class="cp-entry-amount muted">{fmtNum(entry.amount)} × {entry.edmPerUnit != null ? fmtEdmCell(entry.edmPerUnit) : '?'}</span>
                        <span class="cp-entry-edm">{entry.totalEdm != null ? fmtEdmCell(entry.totalEdm / activeProduced) : '—'} EDM</span>
                      {/if}
                    </div>
                  {/each}
                  <div class="cp-detail-footer">
                    <span>Subtree base: {t.baseEdm != null ? fmtEdmCell(t.baseEdm / activeProduced) : '—'} EDM</span>
                    <span class="cp-markup-highlight">Markup: {t.markupAmount != null ? '+' + fmtEdmCell(t.markupAmount / activeProduced) : '—'} EDM</span>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
          {#if transitions.length > TRANSITION_LIMIT}
            <button class="show-all-btn" onclick={() => (showAllTransitions = !showAllTransitions)}>
              {showAllTransitions
                ? `show top ${TRANSITION_LIMIT}`
                : `show all (${transitions.length})`}
            </button>
          {/if}
        {/if}
      </section>

    </div>
  </div>
</div>

<style>
  .report-overlay {
    position: fixed; inset: 0;
    background: var(--bg-overlay);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }

  /* Sized for three version columns plus their two deltas and the trailing EDM columns.
     The panel itself does not scroll — .report-body does — so the header bars stay put
     without sticky offsets and the scrollbar never cuts the rounded corner. */
  .report-panel {
    background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
    min-width: 360px; width: min(1320px, 95vw); max-height: 88vh;
    overflow: hidden; color: var(--text);
    display: flex; flex-direction: column;
    box-shadow: var(--panel-shadow);
  }
  .report-panel:focus { outline: none; }

  .report-header {
    display: flex; align-items: center; gap: 10px;
    padding: 18px 24px 10px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .report-header h2 { margin: 0; font-size: 16px; color: var(--heading); }
  .report-subject { color: var(--text-muted); font-size: 12px; margin-right: auto; }

  .close-btn { background: none; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; padding: 0; }
  .copy-link-btn {
    background: none; border: 1px solid var(--border); color: var(--text-dim); font-size: 12px; cursor: pointer;
    padding: 2px 8px; border-radius: 4px;
  }
  .copy-link-btn:hover { border-color: var(--text-dim); color: var(--text); }

  .version-bar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
    padding: 10px 24px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .version-chip {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--border); border-radius: 4px;
    padding: 3px 8px; font-size: 11px; color: var(--text-dim);
  }
  .version-chip.chip-active { border-color: var(--accent); color: var(--num); }
  .version-chip.chip-missing { opacity: 0.55; }
  .chip-name { font-weight: bold; }
  .chip-tag {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--num); border: 1px solid var(--accent); border-radius: 2px; padding: 0 3px;
  }
  .chip-missing-note { font-size: 10px; color: var(--edm-missing); font-style: italic; }
  .chip-slots { display: inline-flex; align-items: center; gap: 5px; }

  .chip-slot {
    display: inline-flex; align-items: center; gap: 2px;
    font-size: 10px; color: var(--text-muted); cursor: pointer; user-select: none;
  }
  .chip-slot input { margin: 0; cursor: pointer; }
  .chip-slot:has(input:checked) { color: var(--text); }

  .version-chip select {
    font-size: 11px; background: var(--bg-input); color: var(--text);
    border: 1px solid var(--border); border-radius: 3px;
  }

  /* The key to every Δ in the report: normal body-muted, not the smallest text on screen. */
  .version-hint { font-size: 12px; color: var(--text-muted); margin-left: auto; }

  .jump-bar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
    padding: 7px 24px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .jump-link {
    background: none; border: none; padding: 0; cursor: pointer;
    font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;
  }
  .jump-link:hover { color: var(--num); }
  .jump-sep { color: var(--border); font-size: 11px; }

  .report-body { padding: 16px 24px 24px; flex: 1; overflow-y: auto; }

  section { margin-bottom: 26px; }

  h3 {
    font-size: 13px; color: var(--heading-sec); margin: 0 0 10px;
    text-transform: uppercase; letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border-subtle); padding-bottom: 4px;
  }

  /* A tier of its own: subsection labels used to share the column headers' size
     and colour, so they read as chrome rather than as structure. */
  h4 {
    font-size: 11px; color: var(--text-subhead); margin: 18px 0 4px;
    font-weight: normal; text-transform: uppercase; letter-spacing: 0.08em;
  }
  section > h4:first-of-type { margin-top: 8px; }

  .sec-note { text-transform: none; letter-spacing: 0; color: var(--text-muted); font-size: 11px; font-weight: normal; }

  .empty { color: var(--text-muted); font-style: italic; margin: 2px 0; font-size: 12px; }

  .show-all-btn {
    margin-top: 6px; background: none; border: 1px solid var(--border);
    color: var(--text-muted); font-size: 11px; cursor: pointer;
    padding: 2px 8px; border-radius: 4px;
  }
  .show-all-btn:hover { color: var(--text); border-color: var(--text-dim); }

  .cross-prof-list { margin-top: 4px; font-size: 11px; }
  .cross-prof-row {
    display: flex; gap: 8px; align-items: baseline;
    padding: 3px 4px; border-radius: 3px; cursor: pointer; user-select: none;
  }
  .cross-prof-row:hover { background: var(--row-hover); }
  .cross-prof-row.cross-prof-expanded { background: var(--row-selected); }
  .cross-prof-chevron { color: var(--text-muted); font-size: 9px; width: 10px; flex-shrink: 0; }
  .cross-prof-profs { color: var(--prof); white-space: nowrap; }
  .cross-prof-item { color: var(--text-muted); font-size: 10px; flex: 1; }
  .cross-prof-amt { color: var(--amt-warm); white-space: nowrap; font-variant-numeric: tabular-nums; font-family: var(--font-mono); }

  .cross-prof-detail {
    margin: 2px 0 6px 14px; padding: 8px 10px;
    border-left: 2px solid var(--prof); background: var(--prof-bg);
    border-radius: 0 4px 4px 0; font-size: 10px;
  }
  .cp-detail-title { color: var(--text-dim); margin-bottom: 6px; font-style: italic; }
  .cp-entry { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; }
  .cp-entry-profession { color: var(--text-muted); white-space: nowrap; }
  .cp-entry-table { color: var(--prof); white-space: nowrap; }
  .cp-entry-leaf-type { color: var(--text-muted); white-space: nowrap; }
  .cp-entry-item { color: var(--text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-entry-amount { color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; font-family: var(--font-mono); }
  .cp-entry-edm { color: var(--amt-warm); white-space: nowrap; font-variant-numeric: tabular-nums; margin-left: auto; font-family: var(--font-mono); }
  .cp-entry-markup { color: var(--amt-warm); font-size: 9px; background: rgba(240,160,64,0.15); border: 1px solid rgba(240,160,64,0.4); border-radius: 2px; padding: 0 3px; white-space: nowrap; }
  .cp-entry-per-item { color: var(--text-muted); font-size: 9px; white-space: nowrap; margin-left: auto; font-family: var(--font-mono); }
  .cp-detail-footer {
    display: flex; justify-content: space-between; margin-top: 6px; padding-top: 5px;
    border-top: 1px solid var(--border-subtle); color: var(--text-muted);
  }
  .cp-markup-highlight { color: var(--amt-warm); }
  .muted { color: var(--text-muted); }

  .close-btn:focus-visible,
  .copy-link-btn:focus-visible,
  .show-all-btn:focus-visible,
  .jump-link:focus-visible,
  .version-chip select:focus-visible,
  .cross-prof-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
</style>
