<script lang="ts">
  import { onMount } from 'svelte';
  import { dev, browser } from '$app/environment';
  import { writable, get } from 'svelte/store';
  import { SvelteMap } from 'svelte/reactivity';
  import { SvelteFlow, Controls, Background, MiniMap, Panel } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import type { Node, Edge, NodeTypes, EdgeTypes } from '@xyflow/svelte';
  import { usesModuleSlots, dataVersionOf, ECO12_UPGRADE_LEVELS, ECO13_UPGRADE_LEVELS, getUpgradeLevels, EXCLUDED_BYPRODUCTS, DEFAULT_LAYOUT_OPTIONS, DEFAULT_TAG_CHOICES, DEFAULT_RECIPE_CHOICES, DEFAULT_MARKET_ITEMS, EDM_MARKUP_EXCLUDED_RECIPES, ECO_MODES, ECO_MODE_LABELS, MODULE_SLOTS, DEFAULT_MODULE_SLOTS, isEcoMode, isModuleSlot } from '$lib/types.js';
  import type { EcoMode, LayoutOptions, ModuleSlot, PlannerGraph, ProductPlannerNode } from '$lib/types.js';
  import type { RecipeObject, Variant, TagsFile, RecipeFile, UserChoices, TablePlannerNode, RawPlannerNode, MarketPlannerNode, TagPlannerNode, ByproductPlannerNode, ByproductResolveOption, IngredientStats, ProductStats } from '$lib/types.js';
  import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '$lib/settings.js';
  import type { AppSettings } from '$lib/settings.js';
  import { computeEdmReport, resolveItemEdmValue, PROFESSION_FOOD_TIER, WORK_PARTY_EDM_PER_LABOR } from '$lib/edm.js';
  import type { EdmReport, TransitionPathEntry } from '$lib/edm.js';
  import { tableEdmPerUnit } from '$lib/nodeEdmDisplay.js';
  import { fmtNum, fmtEdm, fmtLabor } from '$lib/format.js';
  import { buildRecipeIndex } from '$lib/recipeIndex.js';
  import { buildTagsIndex } from '$lib/tagsIndex.js';
  import { buildTalentIndex } from '$lib/talentIndex.js';
  import type { TalentIndex } from '$lib/talentIndex.js';
  import { buildModuleIndex } from '$lib/moduleIndex.js';
  import type { ModuleIndex, ModulesFile } from '$lib/moduleIndex.js';
  import { buildSnapshot, serializeColumnTargets, parseColumnTargets } from '$lib/reportColumns.js';
  import type { ColumnTarget, ReportColumn } from '$lib/reportColumns.js';
  import { ingredientAmountPerCycle } from '$lib/resourceCost.js';
  import {
    overridesFromChoices, serializeChoiceOverrides, parseChoiceOverrides, applyChoiceOverrides,
    type ChoiceBaseline,
  } from '$lib/choiceCodec.js';
  import { priceSetId } from '$lib/priceSet.js';
  import { installAgentApi, type AgentApiInstall } from '$lib/agentApi.js';
  import { hideFlowHandles } from '$lib/a11yHandles.js';
  import { buildPlanExport } from '$lib/planExport.js';
  import { buildGraph } from '$lib/planner.js';
  import { isPatchEmpty, applySandboxPatch, applyTalentPatch, patchedVariantCount, parseSandboxPatch, EMPTY_SANDBOX_PATCH } from '$lib/sandbox.js';
  import type { SandboxPatch } from '$lib/sandbox.js';
  import { withDerivedEdmValues } from '$lib/edmDerived.js';
  import type { ProfessionData } from '$lib/types.js';

  import TableNode from '$lib/components/TableNode.svelte';
  import RawNode from '$lib/components/RawNode.svelte';
  import TagNode from '$lib/components/TagNode.svelte';
  import MarketNode from '$lib/components/MarketNode.svelte';
  import ByproductNode from '$lib/components/ByproductNode.svelte';
  import ProductNode from '$lib/components/ProductNode.svelte';
  import ProfessionGroupNode from '$lib/components/ProfessionGroupNode.svelte';
  import LabeledEdge from '$lib/components/LabeledEdge.svelte';
  import TablePane from '$lib/components/TablePane.svelte';
  import ReportModal from '$lib/components/ReportModal.svelte';
  import SandboxModal from '$lib/components/SandboxModal.svelte';
  import ResolveModal from '$lib/components/ResolveModal.svelte';
  import FitViewOnDemand from '$lib/components/FitViewOnDemand.svelte';

  // ── Custom node type registry ────────────────────────────────────
  const nodeTypes = {
    tableNode: TableNode,
    rawNode: RawNode,
    tagNode: TagNode,
    marketNode: MarketNode,
    byproductNode: ByproductNode,
    productNode: ProductNode,
    professionGroup: ProfessionGroupNode
  } as unknown as NodeTypes;

  const edgeTypes = {
    labeledEdge: LabeledEdge
  } as unknown as EdgeTypes;

  // ── State ────────────────────────────────────────────────────────
  let recipeIndex = $state<ReturnType<typeof buildRecipeIndex> | null>(null);
  let tagsIndex = $state<ReturnType<typeof buildTagsIndex> | null>(null);
  let talentIndex = $state<TalentIndex>(new Map());
  let moduleIndex = $state<ModuleIndex | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let settings = $state<AppSettings>({ ...DEFAULT_SETTINGS, edmValues: { ...DEFAULT_SETTINGS.edmValues }, edmTagDefaults: { ...DEFAULT_SETTINGS.edmTagDefaults } });
  // Eco 14 has no upgrade ladder — it uses independent module slots instead.
  const usesModules = $derived(usesModuleSlots(settings.ecoMode));
  // Only rendered when !usesModules; Eco 14 shows the module slot checkboxes instead.
  const upgradeLevels = $derived(getUpgradeLevels(usesModules ? 'eco13' : settings.ecoMode as 'eco12' | 'eco13'));
  const activeModuleSlots = $derived(new Set<ModuleSlot>(settings.moduleSlots ?? DEFAULT_MODULE_SLOTS));

  const _urlParams = browser ? new URL(window.location.href).searchParams : null;
  const _urlAmount = _urlParams ? parseInt(_urlParams.get('amount') ?? '', 10) : NaN;

  let selectedProduct = $state(_urlParams?.get('product') ?? 'Steel Bar');
  let amount = $state(_urlAmount > 0 ? _urlAmount : 100);

  const parseSlots = (raw: string | null | undefined): ModuleSlot[] | null => {
    if (raw === null || raw === undefined) return null;
    if (raw === '') return [];
    const parsed = raw.split(',').map(x => x.trim()).filter(Boolean)
      .map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());
    return parsed.every(isModuleSlot) ? parsed as ModuleSlot[] : null;
  };
  const serializeSlots = (s2: readonly ModuleSlot[]) => s2.map(x => x.toLowerCase()).join(',');

  const _urlEcoMode = (() => {
    const v = _urlParams?.get('ecoMode');
    return isEcoMode(v) ? v : null;
  })();
  const _urlSlots = parseSlots(_urlParams?.get('slots'));
  const _urlCmpSlots = parseSlots(_urlParams?.get('cmpSlots'));
  const _urlUpgrade = (() => {
    const v = parseFloat(_urlParams?.get('upgrade') ?? '');
    return isFinite(v) && v >= 0 && v <= 1 ? v : null;
  })();
  const _urlReport  = _urlParams?.get('report') === '1';
  // Resolving these needs the recipe index, so parsing happens here but applying
  // waits until loadData has run — see onMount.
  const _urlOverrides = parseChoiceOverrides(_urlParams?.get('ov'));
  const _urlLayoutDir = (() => {
    const v = _urlParams?.get('layout');
    return v === 'down' ? 'DOWN' as const : v === 'right' ? 'RIGHT' as const : null;
  })();
  const _urlGroup = _urlParams?.get('group') === '1';
  const _urlCmpMode = (() => {
    const v = _urlParams?.get('cmpMode');
    return isEcoMode(v) ? v : null;
  })();
  const _urlCmpVal  = (() => {
    const v = parseFloat(_urlParams?.get('cmpVal') ?? '');
    return isFinite(v) && v >= 0 && v <= 1 ? v : null;
  })();

  $effect(() => {
    if (!browser) return;
    const url = new URL(window.location.href);
    url.searchParams.set('product', selectedProduct);
    url.searchParams.set('amount', String(amount));
    url.searchParams.set('ecoMode', settings.ecoMode);
    if (usesModules) {
      url.searchParams.set('slots', serializeSlots(settings.moduleSlots ?? DEFAULT_MODULE_SLOTS));
      url.searchParams.delete('upgrade');
    } else {
      url.searchParams.set('upgrade', String(globalUpgrade));
      url.searchParams.delete('slots');
    }
    if (showReport) {
      url.searchParams.set('report', '1');
      // Only the columns on screen: an unused Sandbox target would be dead weight in every link.
      url.searchParams.set('cols', serializeColumnTargets(
        Object.fromEntries(REPORT_MODES.map(m => [m, columnTargets[m]]))
      ));
    } else {
      url.searchParams.delete('report');
      url.searchParams.delete('cols');
    }
    // Per-node recipe, variant, tag, market and module decisions — without these
    // a shared link reproduces only the four global inputs, and a reload loses
    // everything the user actually chose.
    if (overridesParam) url.searchParams.set('ov', overridesParam);
    else url.searchParams.delete('ov');
    url.searchParams.set('layout', layoutOptions.direction === 'DOWN' ? 'down' : 'right');
    if (groupByProfession) url.searchParams.set('group', '1');
    else url.searchParams.delete('group');
    // Superseded by `cols`; cleared so a refreshed link does not carry both.
    for (const legacy of ['cmpMode', 'cmpVal', 'cmpSlots']) url.searchParams.delete(legacy);
    history.replaceState({}, '', url.toString());
  });
  let globalUpgrade = $state(0);  // set in onMount from settings/URL

  // SvelteMap: plain Map in $state is not deeply reactive in Svelte 5
  const tagDefaults = new SvelteMap<string, string>(Object.entries(DEFAULT_TAG_CHOICES));

  let choices = $state<UserChoices>({
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(Object.entries(DEFAULT_TAG_CHOICES)),
    marketItems: new Set(DEFAULT_MARKET_ITEMS),
    upgradeByTable: new Map()
  });

  // What a plan looks like before the user touches anything. Only deviations from
  // this reach the URL, so a default plan's link stays as short as it ever was.
  const choiceBaseline = $derived<ChoiceBaseline>({
    recipeByItem: DEFAULT_RECIPE_CHOICES,
    itemByTag: Object.fromEntries(tagDefaults),
    marketItems: DEFAULT_MARKET_ITEMS,
  });

  // Every per-node decision, in the same syntax `./edm --overrides` reads.
  const overridesParam = $derived(
    serializeChoiceOverrides(overridesFromChoices($state.snapshot(choices) as UserChoices, choiceBaseline))
  );

  let plannerTableNodes = $state<TablePlannerNode[]>([]);
  let plannerRawNodes = $state<RawPlannerNode[]>([]);
  let plannerMarketNodes = $state<MarketPlannerNode[]>([]);
  let plannerUnresolvedTagNodes = $state<TagPlannerNode[]>([]);
  let plannerByproductNodes = $state<ByproductPlannerNode[]>([]);
  let plannerProductNode = $state<ProductPlannerNode | null>(null);
  let lastPlannerGraph = $state<PlannerGraph | null>(null);

  // Settings with derived per-item EDM filled in (metal scrap priced off the
  // matching concentrate). Everything that costs the live plan must use this
  // rather than `settings`, or those items read as missing.
  const edmSettings = $derived.by((): AppSettings => {
    if (!recipeIndex || !tagsIndex) return settings;
    return withDerivedEdmValues(settings, tagsIndex, {
      recipeIndex,
      tagsIndex,
      choices: $state.snapshot(choices) as UserChoices,
      globalUpgrade,
      talentData: settings.ecoMode === 'eco12' ? undefined : talentIndex,
      moduleData: usesModules ? (moduleIndex ?? undefined) : undefined,
      moduleSlots: usesModules ? activeModuleSlots : undefined
    });
  });

  const edmReport = $derived.by((): EdmReport | null => {
    if (!lastPlannerGraph) return null;
    if (!tagsIndex) return null;
    return computeEdmReport(lastPlannerGraph, edmSettings, tagsIndex);
  });

  const edmGrouped = $derived.by(() => {
    const groups = new Map<string | null, RawPlannerNode[]>();
    for (const node of plannerRawNodes) {
      const tags = tagsIndex?.itemToTags.get(node.itemName) ?? [];
      const primaryTag =
        tags.find(t => settings.edmTagDefaults[t] !== undefined) ?? tags[0] ?? null;
      const bucket = groups.get(primaryTag) ?? [];
      bucket.push(node);
      groups.set(primaryTag, bucket);
    }
    return groups;
  });

  const laborByProfession = $derived.by(() => {
    const map = new Map<string, number>();
    for (const n of plannerTableNodes) {
      const prof = n.recipe.SkillNeeds[0]?.Skill ?? 'No Skill Required';
      map.set(prof, (map.get(prof) ?? 0) + n.recipe.BaseLaborCost * n.cycles);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  // The report always shows the three real versions in release order, so the
  // Eco 12 → 13 → 14 trend is visible whichever version is being planned. Sandbox
  // joins them only when it has something to say — an empty patch would just
  // duplicate the Eco 14 column and cost the report a fifth of its width.
  const REPORT_MODES = $derived<EcoMode[]>(
    settings.ecoMode === 'sandbox' || !isPatchEmpty(settings.sandboxPatch)
      ? ['eco12', 'eco13', 'eco14', 'sandbox']
      : ['eco12', 'eco13', 'eco14']
  );

  function maxEfficiencyTarget(mode: EcoMode): ColumnTarget {
    if (usesModuleSlots(mode)) return { mode, slots: [...DEFAULT_MODULE_SLOTS] };
    const levels = getUpgradeLevels(mode);
    return { mode, value: levels[levels.length - 1].value };
  }


  // Per-version efficiency shown in the report. The active version's entry tracks the
  // planner's own setting; the others default to that version's maximum.
  let columnTargets = $state<Record<EcoMode, ColumnTarget>>({
    eco12: maxEfficiencyTarget('eco12'),
    eco13: maxEfficiencyTarget('eco13'),
    eco14: maxEfficiencyTarget('eco14'),
    sandbox: maxEfficiencyTarget('sandbox'),
  });

  // The planner's own efficiency setting, so the active column can tell whether it may
  // reuse the live graph or has to rebuild at a different efficiency.
  function activePlanTarget(): ColumnTarget {
    return usesModuleSlots(settings.ecoMode)
      ? { mode: settings.ecoMode, slots: MODULE_SLOTS.filter(s => activeModuleSlots.has(s)) }
      : { mode: settings.ecoMode as 'eco12' | 'eco13', value: globalUpgrade };
  }

  function sameTarget(a: ColumnTarget, b: ColumnTarget): boolean {
    if (a.mode !== b.mode) return false;
    if ('slots' in a && 'slots' in b) {
      return a.slots.length === b.slots.length && a.slots.every(s => b.slots.includes(s));
    }
    return 'value' in a && 'value' in b && a.value === b.value;
  }

  function targetLabel(target: ColumnTarget): string {
    if ('slots' in target) {
      if (target.slots.length === 0) return 'no modules';
      if (target.slots.length === MODULE_SLOTS.length) return 'all modules';
      return target.slots.join('+');
    }
    return getUpgradeLevels(target.mode as 'eco12' | 'eco13').find(l => l.value === target.value)?.label
      ?? `${Math.round(target.value * 100)}%`;
  }

  // Recipes, tags and talents are all version-specific, so every column must be built
  // from its own version's data. Loaded lazily, once per mode.
  const recipeIndexByMode = new SvelteMap<EcoMode, ReturnType<typeof buildRecipeIndex>>();
  const tagsIndexByMode = new SvelteMap<EcoMode, ReturnType<typeof buildTagsIndex>>();
  const talentIndexByMode = new SvelteMap<EcoMode, TalentIndex>();

  // The parsed files, before any sandbox patch. Kept because the Sandbox version
  // rebuilds its indexes from these on every edit — refetching Eco 14's 1.1 MB of
  // recipes for each keystroke would be absurd — and because the editor lists the
  // stock amounts a patch is departing from.
  interface RawVersionData {
    recipes: RecipeObject[];
    tags: Record<string, string[]>;
    professions: ProfessionData[] | null;
  }
  const rawDataByVersion = new SvelteMap<DataVersion, RawVersionData>();

  /** Indexes for one mode, with the sandbox patch folded in when mode is 'sandbox'. */
  function buildIndexesFor(mode: EcoMode, raw: RawVersionData) {
    const patch = settings.sandboxPatch ?? EMPTY_SANDBOX_PATCH;
    const applied = mode === 'sandbox'
      ? applySandboxPatch(raw.recipes, patch)
      : { recipes: raw.recipes, unmatched: [] as string[] };
    const professions = mode === 'sandbox' && raw.professions
      ? applyTalentPatch(raw.professions, patch)
      : raw.professions;

    return {
      recipeIndex: buildRecipeIndex(applied.recipes),
      tagsIndex: buildTagsIndex(raw.tags),
      talentIndex: mode !== 'eco12' && professions
        ? buildTalentIndex(professions, applied.recipes, raw.tags)
        : new Map() as TalentIndex,
      unmatched: applied.unmatched,
    };
  }

  function setIndexesFor(mode: EcoMode, raw: RawVersionData) {
    const built = buildIndexesFor(mode, raw);
    tagsIndexByMode.set(mode, built.tagsIndex);
    if (built.talentIndex.size > 0) talentIndexByMode.set(mode, built.talentIndex);
    // Set last: the column builder keys off this, so the other two indexes
    // must already be in place when it re-runs.
    recipeIndexByMode.set(mode, built.recipeIndex);
    return built;
  }

  async function fetchRawVersion(version: DataVersion): Promise<RawVersionData | null> {
    const cached = rawDataByVersion.get(version);
    if (cached) return cached;
    // The live API serves only the server's current version, so the other
    // versions always come from their version-specific static files.
    const [recipesRes, tagsRes, professionsRes] = await Promise.all([
      fetch(RECIPES_FILE[version]),
      fetch(TAGS_FILE[version]),
      fetch(PROFESSIONS_FILE[version]),
    ]);
    if (!recipesRes.ok || !tagsRes.ok) return null;
    const data: RecipeFile = await recipesRes.json();
    const tags: TagsFile = await tagsRes.json();
    const raw: RawVersionData = {
      recipes: data.Recipes,
      tags: tags.Tags,
      professions: professionsRes.ok
        ? ((await professionsRes.json()) as { professions: ProfessionData[] }).professions
        : null,
    };
    rawDataByVersion.set(version, raw);
    return raw;
  }

  $effect(() => {
    if (!showReport) return;  // only the report needs the other versions
    for (const mode of REPORT_MODES) {
      if (recipeIndexByMode.has(mode)) continue;
      (async () => {
        try {
          const raw = await fetchRawVersion(dataVersionOf(mode));
          if (raw) setIndexesFor(mode, raw);
        } catch {
          // That version's column stays unavailable and renders as dashes.
        }
      })();
    }
  });

  // An edit to the patch invalidates every Sandbox index. Rebuilt from the cached
  // raw data, so editing is instant and never refetches.
  function rebuildSandbox() {
    const raw = rawDataByVersion.get('eco14');
    if (!raw) return;
    const built = setIndexesFor('sandbox', raw);
    sandboxUnmatched = built.unmatched;
    if (settings.ecoMode === 'sandbox') {
      recipeIndex = built.recipeIndex;
      tagsIndex = built.tagsIndex;
      talentIndex = built.talentIndex;
      scheduleReplan();
    }
  }

  let sandboxUnmatched = $state<string[]>([]);

  /** Opening the editor needs Eco 14's raw data, which may not be loaded yet. */
  async function openSandbox() {
    if (!rawDataByVersion.has('eco14')) {
      loading = true;
      try { await fetchRawVersion('eco14'); } finally { loading = false; }
    }
    showSandbox = true;
  }

  function applySandboxEdit(next: SandboxPatch) {
    settings = { ...settings, sandboxPatch: next };
    saveSettings($state.snapshot(settings) as AppSettings);
    rebuildSandbox();
  }

  // One planned graph per version, reduced to the figures the report renders.
  const reportColumns = $derived.by((): ReportColumn[] => {
    if (!showReport || !recipeIndex || !tagsIndex) return [];
    const snap = $state.snapshot(choices) as UserChoices;

    return REPORT_MODES.map((mode): ReportColumn => {
      const target = columnTargets[mode];
      const isActive = mode === settings.ecoMode;
      const base = { mode, target, isActive, label: `${ECO_MODE_LABELS[mode]} · ${targetLabel(target)}` };

      const modeRecipeIndex = isActive ? recipeIndex : recipeIndexByMode.get(mode);
      const modeTagsIndex = isActive ? tagsIndex : tagsIndexByMode.get(mode);
      if (!modeRecipeIndex || !modeTagsIndex) return { ...base, snapshot: null };

      // The active version reports on the live plan, so the user's recipe, tag,
      // market and per-table choices are what they see. Other versions are rebuilt
      // clean: those choices reference the active version's recipe objects and its
      // table names, so carrying them over would silently mis-plan.
      if (isActive && lastPlannerGraph && sameTarget(target, activePlanTarget())) {
        return { ...base, snapshot: buildSnapshot(lastPlannerGraph, edmSettings, modeTagsIndex) };
      }

      const talentData = mode === 'eco12'
        ? undefined
        : (isActive ? talentIndex : talentIndexByMode.get(mode));

      const planOpts = {
        recipeIndex: modeRecipeIndex,
        tagsIndex: modeTagsIndex,
        choices: {
          ...snap,
          recipeByItem: isActive ? snap.recipeByItem : new Map(),
          variantByItem: isActive ? snap.variantByItem : new Map(),
          upgradeByTable: new Map(),
          moduleSlotsByTable: new Map()
        },
        globalUpgrade: 'slots' in target ? 0 : target.value,
        talentData,
        moduleData: 'slots' in target ? (moduleIndex ?? undefined) : undefined,
        moduleSlots: 'slots' in target ? new Set(target.slots) : undefined
      };

      try {
        const pg = buildGraph({ targetItem: selectedProduct, totalAmount: amount, ...planOpts });
        // Derived values are per column: a version's scrap is worth that version's concentrate.
        const colSettings = withDerivedEdmValues(settings, modeTagsIndex, planOpts);
        return { ...base, snapshot: buildSnapshot(pg, colSettings, modeTagsIndex) };
      } catch {
        return { ...base, snapshot: null };  // product does not exist in this version
      }
    });
  });


  // Per-unit figures divide by the amount actually produced, since batch rounding
  // can push it above the requested amount.
  const displayedAmount = $derived(plannerProductNode?.producedAmount ?? amount);

  let showReport = $state(false);
  let pendingOpenReport = $state(false);
  let showResolve = $state(false);
  let showLayoutSettings = $state(false);
  let showSandbox = $state(false);
  let layoutOptions = $state<LayoutOptions>({ ...DEFAULT_LAYOUT_OPTIONS });
  let darkMode = $state(true);
  let groupByProfession = $state(false);

  // When the eco mode came from a shared URL, keep persisting the user's own
  // mode so that opening someone's link doesn't rewrite their saved settings.
  let persistedEcoMode = $state<EcoMode | null>(null);

  $effect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.classList.toggle('light', !darkMode);
  });

  // Effects run in creation order, and this one is created before onMount. Without
  // the guard it fires first, writes DEFAULT_SETTINGS over localStorage, and then
  // onMount's loadSettings() reads back the defaults it just clobbered — which is
  // why nothing at all used to survive a reload.
  let settingsLoaded = $state(false);

  $effect(() => {
    if (!settingsLoaded) return;
    // Persist settings to localStorage whenever they change.
    // We snapshot to avoid capturing reactive proxies.
    const snap = $state.snapshot(settings) as AppSettings;
    if (persistedEcoMode) snap.ecoMode = persistedEcoMode;
    snap.darkMode = darkMode;
    snap.groupByProfession = groupByProfession;
    snap.layoutOptions = $state.snapshot(layoutOptions) as LayoutOptions;
    snap.tagDefaults = Object.fromEntries(tagDefaults);
    saveSettings(snap);
  });

  // Debounced replan for rapid-fire inputs (EDM values, markup) so node
  // stats stay in sync without rebuilding the graph on every keystroke.
  let replanTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleReplan() {
    if (replanTimer) clearTimeout(replanTimer);
    replanTimer = setTimeout(() => { replanTimer = null; replan(); }, 400);
  }

  function fmtDeltaPct(cur: number, cmp: number): string {
    if (cur === 0 && cmp === 0) return '—';
    if (cur === 0) return 'new';
    const pct = Math.round((cmp - cur) / cur * 100);
    return (pct > 0 ? '+' : '') + pct + '%';
  }

  // The compare dropdown must hold a single value, so Eco 14 is offered as the
  // cumulative slot ladder. Free per-slot choice stays on the main plan controls.
  // The Eco 14 slot ladder offered in the report's version bar. The planner itself
  // keeps free per-slot checkboxes; a dropdown needs one ordered list.
  function openReport() {
    // The active version's column mirrors whatever the planner is set to, so the
    // report always reflects the plan on screen rather than a hypothetical rebuild.
    columnTargets = { ...columnTargets, [settings.ecoMode]: activePlanTarget() };
    showReport = true;
  }

  function closeReport() {
    showReport = false;
  }

  function handleColumnTargetChange(mode: EcoMode, target: ColumnTarget) {
    columnTargets = { ...columnTargets, [mode]: target };
  }

  // SvelteFlow v0.1.x requires writable stores, not $state arrays
  const flowNodes = writable<Node[]>([]);
  const flowEdges = writable<Edge[]>([]);
  // Svelte Flow's connection handles are unnamed role="button"s; take them out of
  // the accessibility tree as they are rendered.
  $effect(() => {
    if (!browser) return;
    return hideFlowHandles(document.body);
  });

  let graphBuilding = $state(false);
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  // Announced in the live region at the end of every replan.
  let planStatus = $state('');
  let agentApi: AgentApiInstall | null = null;
  let fitViewPending = $state(false);

  // ── Data loading ─────────────────────────────────────────────────
  // Recipes, tags and talents are all version-specific.
  type DataVersion = 'eco12' | 'eco13' | 'eco14';

  const RECIPES_FILE: Record<DataVersion, string> = {
    eco12: './recipes.wt55.json',
    eco13: './recipes.wt56.json',
    eco14: './recipes.eco14.json',
  };
  const TAGS_FILE: Record<DataVersion, string> = {
    eco12: './tags.json',
    eco13: './tags.json',
    eco14: './tags.eco14.json',
  };
  const PROFESSIONS_FILE: Record<DataVersion, string> = {
    eco12: './professions.json',
    eco13: './professions.json',
    eco14: './professions.eco14.json',
  };

  // Only Eco 13 has a live endpoint we can use: white-tiger serves that version, and
  // the Eco 14 GoodPrice endpoint is HTTP-only so an HTTPS page cannot reach it.
  // Eco 12 and Eco 14 are frozen snapshots refreshed via scripts/refresh-eco14.sh.
  const hasLiveApi = (mode: EcoMode) => !dev && mode === 'eco13';
  const getRecipesUrl = (mode: EcoMode) =>
    hasLiveApi(mode) ? 'https://white-tiger.play.eco/api/v1/plugins/EcoPriceCalculator/recipes' : RECIPES_FILE[dataVersionOf(mode)];
  const getRecipesFallback = (mode: EcoMode) => RECIPES_FILE[dataVersionOf(mode)];
  const getTagsUrl = (mode: EcoMode) =>
    hasLiveApi(mode) ? 'https://white-tiger.play.eco/api/v1/plugins/EcoPriceCalculator/tags' : TAGS_FILE[dataVersionOf(mode)];
  const getTagsFallback = (mode: EcoMode) => TAGS_FILE[dataVersionOf(mode)];
  const getProfessionsUrl = (mode: EcoMode) => PROFESSIONS_FILE[dataVersionOf(mode)];

  async function fetchWithFallback(url: string, fallback: string): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) return res;
      return fetch(fallback);
    } catch {
      clearTimeout(id);
      return fetch(fallback);
    }
  }

  async function loadData(mode: EcoMode): Promise<void> {
    const [recipesRes, tagsRes, professionsRes, modulesRes] = await Promise.all([
      fetchWithFallback(getRecipesUrl(mode), getRecipesFallback(mode)),
      fetchWithFallback(getTagsUrl(mode), getTagsFallback(mode)),
      fetch(getProfessionsUrl(mode)),
      // Always loaded: the report can hold an Eco 14 column while planning in
      // Eco 12/13, and without this that column would silently get no modules.
      moduleIndex ? Promise.resolve(null) : fetch('./modules.eco14.json')
    ]);

    if (!recipesRes.ok || !tagsRes.ok) throw new Error('Failed to load data files');

    const recipesData: RecipeFile = await recipesRes.json();
    const tagsData: TagsFile = await tagsRes.json();

    // Cached unpatched, so switching to Sandbox — or editing its patch — rebuilds
    // from memory instead of refetching. Eco 13 may have come from the live API,
    // in which case that is genuinely this session's Eco 13 data.
    const raw: RawVersionData = {
      recipes: recipesData.Recipes,
      tags: tagsData.Tags,
      professions: professionsRes.ok
        ? ((await professionsRes.json()) as { professions: ProfessionData[] }).professions
        : null,
    };
    rawDataByVersion.set(dataVersionOf(mode), raw);

    const built = setIndexesFor(mode, raw);
    recipeIndex = built.recipeIndex;
    tagsIndex = built.tagsIndex;
    talentIndex = built.talentIndex;
    sandboxUnmatched = mode === 'sandbox' ? built.unmatched : [];

    // Without the module data an Eco 14 plan would silently fall back to a flat
    // globalUpgrade of 0, so a failed load must be loud rather than quietly wrong.
    if (modulesRes) {
      if (!modulesRes.ok) throw new Error('Failed to load modules.eco14.json');
      moduleIndex = buildModuleIndex(await modulesRes.json() as ModulesFile);
    }

    // Apply default recipe selections (e.g. Clean Medium Fish for Raw Fish)
    for (const [itemName, recipeKey] of Object.entries(DEFAULT_RECIPE_CHOICES)) {
      if (!choices.recipeByItem.has(itemName)) {
        const match = (recipeIndex.byProduct.get(itemName) ?? []).find(r => r.Key === recipeKey);
        if (match) choices.recipeByItem.set(itemName, match);
      }
    }

    // Validate product after data loads; fall back to first craftable if unknown
    if (!recipeIndex.allCraftableNames.includes(selectedProduct)) {
      selectedProduct = recipeIndex.allCraftableNames[0] ?? '';
    }
  }

  onMount(async () => {
    // Load persisted settings before first render/plan
    const saved = loadSettings();
    settings = saved;
    darkMode = saved.darkMode ?? true;
    groupByProfession = saved.groupByProfession ?? false;
    layoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...(saved.layoutOptions ?? {}) };
    if (saved.tagDefaults) {
      tagDefaults.clear();
      for (const [tag, item] of Object.entries(saved.tagDefaults)) tagDefaults.set(tag, item);
      choices = { ...choices, itemByTag: new Map(tagDefaults) };
    }
    // Apply URL eco-mode override before computing upgrade (shareable links),
    // without persisting it over the user's own saved mode
    if (_urlEcoMode && _urlEcoMode !== saved.ecoMode) {
      persistedEcoMode = saved.ecoMode;
      settings = { ...settings, ecoMode: _urlEcoMode };
    }
    if (usesModuleSlots(settings.ecoMode)) {
      globalUpgrade = 0;  // unused in Eco 14/Sandbox; reduction comes from the module slots
      if (_urlSlots) settings = { ...settings, moduleSlots: _urlSlots };
    } else {
      const activeLevels = getUpgradeLevels(settings.ecoMode);
      globalUpgrade = activeLevels[activeLevels.length - 1].value;
      if (_urlUpgrade !== null) globalUpgrade = _urlUpgrade;
    }
    // `cols` wins; a link shared before it existed carries a single cmp* target,
    // which still maps onto that version's column.
    const urlCols = parseColumnTargets(_urlParams?.get('cols'));
    if (_urlCmpMode === 'eco14' && _urlCmpSlots) urlCols.eco14 ??= { mode: 'eco14', slots: _urlCmpSlots };
    else if (_urlCmpMode && !usesModuleSlots(_urlCmpMode) && _urlCmpVal !== null) urlCols[_urlCmpMode] ??= { mode: _urlCmpMode, value: _urlCmpVal };
    if (Object.keys(urlCols).length > 0) columnTargets = { ...columnTargets, ...urlCols };
    if (_urlReport) pendingOpenReport = true;
    if (_urlLayoutDir) layoutOptions = { ...layoutOptions, direction: _urlLayoutDir };
    if (_urlGroup) groupByProfession = true;
    // Everything restored from storage and the URL is now in place, so saving
    // can no longer overwrite it with defaults.
    settingsLoaded = true;

    agentApi = installAgentApi({
      getState: () => ({
        product: selectedProduct,
        amount,
        ecoMode: settings.ecoMode,
        moduleSlots: usesModules ? [...activeModuleSlots] : null,
        globalUpgrade: usesModules ? null : globalUpgrade,
        overrides: overridesParam,
        priceSetId: priceSetId($state.snapshot(settings) as AppSettings),
        planning: graphBuilding,
        nodeCounts: {
          total: lastPlannerGraph?.nodes.length ?? 0,
          tables: plannerTableNodes.length,
          raw: plannerRawNodes.length,
          byproducts: plannerByproductNodes.length,
          unresolvedTags: plannerUnresolvedTagNodes.length,
        },
      }),
      getPlan: () => {
        if (!lastPlannerGraph) return null;
        return buildPlanExport(
          $state.snapshot(lastPlannerGraph) as PlannerGraph,
          edmReport,
          {
            ecoMode: settings.ecoMode,
            targetItem: selectedProduct,
            amount,
            ...(usesModules ? { moduleSlots: [...activeModuleSlots] } : { globalUpgrade }),
            priceSetId: priceSetId($state.snapshot(settings) as AppSettings),
            generatedAt: new Date().toISOString(),
          },
          overridesParam
        );
      },
      setProduct: async (name, nextAmount) => {
        selectedProduct = name;
        if (nextAmount !== undefined) amount = nextAmount;
        await replan(false);
      },
      setOverrides: async (ov) => {
        if (!recipeIndex) return;
        const applied = applyChoiceOverrides(
          $state.snapshot(choices) as UserChoices, parseChoiceOverrides(ov), recipeIndex
        );
        choices = applied.choices;
        await replan();
      },
      replan: () => replan(),
      listProducts: () => recipeIndex?.allCraftableNames ?? [],
    });

    try {
      await loadData(settings.ecoMode);
      // A recipe key only becomes a RecipeObject once the index exists, so the
      // link's per-node choices are applied here rather than with the rest of
      // the URL state above. Choices are not part of the persisted settings
      // blob, so this cannot be clobbered by the save effect.
      if (recipeIndex) {
        const applied = applyChoiceOverrides(
          $state.snapshot(choices) as UserChoices, _urlOverrides, recipeIndex
        );
        choices = applied.choices;
        if (applied.unmatched.length > 0) {
          console.warn('Ignored URL overrides that match nothing:', applied.unmatched.join(', '));
        }
      }
      loading = false;
      // Auto-plan on load — fresh layout so viewport fits
      await replan(false);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      planStatus = `Could not load ${ECO_MODE_LABELS[settings.ecoMode]} data: ${error}`;
      loading = false;
      agentApi.markReady();
    }
  });

  // ── Byproduct resolve options ─────────────────────────────────────
  // Computes all ways a byproduct can be used: directly satisfying an unresolved tag,
  // or by crafting it into a primary product that satisfies an unresolved tag.
  function computeResolveOptions(
    itemName: string,
    unresolvedTags: TagPlannerNode[]
  ): ByproductResolveOption[] {
    if (!recipeIndex || !tagsIndex) return [];
    if (EXCLUDED_BYPRODUCTS.has(itemName)) return [];
    const unresolved = new Map(unresolvedTags.map(n => [n.tag, n.amount]));
    const options: ByproductResolveOption[] = [];
    const seen = new Set<string>();

    for (const tag of tagsIndex.itemToTags.get(itemName) ?? []) {
      if (!unresolved.has(tag)) continue;
      const key = `${itemName}:${tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ outputItem: itemName, tag, tagAmount: unresolved.get(tag)! });
    }

    for (const recipe of recipeIndex.byIngredient.get(itemName) ?? []) {
      const variant = recipe.Variants.find(v => v.Name === recipe.DefaultVariant) ?? recipe.Variants[0];
      const primary = variant?.Products[0];
      if (!primary) continue;
      for (const tag of tagsIndex.itemToTags.get(primary.Name) ?? []) {
        if (!unresolved.has(tag)) continue;
        const key = `${primary.Name}:${tag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
          outputItem: primary.Name,
          tag,
          tagAmount: unresolved.get(tag)!,
          via: { tableName: recipe.CraftingTable },
        });
      }
    }

    options.sort((a, b) => {
      const d = (a.via ? 1 : 0) - (b.via ? 1 : 0);
      return d !== 0 ? d : a.outputItem.localeCompare(b.outputItem);
    });
    return options;
  }

  // ── Planning ─────────────────────────────────────────────────────
  async function replan(preservePositions = true) {
    if (!recipeIndex || !tagsIndex) return;
    graphBuilding = true;

    try {
      const plannerGraph = buildGraph({
        targetItem: selectedProduct,
        totalAmount: amount,
        recipeIndex,
        tagsIndex,
        choices: $state.snapshot(choices) as UserChoices,
        globalUpgrade,
        talentData: settings.ecoMode === 'eco12' ? undefined : talentIndex,
        moduleData: usesModules ? (moduleIndex ?? undefined) : undefined,
        moduleSlots: usesModules ? activeModuleSlots : undefined
      });

      lastPlannerGraph = plannerGraph;
      plannerTableNodes = plannerGraph.nodes.filter((n): n is TablePlannerNode => n.type === 'table');
      plannerRawNodes = plannerGraph.nodes.filter((n): n is RawPlannerNode => n.type === 'raw');
      plannerMarketNodes = plannerGraph.nodes.filter((n): n is MarketPlannerNode => n.type === 'market');
      plannerUnresolvedTagNodes = plannerGraph.nodes.filter(
        (n): n is TagPlannerNode =>
          n.type === 'tag' && n.amount > 0 &&
          (n.selectedItem === null || (n.byproductContributors?.length ?? 0) > 0)
      );
      plannerByproductNodes = plannerGraph.nodes.filter((n): n is ByproductPlannerNode => n.type === 'byproduct');
      plannerProductNode = plannerGraph.nodes.find((n): n is ProductPlannerNode => n.type === 'product') ?? null;

      const { buildFlowGraph } = await import('$lib/graphBuilder.js');
      const flow = await buildFlowGraph(plannerGraph, groupByProfession, layoutOptions);

      let layoutNodes = flow.nodes;

      if (preservePositions) {
        const currentNodes = get(flowNodes);
        const currentMap = new Map(currentNodes.map(n => [n.id, n]));
        layoutNodes = flow.nodes.map(n => {
          const existing = currentMap.get(n.id);
          return existing ? { ...n, position: existing.position } : n;
        });
      }

      // Inject callbacks into node data here (avoids infinite $effect loops)
      const pgNodeMap = new Map(plannerGraph.nodes.map(n => [n.id, n]));
      const localEdmReport = computeEdmReport(plannerGraph, edmSettings, tagsIndex!);
      const edgesByTarget = new Map<string, string[]>();
      const producerTableOf = new Map<string, TablePlannerNode>();

      for (const edge of plannerGraph.edges) {
        const sources = edgesByTarget.get(edge.target) ?? [];
        sources.push(edge.source);
        edgesByTarget.set(edge.target, sources);
        if (edge.source.startsWith('table:')) {
          const tableNode = pgNodeMap.get(edge.source);
          if (tableNode?.type === 'table') producerTableOf.set(edge.target, tableNode as TablePlannerNode);
        }
      }

      function resolveProducerTable(nodeId: string, seen = new Set<string>()): TablePlannerNode | undefined {
        if (seen.has(nodeId)) return undefined;
        seen.add(nodeId);
        const direct = producerTableOf.get(nodeId);
        if (direct) return direct;
        for (const sourceId of edgesByTarget.get(nodeId) ?? []) {
          const sourceNode = pgNodeMap.get(sourceId);
          if (sourceNode?.type === 'table') return sourceNode as TablePlannerNode;
          const indirect = resolveProducerTable(sourceId, seen);
          if (indirect) return indirect;
        }
        return undefined;
      }

      flowNodes.set(layoutNodes.map(n => {
        if (n.type === 'tableNode') {
          const tNode = n.data as unknown as TablePlannerNode;
          const isWorkParty = EDM_MARKUP_EXCLUDED_RECIPES.has(tNode.recipe.Key);
          const prof = tNode.recipe.SkillNeeds[0]?.Skill ?? '';
          const tier = PROFESSION_FOOD_TIER[prof] ?? 'basic';

          const ingredientStats: IngredientStats[] = tNode.variant.Ingredients.map(ing => {
            let name = ing.Name;
            if (!ing.IsSpecificItem && ing.Tag) {
              name = choices.itemByTag.get(ing.Tag)
                ?? (pgNodeMap.get(`tag:${ing.Tag}`) as TagPlannerNode | undefined)?.selectedItem
                ?? ing.Tag;
            }
            const amount = ingredientAmountPerCycle(ing, tNode) * tNode.cycles;
            let edmPerUnit = resolveItemEdmValue(name, settings, tagsIndex!);
            if (edmPerUnit === null) {
              const inputId = ing.IsSpecificItem ? `item:${ing.Name}` : `tag:${ing.Tag as string}`;
              const producerTable = resolveProducerTable(inputId);
              if (producerTable) edmPerUnit = tableEdmPerUnit(producerTable, localEdmReport);
            }
            const totalEdm = edmPerUnit !== null ? amount * edmPerUnit : null;
            return { name, amount, edmPerUnit, totalEdm };
          });

          if (isWorkParty) {
            const labourAmount = tNode.recipe.BaseLaborCost * tNode.cycles;
            if (labourAmount > 0) {
              ingredientStats.unshift({ name: 'Food', amount: labourAmount, edmPerUnit: WORK_PARTY_EDM_PER_LABOR, totalEdm: labourAmount * WORK_PARTY_EDM_PER_LABOR });
            }
          } else {
            const foodCalories = tNode.recipe.BaseLaborCost * tNode.cycles / 2;
            const foodEdm = settings.foodCostEnabled
              ? (foodCalories / 1000) * settings.foodTierCosts[tier]
              : null;
            if (foodCalories > 0) {
              const foodEdmPerUnit = foodEdm !== null ? foodEdm / foodCalories : null;
              ingredientStats.unshift({ name: 'Food', amount: foodCalories, edmPerUnit: foodEdmPerUnit, totalEdm: foodEdm });
            }
          }

          const productStats: ProductStats[] = tNode.variant.Products.map(prod => {
            const productAmount = prod.Ammount * tNode.cycles;
            let edmPerUnit = resolveItemEdmValue(prod.Name, settings, tagsIndex!);
            if (edmPerUnit === null && prod.Name === tNode.itemName) {
              edmPerUnit = tableEdmPerUnit(tNode, localEdmReport);
            }
            const totalEdm = edmPerUnit !== null ? productAmount * edmPerUnit : null;
            return { name: prod.Name, amount: productAmount, edmPerUnit, totalEdm };
          });

          return {
            ...n,
            data: {
              ...n.data,
              onRecipeChange: handleRecipeChange,
              onVariantChange: handleVariantChange,
              onMarketSelect: handleMarketSelect,
              onUpgradeChange: handleUpgradeChange,
              currentUpgrade: choices.upgradeByTable.get(tNode.table) ?? globalUpgrade,
              upgradeLevels,
              // undefined in Eco 12/13, which keeps the upgrade-ladder dropdown
              availableSlots: usesModules ? availableSlotsFor(tNode.table) : undefined,
              currentSlots: usesModules ? currentSlotsFor(tNode.table) : undefined,
              onModuleSlotsChange: handleModuleSlotsChange,
              ingredientStats,
              productStats,
              valueAdded: localEdmReport?.tableValueAdded.get(tNode.id) ?? null,
              showStats: settings.showNodeStats,
            }
          };
        }
        if (n.type === 'tagNode') {
          return { ...n, data: { ...n.data, onTagSelect: handleTagSelect } };
        }
        if (n.type === 'marketNode') {
          return { ...n, data: { ...n.data, onRecipeChange: handleRecipeChange } };
        }
        if (n.type === 'byproductNode') {
          const bpNode = n.data as unknown as ByproductPlannerNode;
          const resolveOptions = computeResolveOptions(
            bpNode.itemName,
            plannerUnresolvedTagNodes
          );
          return { ...n, data: { ...n.data, resolveOptions, onResolve: handleTagSelect } };
        }
        return n;
      }));
      flowEdges.set(flow.edges);
      if (!preservePositions) fitViewPending = true;
      if (pendingOpenReport && lastPlannerGraph) {
        pendingOpenReport = false;
        openReport();
      }
      // Planning is async and finishes silently: nothing in the DOM says whether
      // an empty canvas means "still computing" or "no recipe". Announcing the
      // outcome gives screen readers and agents the same completion signal.
      planStatus = plannerTableNodes.length === 0
        ? `No plan for ${selectedProduct} — nothing produces it in ${ECO_MODE_LABELS[settings.ecoMode]}.`
        : `Plan ready — ${plural(plannerTableNodes.length, 'step')}, ` +
          `${plural(plannerRawNodes.length, 'raw input')}, ` +
          `${plural(plannerByproductNodes.length, 'byproduct')}, ` +
          `${plural(plannerUnresolvedTagNodes.length, 'unresolved tag')}.`;
      agentApi?.markReady();
    } catch (e) {
      planStatus = `Planning failed: ${e instanceof Error ? e.message : String(e)}`;
      agentApi?.markReady();
      throw e;
    } finally {
      graphBuilding = false;
    }
  }

  function handlePlan() {
    // Reset user choices when explicitly replanning with a new product/amount
    const resetRecipes = new Map<string, RecipeObject>();
    for (const [itemName, recipeKey] of Object.entries(DEFAULT_RECIPE_CHOICES)) {
      const match = (recipeIndex?.byProduct.get(itemName) ?? []).find(r => r.Key === recipeKey);
      if (match) resetRecipes.set(itemName, match);
    }
    choices = {
      recipeByItem: resetRecipes,
      variantByItem: new Map(),
      itemByTag: new Map(tagDefaults),  // restore configurable defaults
      marketItems: new Set(DEFAULT_MARKET_ITEMS),
      upgradeByTable: new Map()
    };
    replan(false);
  }

  // ── Node event handlers ──────────────────────────────────────────
  function handleRecipeChange(itemName: string, recipe: RecipeObject) {
    choices.marketItems.delete(itemName);
    choices.recipeByItem.set(itemName, recipe);
    choices = { ...choices, recipeByItem: new Map(choices.recipeByItem), marketItems: new Set(choices.marketItems) };
    replan();
  }

  function handleMarketSelect(itemName: string) {
    choices.marketItems.add(itemName);
    choices.recipeByItem.delete(itemName);
    choices.variantByItem.delete(itemName);
    choices = { ...choices, marketItems: new Set(choices.marketItems), recipeByItem: new Map(choices.recipeByItem), variantByItem: new Map(choices.variantByItem) };
    replan();
  }

  function handleVariantChange(itemName: string, variant: Variant) {
    choices.variantByItem.set(itemName, variant);
    choices = { ...choices, variantByItem: new Map(choices.variantByItem) };
    replan();
  }

  function handleTagSelect(tag: string, item: string) {
    choices.itemByTag.set(tag, item);
    choices = { ...choices, itemByTag: new Map(choices.itemByTag) };
    replan();
  }

  function handleUpgradeChange(tableName: string, value: number) {
    choices.upgradeByTable.set(tableName, value);
    choices = { ...choices, upgradeByTable: new Map(choices.upgradeByTable) };
    replan();
  }

  // Eco 14 per-table module slots. Which slots a table exposes comes from its
  // allow-list, so a table that takes no Specialty module never offers the toggle.
  const availableSlotsFor = (tableName: string): ModuleSlot[] =>
    usesModules ? (moduleIndex?.availableSlotsFor(tableName) ?? []) : [];

  const currentSlotsFor = (tableName: string): ModuleSlot[] => {
    const override = choices.moduleSlotsByTable?.get(tableName);
    if (override) return override;
    // No override yet: the table follows the global selection, limited to what it can fill.
    return availableSlotsFor(tableName).filter(s => activeModuleSlots.has(s));
  };

  function handleModuleSlotsChange(tableName: string, slots: ModuleSlot[]) {
    const next = new Map(choices.moduleSlotsByTable ?? []);
    next.set(tableName, slots);
    choices = { ...choices, moduleSlotsByTable: next };
    replan();
  }

  function handleResolveApply(tagChoices: Map<string, string>) {
    for (const [tag, item] of tagChoices) {
      choices.itemByTag.set(tag, item);
    }
    choices = { ...choices, itemByTag: new Map(choices.itemByTag) };
    showResolve = false;
    replan();
  }
