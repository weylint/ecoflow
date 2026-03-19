<script lang="ts">
  import type { ByproductPlannerNode, TagPlannerNode, RecipeObject } from '$lib/types.js';
  import type { RecipeIndex } from '$lib/recipeIndex.js';
  import type { TagsIndex } from '$lib/tagsIndex.js';

  let {
    byproductNodes,
    unresolvedTagNodes,
    recipeIndex,
    tagsIndex,
    inChainItems,
    onApply,
    onClose,
  }: {
    byproductNodes: ByproductPlannerNode[];
    unresolvedTagNodes: TagPlannerNode[];
    recipeIndex: RecipeIndex;
    tagsIndex: TagsIndex;
    inChainItems: Set<string>;
    onApply: (tagChoices: Map<string, string>) => void;
    onClose: () => void;
  } = $props();

  // ── Option type: one resolution path ────────────────────────────
  // outputItem: the item that satisfies the tag (may differ from byproductName if via recipe)
  type ResolveOption = {
    outputItem: string;
    tag: string;
    tagAmount: number;
    via?: { recipe: RecipeObject; tableName: string }; // undefined = direct match
  };

  // ── Group suggestions by byproduct ──────────────────────────────
  type ByproductGroup = {
    bp: ByproductPlannerNode;
    options: ResolveOption[];
  };

  const groups = $derived.by((): ByproductGroup[] => {
    const unresolvedTagMap = new Map(unresolvedTagNodes.map(n => [n.tag, n.amount]));
    const result: ByproductGroup[] = [];

    for (const bp of byproductNodes) {
      const options: ResolveOption[] = [];
      const seen = new Set<string>(); // deduplicate by "outputItem:tag"

      // Direct: byproduct item belongs to an unresolved tag
      for (const tag of tagsIndex.itemToTags.get(bp.itemName) ?? []) {
        if (!unresolvedTagMap.has(tag)) continue;
        const key = `${bp.itemName}:${tag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ outputItem: bp.itemName, tag, tagAmount: unresolvedTagMap.get(tag)! });
      }

      // 1-step indirect: recipe consumes byproduct → primary product satisfies a tag
      for (const recipe of recipeIndex.byIngredient.get(bp.itemName) ?? []) {
        const variant = recipe.Variants.find(v => v.Name === recipe.DefaultVariant) ?? recipe.Variants[0];
        const primaryProduct = variant?.Products[0];
        if (!primaryProduct) continue;
        for (const tag of tagsIndex.itemToTags.get(primaryProduct.Name) ?? []) {
          if (!unresolvedTagMap.has(tag)) continue;
          const key = `${primaryProduct.Name}:${tag}`;
          if (seen.has(key)) continue;
          seen.add(key);
          options.push({
            outputItem: primaryProduct.Name,
            tag,
            tagAmount: unresolvedTagMap.get(tag)!,
            via: { recipe, tableName: recipe.CraftingTable },
          });
        }
      }

      if (options.length > 0) {
        // Sort: direct first, then by outputItem name
        options.sort((a, b) => {
          const d = (a.via === undefined ? 0 : 1) - (b.via === undefined ? 0 : 1);
          return d !== 0 ? d : a.outputItem.localeCompare(b.outputItem);
        });
        result.push({ bp, options });
      }
    }

    return result;
  });

  // ── Tag top-5 ────────────────────────────────────────────────────
  type TagOption = { item: string; inChain: boolean };
  type TagSuggestion = {
    tag: string;
    amount: number;
    currentContributors: { itemName: string; contribution: number }[];
    options: TagOption[];
    craftableSet: Set<string>;
  };

  const tagSuggestions = $derived.by((): TagSuggestion[] => {
    return unresolvedTagNodes.map(n => {
      const sorted = [...n.availableItems].sort((a, b) => {
        const aChain = inChainItems.has(a) ? 0 : 1;
        const bChain = inChainItems.has(b) ? 0 : 1;
        if (aChain !== bChain) return aChain - bChain;
        return a.localeCompare(b);
      });
      return {
        tag: n.tag,
        amount: n.amount,
        currentContributors: n.byproductContributors ?? [],
        options: sorted.slice(0, 5).map(item => ({ item, inChain: inChainItems.has(item) })),
        craftableSet: new Set(n.craftableItems ?? []),
      };
    });
  });

  // ── Pending choices (batched before Apply) ───────────────────────
  let pendingChoices = $state(new Map<string, string>());

  function select(tag: string, item: string) {
    pendingChoices = new Map(pendingChoices).set(tag, item);
  }

  function apply() {
    onApply(pendingChoices);
  }

  function fmt(n: number) {
    return n % 1 === 0 ? n.toString() : n.toFixed(2);
  }
</script>

<div class="resolve-overlay" role="dialog" aria-modal="true">
  <div class="resolve-panel">
    <div class="resolve-header">
      <h2>Resolve</h2>
      <button class="close-btn" onclick={onClose}>✕</button>
    </div>

    <!-- Byproduct Opportunities -->
    <section>
      <h3>Byproduct Opportunities</h3>
      {#if groups.length === 0}
        <p class="empty">No opportunities found — all byproducts are either already used or don't match any unresolved tag.</p>
      {:else}
        {#each groups as { bp, options }}
          <div class="bp-group">
            <div class="bp-header">
              <span class="bp-name">{bp.itemName}</span>
              <span class="bp-amt">× {fmt(bp.amount)}</span>
            </div>
            <div class="bp-options">
              {#each options as opt}
                {@const isPending = pendingChoices.get(opt.tag) === opt.outputItem}
                <button
                  class="option-btn"
                  class:active={isPending}
                  onclick={() => select(opt.tag, opt.outputItem)}
                  title={opt.via ? `Craft via ${opt.via.tableName}` : 'Direct tag match'}
                >
                  {#if opt.via}
                    <span class="opt-chain">→ {opt.outputItem}</span>
                    <span class="opt-via">via {opt.via.tableName}</span>
                  {:else}
                    <span class="opt-chain">direct</span>
                  {/if}
                  <span class="opt-tag">for <em>{opt.tag}</em> (need {fmt(opt.tagAmount)})</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </section>

    <!-- Unchosen Tags -->
    {#if tagSuggestions.length > 0}
      <section>
        <h3>Unchosen Tags</h3>
        {#each tagSuggestions as ts}
          <div class="tag-group">
            <div class="tag-group-header">
              <span class="tag-label">{ts.tag}</span>
              <span class="tag-need">need {fmt(ts.amount)}</span>
            </div>
            {#if ts.currentContributors.length > 0}
              <div class="auto-resolved">
                Auto: {ts.currentContributors.map(c => `${c.itemName} (×${fmt(c.contribution)})`).join(' + ')}
                — selecting below replaces auto-resolution
              </div>
            {/if}
            <div class="tag-options">
              {#each ts.options as opt}
                {@const isPending = pendingChoices.get(ts.tag) === opt.item}
                {@const isCraftable = ts.craftableSet.has(opt.item)}
                <button
                  class="item-btn"
                  class:active={isPending}
                  class:in-chain={opt.inChain}
                  class:is-recipe={isCraftable}
                  onclick={() => select(ts.tag, opt.item)}
                >
                  {#if opt.inChain}<span class="chain-star">★</span>{/if}
                  {#if isCraftable}<span class="recipe-icon">⚙</span>{/if}
                  {opt.item}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    <div class="apply-row">
      <button class="apply-btn" disabled={pendingChoices.size === 0} onclick={apply}>
        Apply {pendingChoices.size > 0 ? `${pendingChoices.size} Choice${pendingChoices.size > 1 ? 's' : ''}` : 'Choices'}
      </button>
      {#if pendingChoices.size > 0}
        <button class="clear-btn" onclick={() => pendingChoices = new Map()}>Clear</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .resolve-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 40px 16px;
    z-index: 1000;
    overflow-y: auto;
  }

  .resolve-panel {
    background: #1e1e2e;
    border: 1px solid #3a3a5c;
    border-radius: 8px;
    padding: 20px 24px;
    width: 680px;
    max-width: 100%;
    color: #e0e0e0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .resolve-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px;
  }

  .resolve-header h2 {
    margin: 0; font-size: 18px; color: #a0c4ff;
  }

  .close-btn {
    background: none; border: none; color: #aaa; font-size: 18px;
    cursor: pointer; padding: 2px 6px; border-radius: 4px;
  }
  .close-btn:hover { background: #333; color: #fff; }

  section { margin-bottom: 20px; }

  h3 {
    margin: 0 0 10px; font-size: 13px; text-transform: uppercase;
    letter-spacing: 0.06em; color: #888;
    border-bottom: 1px solid #2e2e4e; padding-bottom: 6px;
  }

  .empty {
    color: #666; font-style: italic; font-size: 13px; margin: 0;
  }

  /* Byproduct groups */
  .bp-group {
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid #252540;
  }
  .bp-group:last-child { border-bottom: none; margin-bottom: 0; }

  .bp-header {
    display: flex; align-items: baseline; gap: 8px; margin-bottom: 7px;
  }
  .bp-name { font-weight: 600; font-size: 14px; color: #c8a8f8; }
  .bp-amt { font-size: 11px; color: #7a5fa0; }

  .bp-options {
    display: flex; flex-wrap: wrap; gap: 6px;
  }

  .option-btn {
    display: flex; flex-direction: column; align-items: flex-start;
    padding: 6px 10px;
    background: #252540; color: #ccc;
    border: 1px solid #3a3a60; border-radius: 5px;
    cursor: pointer; font-size: 12px; text-align: left;
    gap: 2px;
  }
  .option-btn:hover { background: #2e2e50; border-color: #5a5a90; }
  .option-btn.active {
    background: #1a4a2e; color: #6dffb3; border-color: #2a8a5e;
  }

  .opt-chain { font-weight: 600; color: #e0d0ff; }
  .option-btn.active .opt-chain { color: #6dffb3; }
  .opt-via { font-size: 10px; color: #7070a0; }
  .option-btn.active .opt-via { color: #3acc88; }
  .opt-tag { font-size: 11px; color: #b08050; }
  .opt-tag em { font-style: normal; color: #e9a84c; }
  .option-btn.active .opt-tag { color: #4acc88; }
  .option-btn.active .opt-tag em { color: #6dffb3; }

  /* Tag groups */
  .tag-group { margin-bottom: 14px; }
  .tag-group-header {
    display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px;
  }
  .tag-label { font-size: 14px; color: #e9a84c; font-weight: 500; }
  .tag-need { font-size: 11px; color: #888; }

  .auto-resolved {
    font-size: 11px; color: #7aaa8a; margin-bottom: 5px;
  }

  .tag-options { display: flex; flex-wrap: wrap; gap: 6px; }

  .item-btn {
    padding: 4px 10px; font-size: 12px;
    background: #252535; color: #ccc;
    border: 1px solid #3a3a55; border-radius: 4px;
    cursor: pointer; display: flex; align-items: center; gap: 4px;
  }
  .item-btn:hover { background: #333350; }
  .item-btn.in-chain { border-color: #5a7a9a; color: #9cc4e4; }
  .item-btn.active { background: #1a4a2e; color: #6dffb3; border-color: #2a8a5e; }

  .chain-star { color: #f0c040; font-size: 11px; }
  .item-btn.is-recipe { border-color: #3a8a9a; color: #8ad4e4; }
  .recipe-icon { font-size: 10px; color: #6aabb8; }

  /* Apply row */
  .apply-row {
    display: flex; gap: 10px; align-items: center;
    padding-top: 12px; border-top: 1px solid #2e2e4e; margin-top: 4px;
  }

  .apply-btn {
    padding: 7px 18px; font-size: 14px; font-weight: 600;
    background: #1a4a2e; color: #6dffb3;
    border: 1px solid #2a8a5e; border-radius: 5px; cursor: pointer;
  }
  .apply-btn:hover:not(:disabled) { background: #225e3a; }
  .apply-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .clear-btn {
    padding: 7px 12px; font-size: 13px;
    background: none; color: #888;
    border: 1px solid #444; border-radius: 5px; cursor: pointer;
  }
  .clear-btn:hover { color: #bbb; border-color: #666; }

  /* Light mode */
  :global(html.light) .resolve-panel { background: #fff; border-color: #d0d7e3; color: #1a1a2e; }
  :global(html.light) .resolve-header h2 { color: #1a6b9a; }
  :global(html.light) h3 { color: #6b7280; border-color: #e0e7ef; }
  :global(html.light) .bp-group { border-color: #e8edf5; }
  :global(html.light) .bp-name { color: #6b3aaa; }
  :global(html.light) .bp-amt { color: #9a7abf; }
  :global(html.light) .option-btn { background: #f5f0ff; color: #374151; border-color: #c4b0e8; }
  :global(html.light) .option-btn:hover { background: #ede5ff; }
  :global(html.light) .option-btn.active { background: #d0f4e4; color: #166534; border-color: #4ade80; }
  :global(html.light) .opt-chain { color: #4a2a8a; }
  :global(html.light) .opt-via { color: #9ca3af; }
  :global(html.light) .opt-tag { color: #9a6030; }
  :global(html.light) .opt-tag em { color: #b45309; }
  :global(html.light) .tag-label { color: #b45309; }
  :global(html.light) .auto-resolved { color: #2d7a50; }
  :global(html.light) .item-btn { background: #f5f7fa; color: #374151; border-color: #d1d5db; }
  :global(html.light) .item-btn:hover { background: #e8eef8; }
  :global(html.light) .item-btn.in-chain { border-color: #60a5fa; color: #1d4ed8; }
  :global(html.light) .item-btn.active { background: #d0f4e4; color: #166534; border-color: #4ade80; }
  :global(html.light) .apply-btn { background: #d0f4e4; color: #166534; border-color: #4ade80; }
  :global(html.light) .apply-btn:hover:not(:disabled) { background: #bbf0d6; }
  :global(html.light) .clear-btn { color: #6b7280; border-color: #d1d5db; }
  :global(html.light) .close-btn { color: #6b7280; }
  :global(html.light) .close-btn:hover { background: #f3f4f6; color: #111; }
</style>
