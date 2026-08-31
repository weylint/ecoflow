<script lang="ts">
  import type { ProfessionData, RecipeObject, Variant } from '../types.js';
  import type { SandboxPatch, VariantOverride } from '../sandbox.js';
  import {
    EMPTY_SANDBOX_PATCH, ingredientKey, parseSandboxPatch, patchedVariantCount, talentNames
  } from '../sandbox.js';

  interface Props {
    /** Unpatched Eco 14 data — the amounts a patch is departing from. */
    recipes: RecipeObject[];
    professions: ProfessionData[];
    patch: SandboxPatch;
    /** Variant keys in the patch that no longer exist in the data. */
    unmatched: string[];
    onChange: (patch: SandboxPatch) => void;
    onClose: () => void;
  }

  let { recipes, professions, patch, unmatched, onChange, onClose }: Props = $props();

  let tab = $state<'recipes' | 'talents'>('recipes');
  let search = $state('');

  // One search box serves both tabs, so a query left over from the other one
  // would silently render the tab you just opened empty.
  function switchTab(next: 'recipes' | 'talents') {
    if (next === tab) return;
    tab = next;
    search = '';
  }
  let importError = $state('');
  let panelEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelEl?.focus();
    return () => opener?.focus?.();
  });

  interface VariantRow { recipe: RecipeObject; variant: Variant }

  const allVariants = $derived<VariantRow[]>(
    recipes.flatMap(recipe => recipe.Variants.map(variant => ({ recipe, variant })))
  );

  const edited = $derived(new Set(Object.keys(patch.variants)));

  // Edited variants always show, so a change never scrolls out of reach behind the
  // search box. Everything else needs a query — 3000+ variants is not a browsable list.
  const visible = $derived.by((): VariantRow[] => {
    const query = search.trim().toLowerCase();
    const editedRows = allVariants.filter(r => edited.has(r.variant.Key));
    if (query.length < 2) return editedRows;
    const matches = allVariants.filter(r =>
      !edited.has(r.variant.Key) && (
        r.variant.Name.toLowerCase().includes(query) ||
        r.variant.Products.some(p => p.Name.toLowerCase().includes(query))
      )
    );
    return [...editedRows, ...matches.slice(0, 60)];
  });

  const allTalents = $derived(talentNames(professions));
  const visibleTalents = $derived.by(() => {
    const query = search.trim().toLowerCase();
    if (tab !== 'talents' || query.length < 2) return allTalents;
    return allTalents.filter(t => t.toLowerCase().includes(query));
  });

  const editCount = $derived(patchedVariantCount(patch));

  function overrideFor(key: string): VariantOverride {
    return patch.variants[key] ?? {};
  }

  /** Writes one amount, or clears it when the value returns to the stock amount. */
  function setAmount(key: string, field: 'products' | 'ingredients', name: string, raw: string, stock: number) {
    const parsed = parseFloat(raw);
    const next = { ...patch, variants: { ...patch.variants } };
    const current: VariantOverride = { ...overrideFor(key) };
    const bucket = { ...(current[field] ?? {}) };

    if (raw === '' || !isFinite(parsed) || parsed < 0 || parsed === stock) delete bucket[name];
    else bucket[name] = parsed;

    if (Object.keys(bucket).length > 0) current[field] = bucket;
    else delete current[field];

    if (current.products || current.ingredients) next.variants[key] = current;
    else delete next.variants[key];

    onChange(next);
  }

  function clearVariant(key: string) {
    const variants = { ...patch.variants };
    delete variants[key];
    onChange({ ...patch, variants });
  }

  function toggleTalent(name: string, disabled: boolean) {
    const set = new Set(patch.disabledTalents);
    if (disabled) set.add(name); else set.delete(name);
    onChange({ ...patch, disabledTalents: [...set].sort() });
  }

  function exportPatch() {
    const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eco-sandbox-patch.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importPatch(file: File) {
    importError = '';
    try {
      const parsed = parseSandboxPatch(JSON.parse(await file.text()));
      if (!parsed) { importError = 'Not a valid sandbox patch file.'; return; }
      onChange(parsed);
    } catch {
      importError = 'Could not read that file as JSON.';
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div class="sandbox-overlay" role="dialog" aria-modal="true" aria-labelledby="sandbox-title" tabindex="-1"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
  onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
  <div class="sandbox-panel" bind:this={panelEl} tabindex="-1">
    <div class="sandbox-header">
      <h2 id="sandbox-title">Sandbox Overrides</h2>
      <span class="sandbox-subject">
        Eco 14 + {editCount} recipe{editCount === 1 ? '' : 's'}, {patch.disabledTalents.length} talent{patch.disabledTalents.length === 1 ? '' : 's'} off
      </span>
      <button class="ghost-btn" onclick={exportPatch}>Export</button>
      <label class="ghost-btn import-btn">
        Import
        <input
          type="file" accept="application/json"
          onchange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) importPatch(file);
            (e.target as HTMLInputElement).value = '';
          }}
        />
      </label>
      <button class="ghost-btn" onclick={() => onChange({ ...EMPTY_SANDBOX_PATCH })}>Reset all</button>
      <button class="close-btn" onclick={onClose} aria-label="Close overrides">✕</button>
    </div>

    <div class="sandbox-bar">
      <button class="tab" class:tab-active={tab === 'recipes'} onclick={() => switchTab('recipes')}>
        Recipes{#if editCount > 0}<span class="badge">{editCount}</span>{/if}
      </button>
      <button class="tab" class:tab-active={tab === 'talents'} onclick={() => switchTab('talents')}>
        Talents{#if patch.disabledTalents.length > 0}<span class="badge">{patch.disabledTalents.length}</span>{/if}
      </button>
      <input
        class="search"
        type="search"
        placeholder={tab === 'recipes' ? 'Search recipes or products…' : 'Search talents…'}
        bind:value={search}
      />
    </div>

    {#if importError}
      <p class="sandbox-error">{importError}</p>
    {/if}
    {#if unmatched.length > 0}
      <p class="sandbox-error">
        {unmatched.length} override{unmatched.length === 1 ? '' : 's'} match no recipe in the current
        Eco 14 data and are being ignored: {unmatched.slice(0, 5).join(', ')}{unmatched.length > 5 ? '…' : ''}
      </p>
    {/if}

    <div class="sandbox-body">
      {#if tab === 'recipes'}
        {#if visible.length === 0}
          <p class="hint">
            {search.trim().length >= 2
              ? 'No recipe matches that search.'
              : 'Type at least two characters to find a recipe. Edited recipes stay listed here.'}
          </p>
        {/if}
        {#each visible as { recipe, variant } (variant.Key)}
          {@const override = overrideFor(variant.Key)}
          {@const isEdited = edited.has(variant.Key)}
          <div class="variant" class:variant-edited={isEdited}>
            <div class="variant-head">
              <span class="variant-name">{variant.Name}</span>
              <span class="variant-meta">{recipe.CraftingTable} · {recipe.SkillNeeds[0]?.Skill ?? 'No skill'}</span>
              {#if isEdited}
                <button class="reset-btn" onclick={() => clearVariant(variant.Key)}>reset</button>
              {/if}
            </div>
            <div class="amounts">
              <span class="amounts-label">Produces</span>
              {#each variant.Products as product}
                {@const value = override.products?.[product.Name]}
                <label class="amount" class:amount-changed={value !== undefined}>
                  <input
                    type="number" min="0" step="any"
                    value={value ?? product.Ammount}
                    oninput={(e) => setAmount(variant.Key, 'products', product.Name,
                      (e.target as HTMLInputElement).value, product.Ammount)}
                  />
                  <span class="amount-name">{product.Name}</span>
                  {#if value !== undefined}<span class="stock">was {product.Ammount}</span>{/if}
                </label>
              {/each}
            </div>
            <div class="amounts">
              <span class="amounts-label">Consumes</span>
              {#if variant.Ingredients.length === 0}
                <span class="hint">nothing</span>
              {/if}
              {#each variant.Ingredients as ingredient}
                {@const key = ingredientKey(ingredient)}
                {@const value = override.ingredients?.[key]}
                <label class="amount" class:amount-changed={value !== undefined}>
                  <input
                    type="number" min="0" step="any"
                    value={value ?? ingredient.Ammount}
                    oninput={(e) => setAmount(variant.Key, 'ingredients', key,
                      (e.target as HTMLInputElement).value, ingredient.Ammount)}
                  />
                  <span class="amount-name">{key}{#if !ingredient.IsSpecificItem} <em>(tag)</em>{/if}</span>
                  {#if value !== undefined}<span class="stock">was {ingredient.Ammount}</span>{/if}
                </label>
              {/each}
            </div>
          </div>
        {/each}
      {:else}
        <p class="hint">
          Switching a talent off removes its reduction from every recipe it covers. Only talents
          that reduce resource cost are listed — the rest do not affect a plan's EDM.
        </p>
        <div class="talent-list">
          {#each visibleTalents as name}
            {@const off = patch.disabledTalents.includes(name)}
            <label class="talent" class:talent-off={off}>
              <input type="checkbox" checked={!off} onchange={(e) => toggleTalent(name, !(e.target as HTMLInputElement).checked)} />
              {name}
            </label>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .sandbox-overlay {
    position: fixed; inset: 0;
    background: var(--bg-overlay);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }

  .sandbox-panel {
    background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px;
    width: min(900px, 94vw); max-height: 88vh;
    overflow: hidden; color: var(--text);
    display: flex; flex-direction: column;
    box-shadow: var(--panel-shadow);
  }
  .sandbox-panel:focus { outline: none; }

  .sandbox-header {
    display: flex; align-items: center; gap: 8px;
    padding: 16px 20px 10px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .sandbox-header h2 { margin: 0; font-size: 16px; color: var(--heading); }
  .sandbox-subject { color: var(--text-muted); font-size: 12px; margin-right: auto; }

  .ghost-btn {
    background: none; border: 1px solid var(--border); color: var(--text-dim);
    font-size: 12px; cursor: pointer; padding: 2px 8px; border-radius: 4px;
  }
  .ghost-btn:hover { border-color: var(--text-dim); color: var(--text); }
  .import-btn input { display: none; }
  .close-btn { background: none; border: none; color: var(--text-dim); font-size: 18px; cursor: pointer; padding: 0; }

  .sandbox-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .tab {
    background: none; border: 1px solid transparent; color: var(--text-muted);
    font-size: 12px; cursor: pointer; padding: 3px 10px; border-radius: 4px;
  }
  .tab-active { border-color: var(--accent); color: var(--num); }
  .badge {
    margin-left: 5px; font-size: 10px; color: var(--bg-panel);
    background: var(--accent); border-radius: 8px; padding: 0 5px;
  }
  .search {
    margin-left: auto; width: 260px;
    background: var(--bg-input); color: var(--text);
    border: 1px solid var(--border); border-radius: 4px;
    font-size: 12px; padding: 3px 8px;
  }

  .sandbox-error {
    margin: 0; padding: 8px 20px;
    color: var(--edm-missing); font-size: 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .sandbox-body { padding: 12px 20px 20px; flex: 1; overflow-y: auto; }

  .hint { color: var(--text-muted); font-size: 12px; margin: 4px 0 10px; }

  .variant {
    border: 1px solid var(--border-subtle); border-radius: 5px;
    padding: 8px 10px; margin-bottom: 8px;
  }
  .variant-edited { border-color: var(--accent); background: var(--row-zebra); }

  .variant-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .variant-name { font-size: 13px; color: var(--text); }
  .variant-meta { font-size: 11px; color: var(--text-muted); margin-right: auto; }
  .reset-btn {
    background: none; border: none; color: var(--text-muted);
    font-size: 11px; cursor: pointer; text-decoration: underline; padding: 0;
  }
  .reset-btn:hover { color: var(--text); }

  .amounts { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 3px 0; }
  .amounts-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); width: 68px; flex-shrink: 0;
  }

  .amount {
    display: inline-flex; align-items: baseline; gap: 5px;
    font-size: 12px; color: var(--text-dim);
  }
  .amount input {
    width: 62px; text-align: right;
    background: var(--bg-input); color: var(--text);
    border: 1px solid var(--border); border-radius: 3px;
    font-family: var(--font-mono); font-size: 12px; padding: 1px 4px;
  }
  .amount-changed input { border-color: var(--accent); color: var(--num); }
  .amount-name em { font-style: normal; color: var(--text-muted); font-size: 10px; }
  .stock { font-size: 10px; color: var(--text-muted); }

  .talent-list { display: flex; flex-direction: column; gap: 2px; }
  .talent {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--text); cursor: pointer;
    padding: 2px 4px; border-radius: 3px;
  }
  .talent:hover { background: var(--row-hover); }
  .talent-off { color: var(--text-muted); text-decoration: line-through; }

  .ghost-btn:focus-visible,
  .close-btn:focus-visible,
  .tab:focus-visible,
  .search:focus-visible,
  .reset-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 3px;
  }
</style>