</script>

<svelte:head>
  <title>Eco Production Planner</title>
</svelte:head>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (showLayoutSettings) showLayoutSettings = false;
    else if (showReport) closeReport();
  }}
/>

<div class="app">
  <header class="toolbar">
    <h1>Eco Production Planner</h1>

    <div class="controls">
      <label>
        Product:
        <select bind:value={selectedProduct} disabled={loading}>
          {#if recipeIndex}
            {#each recipeIndex.allCraftableNames as name}
              <option value={name}>{name}</option>
            {/each}
          {:else}
            <option>Loading…</option>
          {/if}
        </select>
      </label>

      <label>
        Amount:
        <input type="number" bind:value={amount} min="1" step="1" disabled={loading} />
      </label>

      <label>
        Version:
        <select
          value={settings.ecoMode}
          disabled={loading}
          onchange={async (e) => {
            const newMode = (e.target as HTMLSelectElement).value as EcoMode;
            const prevMode = settings.ecoMode;
            const prevUpgrade = globalUpgrade;
            persistedEcoMode = null; // manual switch: persist the user's choice
            settings = { ...settings, ecoMode: newMode };
            // Eco 14 and Sandbox have no ladder. Coming *from* one of them there is
            // no meaningful level to carry over (globalUpgrade is unused there), so
            // land on the mode's max; between Eco 12 and 13, keep the closest level.
            if (!usesModuleSlots(newMode)) {
              const levels = getUpgradeLevels(newMode);
              globalUpgrade = usesModuleSlots(prevMode)
                ? levels[levels.length - 1].value
                : levels.map(l => l.value).reduce((prev, cur) =>
                    Math.abs(cur - globalUpgrade) < Math.abs(prev - globalUpgrade) ? cur : prev
                  );
            }
            loading = true;
            try {
              await loadData(newMode);
            } catch (err) {
              // Revert: keep the old mode's data and settings usable
              console.error(`Failed to load ${newMode} data:`, err);
              settings = { ...settings, ecoMode: prevMode };
              globalUpgrade = prevUpgrade;
              return;
            } finally {
              loading = false;
            }
            // Reset per-item choices that may be invalid under the new recipe
            // set, re-applying default recipe selections from the new index
            const resetRecipes = new Map<string, RecipeObject>();
            for (const [itemName, recipeKey] of Object.entries(DEFAULT_RECIPE_CHOICES)) {
              const match = (recipeIndex?.byProduct.get(itemName) ?? []).find(r => r.Key === recipeKey);
              if (match) resetRecipes.set(itemName, match);
            }
            choices = {
              ...choices,
              recipeByItem: resetRecipes,
              variantByItem: new Map(),
              itemByTag: new Map(tagDefaults),
              marketItems: new Set(DEFAULT_MARKET_ITEMS),
              // Table names and module allow-lists are version-specific
              upgradeByTable: new Map(),
              moduleSlotsByTable: new Map()
            };
            // The product may not exist in the new version's recipe set
            if (recipeIndex && !recipeIndex.allCraftableNames.includes(selectedProduct)) {
              selectedProduct = recipeIndex.allCraftableNames[0] ?? '';
            }
            await replan(false);
          }}
        >
          {#each ECO_MODES as mode}
            <option value={mode}>{ECO_MODE_LABELS[mode]}</option>
          {/each}
        </select>
      </label>

      <!-- Reachable from any version: you edit the Sandbox to compare it against
           whichever version you are currently planning in. -->
      <button class="sandbox-btn" class:sandbox-btn-on={!isPatchEmpty(settings.sandboxPatch)}
        disabled={loading} onclick={openSandbox}>
        Overrides{#if patchedVariantCount(settings.sandboxPatch) > 0}
          <span class="sandbox-count">{patchedVariantCount(settings.sandboxPatch)}</span>
        {/if}
      </button>

      {#if usesModules}
        <!-- Eco 14: four independent slots, each filled or empty. A specialty
             module only reduces recipes of its own skill, so the effective
             reduction differs per table and per recipe. -->
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <fieldset class="module-slots" disabled={loading}>
          <legend>Modules:</legend>
          {#each MODULE_SLOTS as slot}
            <label class="checkbox-label">
              <input
                type="checkbox"
                checked={activeModuleSlots.has(slot)}
                onchange={(e) => {
                  const on = (e.target as HTMLInputElement).checked;
                  const next = new Set(activeModuleSlots);
                  if (on) next.add(slot); else next.delete(slot);
                  settings = { ...settings, moduleSlots: MODULE_SLOTS.filter(x => next.has(x)) };
                  scheduleReplan();
                }}
              />
              {slot}
            </label>
          {/each}
        </fieldset>
      {:else}
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label>
          Upgrade (global):
          <select bind:value={globalUpgrade} disabled={loading}>
            {#each upgradeLevels as lvl}
              <option value={lvl.value}>{lvl.label} ({lvl.value * 100}%)</option>
            {/each}
          </select>
        </label>
      {/if}

      <button onclick={handlePlan} disabled={loading || graphBuilding}>
        Plan!
      </button>

      <button onclick={() => openReport()} disabled={loading || $flowNodes.length === 0}>
        Generate Report
      </button>

      <button onclick={() => showResolve = true} disabled={loading || $flowNodes.length === 0}>
        Resolve
      </button>

      <button onclick={() => replan(false)} disabled={loading || graphBuilding || $flowNodes.length === 0}
        title="Reset node positions and re-run auto-layout">
        Re-layout
      </button>

      <button onclick={() => showLayoutSettings = true} disabled={loading} title="Layout, tag defaults and EDM settings">
        Settings
      </button>

      <label class="checkbox-label">
        <input type="checkbox" bind:checked={groupByProfession} onchange={() => replan(false)} />
        Group by Profession
      </label>

      <button class="theme-toggle" onclick={() => darkMode = !darkMode} title="Toggle light/dark mode">
        {darkMode ? 'Light Mode' : 'Dark Mode'}
      </button>
    </div>
  </header>

  <!-- The only aria-live region on the page used to be SvelteKit's own announcer,
       which never says anything about the plan. This one does. -->
  <div class="sr-only" role="status" aria-live="polite">{planStatus}</div>

  <main class="canvas-container">
    <div class="graph-area">
      {#if loading}
        <div class="status">Loading game data…</div>
      {:else if error}
        <div class="status error">Error: {error}</div>
      {:else}
        <SvelteFlow
          nodes={flowNodes}
          edges={flowEdges}
          {nodeTypes}
          {edgeTypes}
          minZoom={0.05}
        >
          <FitViewOnDemand {fitViewPending} onFitViewDone={() => { fitViewPending = false; }} />
          <Panel position="top-right">
            <select
              class="direction-select"
              value={layoutOptions.direction}
              onchange={e => { layoutOptions = { ...layoutOptions, direction: (e.target as HTMLSelectElement).value as LayoutOptions['direction'] }; replan(false); }}
            >
              <option value="RIGHT">→ Left to Right</option>
              <option value="DOWN">↓ Top to Bottom</option>
            </select>
          </Panel>
          <Controls />
          <Background />
          <MiniMap />
        </SvelteFlow>

        {#if $flowNodes.length === 0}
          <div class="status">Select a product and click Plan!</div>
        {/if}
      {/if}
    </div>

    {#if plannerTableNodes.length > 0}
      <TablePane
        tableNodes={plannerTableNodes}
        upgradeByTable={choices.upgradeByTable}
        {globalUpgrade}
        {upgradeLevels}
        onRecipeChange={handleRecipeChange}
        onUpgradeChange={handleUpgradeChange}
        onMarketSelect={handleMarketSelect}
        availableSlots={availableSlotsFor}
        currentSlots={currentSlotsFor}
        onModuleSlotsChange={handleModuleSlotsChange}
      />
    {/if}
  </main>
</div>

{#if showReport}
  <ReportModal
    columns={reportColumns}
    {settings}
    {selectedProduct}
    requestedAmount={amount}
    onTargetChange={handleColumnTargetChange}
    onClose={closeReport}
  />
{/if}

{#if showSandbox && rawDataByVersion.get('eco14')}
  {@const raw = rawDataByVersion.get('eco14')!}
  <SandboxModal
    recipes={raw.recipes}
    professions={raw.professions ?? []}
    patch={settings.sandboxPatch ?? EMPTY_SANDBOX_PATCH}
    unmatched={sandboxUnmatched}
    onChange={applySandboxEdit}
    onClose={() => (showSandbox = false)}
  />
{/if}

{#if showResolve && recipeIndex && tagsIndex}
  <ResolveModal
    byproductNodes={plannerByproductNodes}
    unresolvedTagNodes={plannerUnresolvedTagNodes}
    {recipeIndex}
    {tagsIndex}
    inChainItems={new Set(plannerTableNodes.map(n => n.itemName))}
    onApply={handleResolveApply}
    onClose={() => showResolve = false}
  />
{/if}

{#if showLayoutSettings}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div class="report-overlay" role="dialog" aria-modal="true" tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) showLayoutSettings = false; }}>
    <div class="report-panel layout-settings-panel">
      <div class="report-header">
        <h2>Settings</h2>
        <button class="close-btn" onclick={() => showLayoutSettings = false}>✕</button>
      </div>

      <section>
        <h3 class="settings-section-title">Layout</h3>
        <label class="settings-row">
          <span class="settings-label">Thoroughness</span>
          <select
            value={layoutOptions.thoroughness}
            onchange={e => { layoutOptions = { ...layoutOptions, thoroughness: Number((e.target as HTMLSelectElement).value) }; replan(false); }}
          >
            <option value={7}>7 – Default</option>
            <option value={15}>15 – Better</option>
            <option value={25}>25 – Best</option>
            <option value={50}>50 – Max</option>
          </select>
        </label>

        <label class="settings-row">
          <span class="settings-label">Node Placement</span>
          <select
            value={layoutOptions.nodePlacement}
            onchange={e => { layoutOptions = { ...layoutOptions, nodePlacement: (e.target as HTMLSelectElement).value as LayoutOptions['nodePlacement'] }; replan(false); }}
          >
            <option value="BRANDES_KOPP">BRANDES_KOPP – Default</option>
            <option value="LINEAR_SEGMENTS">LINEAR_SEGMENTS</option>
            <option value="NETWORK_SIMPLEX">NETWORK_SIMPLEX</option>
          </select>
        </label>
      </section>

      <section>
        <h3 class="settings-section-title">Tag Defaults</h3>
        {#each tagDefaults.entries() as [tag, item]}
          <label class="settings-row">
            <span class="settings-label">{tag}</span>
            {#if tagsIndex}
              <select
                value={item}
                onchange={e => {
                  const newItem = (e.target as HTMLSelectElement).value;
                  tagDefaults.set(tag, newItem);
                  choices.itemByTag.set(tag, newItem);
                  replan();
                }}
              >
                {#each tagsIndex.byTag.get(tag) ?? [] as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else}
              <span class="settings-value">{item}</span>
            {/if}
          </label>
        {/each}
      </section>

      <section>
        <h3 class="settings-section-title">EDM Values</h3>

        <label class="settings-row">
          <span class="settings-label">Cross-profession markup</span>
          <div class="edm-markup-row">
            <input
              type="number"
              class="edm-number-input"
              min="0"
              max="100"
              step="1"
              value={Math.round(settings.crossProfessionMarkup * 100)}
              oninput={e => {
                const raw = (e.target as HTMLInputElement).value;
                if (raw === '') return; // mid-edit, keep previous value
                const v = Number(raw);
                if (!isNaN(v)) { settings = { ...settings, crossProfessionMarkup: v / 100 }; scheduleReplan(); }
              }}
            />
            <span class="edm-unit">%</span>
          </div>
        </label>

        <label class="settings-row">
          <span class="settings-label">Include food cost</span>
          <input
            type="checkbox"
            checked={settings.foodCostEnabled}
            onchange={e => { settings = { ...settings, foodCostEnabled: (e.target as HTMLInputElement).checked }; replan(); }}
          />
        </label>

        <label class="settings-row">
          <span class="settings-label">Show node statistics</span>
          <input
            type="checkbox"
            checked={settings.showNodeStats}
            onchange={e => { settings = { ...settings, showNodeStats: (e.target as HTMLInputElement).checked }; replan(); }}
          />
        </label>

        {#if settings.foodCostEnabled}
          <div class="edm-food-tiers">
            <div class="edm-food-tier-header">EDM per 1k calories:</div>
            {#each [['baseline', 'Baseline'], ['basic', 'Basic'], ['advanced', 'Advanced'], ['modern', 'Modern']] as [tier, label]}
              <label class="settings-row edm-food-tier-row">
                <span class="settings-label edm-food-tier-label">{label}</span>
                <div class="edm-markup-row">
                  <input
                    type="number"
                    class="edm-number-input"
                    min="0"
                    step="0.1"
                    value={settings.foodTierCosts[tier as keyof typeof settings.foodTierCosts]}
                    oninput={e => {
                      const v = Number((e.target as HTMLInputElement).value);
                      if (!isNaN(v)) { settings = { ...settings, foodTierCosts: { ...settings.foodTierCosts, [tier]: v } }; replan(); }
                    }}
                  />
                  <span class="edm-unit">EDM</span>
                </div>
              </label>
            {/each}
          </div>
        {/if}

        {#if plannerRawNodes.length > 0 && tagsIndex}
          <div class="edm-resources-header">Raw resources (current plan):</div>
          {#each [...edmGrouped.entries()].sort(([a], [b]) => (a ?? '￿').localeCompare(b ?? '￿')) as [tag, nodes]}
            <div class="edm-tag-group">
              <div class="edm-tag-header">
                <span class="edm-tag-name">{tag ?? 'Ungrouped'}</span>
                {#if tag !== null}
                  <input
                    type="number"
                    class="edm-number-input"
                    min="0"
                    step="0.01"
                    value={settings.edmTagDefaults[tag] ?? ''}
                    placeholder="—"
                    oninput={e => {
                      const v = (e.target as HTMLInputElement).value;
                      const num = parseFloat(v);
                      const newDefaults = { ...settings.edmTagDefaults };
                      if (v === '' || isNaN(num)) {
                        delete newDefaults[tag];
                      } else {
                        newDefaults[tag] = num;
                      }
                      settings = { ...settings, edmTagDefaults: newDefaults };
                      scheduleReplan();
                    }}
                  />
                  <span class="edm-tag-unit">tag default</span>
                {/if}
              </div>

              {#each [...nodes].sort((a, b) => a.itemName.localeCompare(b.itemName)) as node}
                {@const hasException = settings.edmValues[node.itemName] !== undefined}
                {@const effectiveVal = resolveItemEdmValue(node.itemName, edmSettings, tagsIndex)}
                {@const isMissing = effectiveVal === null}
                <div class="settings-row edm-item-row" class:edm-missing-row={isMissing}>
                  <span class="settings-label edm-item-label" class:edm-missing-name={isMissing}>
                    {#if isMissing}⚠ {/if}{node.itemName}
                  </span>
                  <div class="edm-item-value">
                    {#if hasException}
                      <input
                        type="number"
                        class="edm-number-input"
                        min="0"
                        step="0.01"
                        value={settings.edmValues[node.itemName]}
                        oninput={e => {
                          const v = (e.target as HTMLInputElement).value;
                          const num = parseFloat(v);
                          const newEdm = { ...settings.edmValues };
                          if (v === '' || isNaN(num)) {
                            delete newEdm[node.itemName];
                          } else {
                            newEdm[node.itemName] = num;
                          }
                          settings = { ...settings, edmValues: newEdm };
                          scheduleReplan();
                        }}
                      />
                      <button
                        class="edm-icon-btn"
                        title="Reset to tag default"
                        onclick={() => {
                          const newEdm = { ...settings.edmValues };
                          delete newEdm[node.itemName];
                          settings = { ...settings, edmValues: newEdm };
                          scheduleReplan();
                        }}
                      >↩</button>
                    {:else}
                      <span class="edm-inherited-value">{effectiveVal !== null ? +effectiveVal.toFixed(2) : '—'}</span>
                      <button
                        class="edm-icon-btn"
                        title="Override for this item"
                        onclick={() => {
                          settings = { ...settings, edmValues: { ...settings.edmValues, [node.itemName]: effectiveVal ?? 0 } };
                          scheduleReplan();
                        }}
                      >✎</button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        {:else}
          <p class="empty">Generate a plan first to see raw resources.</p>
        {/if}

        <button
          class="export-edm-btn"
          onclick={() => {
            const snap = $state.snapshot(settings) as AppSettings;
            const json = JSON.stringify({ edmValues: snap.edmValues, edmTagDefaults: snap.edmTagDefaults }, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'edm-values.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export EDM as JSON
        </button>
      </section>
    </div>
  </div>
{/if}

<style>
  :global(html) { color-scheme: dark; }
  :global(html.light) { color-scheme: light; }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: #121212;
    color: #e0e0e0;
  }

  :global(html.light body) {
    background: #f0f4f8;
    color: #1a1a1a;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .toolbar {
    background: #1e1e1e;
    border-bottom: 1px solid #333;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-shrink: 0;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    color: #7ec8e3;
    white-space: nowrap;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #b0b0b0;
  }

  select, input[type="number"] {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
  }

  select {
    min-width: 180px;
    max-width: 280px;
  }

  input[type="number"] {
    width: 80px;
  }

  button {
    background: #1a6b3a;
    border: 1px solid #2a9b5a;
    color: #e0ffe0;
    border-radius: 4px;
    padding: 6px 18px;
    font-size: 13px;
    cursor: pointer;
    font-weight: bold;
  }

  button:hover:not(:disabled) {
    background: #1e8044;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .canvas-container {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }

  .graph-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: #888;
  }

  .status.error {
    color: #e06060;
  }

  .report-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }

  .report-panel {
    background: #1e1e1e; border: 1px solid #444; border-radius: 8px;
    min-width: 360px; width: min(860px, 90vw); max-height: 85vh;
    overflow-y: auto; color: #e0e0e0;
    display: flex; flex-direction: column;
  }

  .report-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 20px 24px 12px;
    position: sticky; top: 0; z-index: 2;
    background: #1e1e1e;
    border-bottom: 1px solid #2a2a2a;
    margin-bottom: 0;
    flex-shrink: 0;
  }

  .report-header h2 {
    margin: 0; font-size: 16px; color: #7ec8e3;
  }

  .close-btn {
    background: none; border: none; color: #888; font-size: 18px; cursor: pointer; padding: 0;
  }

  .report-panel section {
    margin-bottom: 20px;
  }

  .report-panel h3 {
    font-size: 13px; color: #a0c4e0; margin: 0 0 8px;
    text-transform: uppercase; letter-spacing: 0.05em;
  }

  .empty {
    color: #666; font-style: italic; font-size: 12px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #b0b0b0;
    cursor: pointer;
    margin-left: auto;
  }

  .theme-toggle {
    background: #2a2a2a;
    border: 1px solid #555;
    color: #b0b0b0;
  }

  /* ── Light mode overrides ─────────────────────────────────────── */

  /* App chrome */
  :global(html.light) .toolbar {
    background: #ffffff;
    border-bottom-color: #d0d0d0;
  }
  :global(html.light) h1 { color: #1a6b9a; }
  :global(html.light) label { color: #444; }
  :global(html.light) select,
  :global(html.light) input[type="number"] {
    background: #ffffff;
    border-color: #bbb;
    color: #1a1a1a;
  }
  :global(html.light) button {
    background: #1a6b3a;
    border-color: #2a9b5a;
    color: #e0ffe0;
  }
  :global(html.light) button:hover:not(:disabled) { background: #1e8044; }
  :global(html.light) .checkbox-label { color: #444; }
  :global(html.light) .theme-toggle {
    background: #e8e8e8;
    border-color: #bbb;
    color: #444;
  }
  :global(html.light) .theme-toggle:hover { background: #d8d8d8; }
  :global(html.light) .status { color: #555; }
  :global(html.light) .status.error { color: #c0392b; }

  /* SvelteFlow canvas */
  :global(html.dark .svelte-flow) { background: #141414; }
  :global(html.light .svelte-flow) { background: #f8fafc; }
  :global(html.light .svelte-flow__edge path),
  :global(html.light .svelte-flow__edge polyline) { stroke: #6b7280; }
  :global(html.light .svelte-flow__edge-label) { color: #1a1a1a; }
  :global(html.light .svelte-flow__controls button) {
    background: #ffffff; color: #333; border-color: #ccc;
  }
  :global(html.light .svelte-flow__controls button:hover) { background: #f0f0f0; }
  :global(html.light .svelte-flow__minimap) { background: #e8ecf0; }
  :global(html.light .svelte-flow__background pattern circle),
  :global(html.light .svelte-flow__background pattern rect) { fill: #c0c8d0; }

  /* TableNode */
  :global(html.light .table-node) {
    background: #dbeafe; border-color: #2563eb; color: #1e3a5f;
  }
  :global(html.light .table-node .header) {
    background: #bfdbfe; border-bottom-color: #2563eb; color: #1e3a5f;
  }
  :global(html.light .table-node .cycles) { color: #1d4ed8; }
  :global(html.light .table-node .picker-row label) { color: #374151; }
  :global(html.light .table-node select) {
    background: #eff6ff; border-color: #2563eb; color: #1e3a5f;
  }
  :global(html.light .table-node .returnables) { border-top-color: #2563eb; }
  :global(html.light .table-node .lb-name) { color: #374151; }
  :global(html.light .table-node .stats-section.first-bottom) { border-top-color: #2563eb; }
  :global(html.light .table-node .stats-cals) { color: #374151; }
  :global(html.light .table-node .food-edm) { color: #b45309; }
  :global(html.light .table-node .stats-label) { color: #1d4ed8; }
  :global(html.light .table-node .stats-values) { color: #1e3a5f; }

  /* RawNode */
  :global(html.light .raw-node) {
    background: #f0f0f0; border-color: #888; color: #222;
  }
  :global(html.light .raw-node .label) { color: #777; }
  :global(html.light .raw-node .amount) { color: #555; }

  /* ByproductNode */
  :global(html.light .byproduct-node) {
    background: #f3e8ff; border-color: #9333ea; color: #3b0764;
  }
  :global(html.light .byproduct-node .label) { color: #7c3aed; }
  :global(html.light .byproduct-node .amount) { color: #6d28d9; }
  :global(html.light .byproduct-node.excluded) {
    background: #fde8e8; border-color: #dc2626; color: #450a0a;
  }
  :global(html.light .byproduct-node.excluded .label) { color: #b91c1c; }
  :global(html.light .byproduct-node.excluded .amount) { color: #dc2626; }

  /* TagNode */
  :global(html.light .tag-node) {
    background: #fef3c7; border-color: #d97706; color: #451a03;
  }
  :global(html.light .tag-node .header) {
    background: #fde68a; border-bottom-color: #d97706; color: #92400e;
  }
  :global(html.light .tag-node .amount) { color: #92400e; }
  :global(html.light .tag-node .picker-row select) {
    background: #fffbeb; border-color: #d97706; color: #451a03;
  }

  /* MarketNode */
  :global(html.light .market-node) {
    background: #dcfce7; border-color: #16a34a; color: #052e16;
  }
  :global(html.light .market-node .header) {
    background: #bbf7d0; border-bottom-color: #16a34a; color: #166534;
  }
  :global(html.light .market-node .amount) { color: #166534; }
  :global(html.light .market-node select) {
    background: #f0fdf4; border-color: #16a34a; color: #052e16;
  }

  /* ProductNode */
  :global(html.light .product-node) {
    background: #dcfce7; border-color: #22c55e; color: #052e16;
  }
  :global(html.light .product-node .label) { color: #16a34a; }
  :global(html.light .product-node .amount) { color: #15803d; }
  :global(html.light .product-node .amount-label) { color: #4ade80; }
  :global(html.light .product-node .amount-value) { color: #15803d; }

  /* TablePane */
  :global(html.light) .canvas-container :global(aside.table-pane) {
    background: #ffffff; border-left-color: #d0d0d0;
  }
  :global(html.light .table-pane .pane-header) {
    background: #f0f0f0; border-bottom-color: #d0d0d0; color: #1a6b9a;
  }
  :global(html.light .table-pane .skill-group) { border-bottom-color: #e0e0e0; }
  :global(html.light .table-pane .skill-header) { background: #f8f8f8; color: #555; }
  :global(html.light .table-pane .table-entry) { border-bottom-color: #e8e8e8; }
  :global(html.light .table-pane .entry-item) { color: #666; }
  :global(html.light .table-pane .entry-table) { color: #1a3a5c; }
  :global(html.light .table-pane .entry-cycles) { color: #1d4ed8; }
  :global(html.light .table-pane .entry-row label) { color: #555; }
  :global(html.light .table-pane .entry-row select) {
    background: #f5f5f5; border-color: #bbb; color: #1a1a1a;
  }

  /* Report modal */
  :global(html.light) .report-panel {
    background: #ffffff; border-color: #d0d0d0; color: #1a1a1a;
  }
  :global(html.light) .report-header { background: #ffffff; border-bottom-color: #e0e0e0; }
  :global(html.light) .report-header h2 { color: #1a6b9a; }
  :global(html.light) .report-panel h3 { color: #374151; }
  :global(html.light) .close-btn { color: #555; }
  :global(html.light) .empty { color: #888; }

  .layout-settings-panel {
    min-width: 360px;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .layout-settings-panel > section {
    padding: 0 24px;
  }

  .layout-settings-panel > section:last-child {
    padding-bottom: 20px;
  }

  .settings-section-title {
    margin: 12px 0 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666;
  }

  :global(html.light) .settings-section-title { color: #999; }

  .settings-value {
    font-size: 13px;
    color: #888;
  }

  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    font-size: 13px;
    color: #b0b0b0;
  }

  .settings-label {
    white-space: nowrap;
  }

  .layout-settings-panel select {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    min-width: 180px;
  }

  :global(html.light) .settings-row { color: #444; }
  :global(html.light) .layout-settings-panel select {
    background: #ffffff; border-color: #bbb; color: #1a1a1a;
  }

  /* EDM styles */

  .edm-missing-name { color: #d4a017; }

  /* EDM Settings */
  .edm-resources-header {
    font-size: 11px;
    color: #666;
    margin: 8px 0 4px;
    font-style: italic;
  }

  .edm-number-input {
    width: 80px;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
    text-align: right;
  }

  .edm-markup-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .edm-unit { color: #888; font-size: 12px; }

  .edm-missing-row { background: rgba(212, 160, 23, 0.07); border-radius: 3px; }

  .edm-tag-group {
    margin-bottom: 10px;
    border: 1px solid #2a2a2a;
    border-radius: 4px;
    overflow: hidden;
  }

  .edm-tag-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    background: #1e2a1e;
    font-weight: 600;
    font-size: 12px;
  }

  .edm-tag-name {
    flex: 1;
    color: #8ec88e;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .edm-tag-unit {
    color: #555;
    font-size: 10px;
    font-weight: normal;
  }

  .edm-item-row {
    padding: 2px 8px 2px 20px;
    min-height: 28px;
    border-top: 1px solid #1e1e1e;
  }

  .edm-item-label { font-size: 12px; }

  .edm-item-value {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .edm-inherited-value {
    display: inline-block;
    width: 80px;
    text-align: right;
    color: #555;
    font-size: 12px;
    padding-right: 4px;
  }

  .edm-icon-btn {
    background: none;
    border: 1px solid #333;
    color: #888;
    font-size: 12px;
    padding: 1px 5px;
    cursor: pointer;
    border-radius: 3px;
    line-height: 1.4;
  }

  .edm-icon-btn:hover { border-color: #666; color: #ccc; background: #222; }

  .export-edm-btn {
    margin-top: 12px;
    width: 100%;
    background: #2a3a2a;
    border: 1px solid #4a7a4a;
    color: #90d090;
    font-size: 12px;
    padding: 6px 12px;
    font-weight: normal;
  }

  .export-edm-btn:hover:not(:disabled) { background: #334433; }

  .sandbox-btn {
    background: none; border: 1px solid #444; color: #aaa;
    font-size: 12px; cursor: pointer; padding: 3px 9px; border-radius: 4px;
  }
  .sandbox-btn:hover:not(:disabled) { border-color: #aaa; color: #ddd; }
  .sandbox-btn:disabled { opacity: 0.5; cursor: default; }
  .sandbox-btn-on { border-color: #4a90c4; color: #7ec8e3; }
  .sandbox-count {
    margin-left: 5px; font-size: 10px; color: #1e1e1e;
    background: #4a90c4; border-radius: 8px; padding: 0 5px;
  }
  :global(html.light) .sandbox-btn { border-color: #d0d0d0; color: #555; }
  :global(html.light) .sandbox-btn-on { border-color: #2563eb; color: #1d4ed8; }
  :global(html.light) .sandbox-count { color: #fff; background: #2563eb; }

  .module-slots {
    display: flex; align-items: center; gap: 0.5rem;
    border: 1px solid #444; border-radius: 4px; padding: 0.15rem 0.5rem; margin: 0;
  }
  .module-slots legend { padding: 0 0.3rem; font-weight: bold; color: #7ec8e3; }
  .module-slots .checkbox-label { margin: 0; }

  :global(html.light) .edm-number-input {
    background: #fff; border-color: #bbb; color: #1a1a1a;
  }
  :global(html.light) .edm-tag-group { border-color: #d0d8d0; }
  :global(html.light) .edm-tag-header { background: #e8f0e8; }
  :global(html.light) .edm-tag-name { color: #3a7a3a; }
  :global(html.light) .edm-item-row { border-top-color: #e8e8e8; }
  :global(html.light) .edm-inherited-value { color: #aaa; }
  :global(html.light) .edm-icon-btn { border-color: #ccc; color: #666; }
  :global(html.light) .edm-icon-btn:hover { border-color: #888; color: #333; background: #f0f0f0; }
  :global(html.light) .export-edm-btn {
    background: #e8f5e8; border-color: #4a9a4a; color: #1a5a1a;
  }
  :global(html.light) .module-slots { border-color: #ccc; }
  :global(html.light) .module-slots legend { color: #1a6b9a; }

  :global(.direction-select) {
    background: #1e1e1e;
    border: 1px solid #444;
    color: #e0e0e0;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
  }

  :global(html.light .direction-select) {
    background: #ffffff;
    border-color: #bbb;
    color: #1a1a1a;
  }
</style>
