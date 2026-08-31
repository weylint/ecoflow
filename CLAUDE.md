# Eco Production Planner — CLAUDE.md

## Project Overview

A graph-based production planning web app for the game Eco, inspired by the Satisfactory Calculator. Given a target item and quantity, it builds a directed graph showing every crafting table, ingredient, and byproduct required to produce it.

**Stack:** Svelte 5 (runes), SvelteKit with `adapter-static`, `@xyflow/svelte` for the flow canvas, `elkjs` for auto-layout, Vitest for unit tests. Hosted on GitHub Pages.

## Key Architecture

| File | Role |
|------|------|
| `src/lib/types.ts` | All TypeScript interfaces and constants (`UPGRADE_LEVELS`, node types, `UserChoices`) |
| `src/lib/recipeIndex.ts` | Builds `byProduct` map (item name → recipes) and `allCraftableNames` list |
| `src/lib/tagsIndex.ts` | Builds `byTag` and `itemToTags` reverse maps from `tags.json` |
| `src/lib/moduleIndex.ts` | Eco 14 only: resolves module reduction per `(table, skill, slots)` |
| `src/lib/edmDerived.ts` | Prices items with no producer off another item (metal scrap ← concentrate) |
| `src/app.css` | Design tokens (`:root` + `html.light`), imported by `+layout.svelte` |
| `src/lib/reportColumns.ts` | Report column model — `buildSnapshot`, `unionRows`, `previousValue`, `cols` URL codec |
| `src/lib/components/ReportModal.svelte` | The Production Report — all three versions side by side |
| `src/lib/components/ReportTable.svelte` | Shared N-column comparison table used by every report section |
| `src/lib/planner.ts` | Two-pass DFS: Pass 1 accumulates requirements + byproduct supply; Pass 2 creates nodes + edges |
| `src/lib/graphBuilder.ts` | Converts `PlannerGraph` → SvelteFlow nodes/edges via ELK layout |
| `src/lib/components/` | TableNode, ItemNode, RawNode, TagNode, MarketNode, ByproductNode, LoopbackNode |
| `src/lib/components/TablePane.svelte` | Right-side panel listing all tables with recipe/upgrade selects |
| `src/routes/+page.svelte` | Main UI — loads data, manages state, wires callbacks |
| `src/routes/+layout.ts` | Must export `prerender = true; ssr = false` or the static adapter build fails |

## Data-Flow Summary

1. `recipes.json` and `tags.json` are fetched from `/static/` at runtime
2. `buildRecipeIndex` and `buildTagsIndex` build lookup maps
3. `buildGraph(opts)` returns `PlannerGraph { nodes, edges }`:
   - **Pass 1** (`resolveScaled`): DFS accumulates `requirements` (item→amount) and `byproductSupply` (item→amount). Loopback items (product that is also a non-static ingredient) only contribute their net loss to requirements.
   - **Post-pass 1**: matches byproduct items to unsatisfied tag requirements (`byproductForTag` map)
   - **Pass 2** (`buildNodes`): creates typed `PlannerNode` objects and edges
4. `buildFlowGraph(plannerGraph)` runs ELK layout on non-loopback nodes, then post-positions loopback nodes below their table. Returns SvelteFlow-compatible nodes/edges.
5. `+page.svelte` injects callbacks (onRecipeChange, onUpgradeChange, etc.) into node data after layout

## Node ID Scheme

All IDs are prefixed to prevent collisions:
- `item:Name` — craftable or fully-byproduct-covered item
- `table:Name` — crafting table producing the item
- `raw:Name` — leaf resource with no recipe
- `tag:TagName` — tag ingredient (e.g. `tag:Wood`)
- `byproduct:Name` — dead-end byproduct (same item from multiple tables is merged into one node)
- `loopback:Name:from:ProducerItem` — returnable tool/container (Mold, Barrel)
- `market:Name` → actually uses `item:Name` id (MarketNode reuses the item slot)

## Eco Version Modes

`EcoMode = 'eco12' | 'eco13' | 'eco14'`. Eco 12 and Eco 13 are **frozen** reference points;
Eco 14 is the version under active balancing and is the default. Every data file is
version-specific:

| Mode | Recipes | Tags | Talents | Modules |
|------|---------|------|---------|---------|
| `eco12` | `recipes.wt55.json` | `tags.json` | none applied | Upgrade 0–5 ladder |
| `eco13` | `recipes.wt56.json` | `tags.json` | `professions.json` | Upgrade 0–5 ladder |
| `eco14` | `recipes.eco14.json` | `tags.eco14.json` | `professions.eco14.json` | 4 slots (`modules.eco14.json`) |

`professions.eco13.json` / `tags.eco13.json` are frozen copies kept so an Eco 14 data
refresh can never silently overwrite the Eco 13 reference.

A fourth mode, **`sandbox`**, is Eco 14's data with the user's own overrides applied — see
"Sandbox Version" below. It reads Eco 14's files (`dataVersionOf('sandbox') === 'eco14'`) and
uses Eco 14's module slots (`usesModuleSlots`), so anything branching on "is this Eco 14"
must use those two helpers rather than `mode === 'eco14'`.

Only Eco 13 has a live API (white-tiger, tried first in production with a static
fallback). Eco 12 and Eco 14 always read their frozen static files — the Eco 14
GoodPrice endpoint is HTTP-only and unreachable from the HTTPS-hosted build.

## Upgrade / Module Reduction

**Eco 12 / Eco 13** — a single progressive ladder:
- `globalUpgrade` (0–1 fraction) is the default for all tables
- `ECO12_UPGRADE_LEVELS` (0/15/25/40/45/50%) and `ECO13_UPGRADE_LEVELS` (0/5/10/15/20/25%)
  in `types.ts`, selected by `getUpgradeLevels(mode)`

**Eco 14** — four independent slots (`MODULE_SLOTS`: Basic, Advanced, Modern, Specialty),
each filled or empty, resolved by `src/lib/moduleIndex.ts`:
- Resource-cost bonuses **pool additively** (`BonusEffectAdditivePercent`), so a slot
  selection collapses to one fraction: Basic −10% + Advanced −10% + Modern −15% = −35%
- A table only takes modules on its own `[AllowPluginModules]` allow-list, which also
  decides which slots it exposes (Rocker Box: Basic + Specialty only)
- **Specialty modules are skill-scoped**, so reduction depends on the recipe's skill, not
  just the table. Machinist Table: Mining −55%, Mechanics −40%, Blacksmith −35%. Reduction
  is therefore keyed on `(CraftingTable, SkillNeeds[0].Skill)` — never on the table alone.
- Taking the best specialty per skill is an **upper bound**: one physical table holds one
  specialty module. `TablePlannerNode.appliedModules` names what each reduction assumed.

Per-table overrides: Eco 12/13 use `choices.upgradeByTable` (a reduction fraction);
Eco 14 uses `choices.moduleSlotsByTable` (that table's own slot selection, defaulting to
the global one). `moduleIndex.availableSlotsFor(table)` drives the UI so a table is only
offered slots its allow-list can fill — Rocker Box shows Basic + Specialty, Froth
Floatation Cell shows Modern + Specialty.

Both paths funnel through `upgradeReductionFor(recipe)` in `planner.ts`; a numeric
`choices.upgradeByTable` override still wins over either (and suppresses the module chips,
since the modules no longer explain the number). Applied identically in
`resourceCost.ts`: `IsStatic ? amount : amount * (1 - upgradeReduction)`, then the talent
reduction multiplies on top (matching the engine, where multiplicative bonuses stack on
the pooled additive total).

## Loopback Nodes (Molds/Barrels)

A **loopback** occurs when a recipe product also appears as an `IsStatic: false` ingredient in the same variant (e.g. Clay Mold used and returned by iron casting):
- `grossAmount = ingredientAmt × cycles`
- `returnAmount = product.Ammount × (1 - effectiveReduction) × cycles`
- `netAmount = grossAmount - returnAmount`
- Loopback nodes are excluded from ELK layout; positioned manually below their table
- Two bidirectional edges: `table → loopback` (return) and `loopback → table` (input)
- If `netAmount > 0`, an external supply edge is added: `item → loopback`

## Tag Edge Routing (Fix A/B)

When a byproduct auto-satisfies a tag ingredient:
- **Fix B (byproduct output):** `table:Producer → tag:T` directly (no `item:X` node created)
- **Fix A (tag section):** for user-selected items, `item:X → tag:T → table:Consumer` (not item→table directly)
- Result: the tag node IS the unified representation — no separate item node alongside it

## Testing Conventions

- Tests live in `src/tests/`, use Vitest with `$lib` path aliases
- `graphBuilder.test.ts` mocks `elkjs/lib/elk.bundled.js` (ELK is not available in Node test env)
- `emptyChoices()` helper returns a zeroed `UserChoices` — always include `upgradeByTable: new Map()`
- `buildGraph` parameter is `globalUpgrade` (not `skillReduction`)
- **Component tests** (`reportModal.test.ts`) use `@testing-library/svelte` under jsdom.
  `vite.config.ts` sets `resolve.conditions = ['browser']` under `VITEST`; without it Svelte
  resolves to its server build and `mount()` throws `lifecycle_function_unavailable`.

## EDM CLI

`./edm "<item name>" <amount> [--eco eco12|eco13|eco14|sandbox] [--upgrade 0-5 | --slots LIST] [--patch FILE] [--csv]`

Computes the EDM for a recipe chain without the browser UI. Defaults to Eco 14 with all
module slots. `--upgrade` applies to eco12/eco13, `--slots` (`all`, `none`, or a comma list
of `basic,advanced,modern,specialty`) to eco14; using the wrong flag for a mode is an error.
Run `./edm --help` for full usage. Entry point: `cli/edm.ts`; shell wrapper: `edm` (repo root).

## Production Report

`ReportModal.svelte` renders **all three versions side by side**, always in release order
(Eco 12 → 13 → 14), whichever version is being planned:

- The column for the **active** version reuses the live plan graph, so your recipe, tag,
  market and per-table choices are what it reports; its label states the actual efficiency
  (`Eco 14 · Basic+Modern`) so a non-max plan is never read as max. The other two are rebuilt
  clean at max efficiency, adjustable from the version bar.
- The version bar's Eco 14 chip offers the **four module slots as independent checkboxes**,
  like the planner toolbar. It was a select over cumulative presets (Basic → +Advanced →
  +Modern → max), which reached only 5 of the 16 slot combinations — dropping Modern while
  keeping Specialty was not expressible. Eco 12/13 keep a select because their upgrade
  ladder genuinely is one dimension.
- **Δ compares each column with the one before it** (`previousValue`), skipping a version
  where the product does not exist rather than blanking the next column's delta. Each Δ is
  rendered **before** the version it explains — `Eco 12 · Δ · Eco 13 · Δ · Eco 14` — so the
  change is read on the way into the number, not back over it. Δ carries a ▲/▼ glyph as well
  as its colour, since red/green alone fails in greyscale and for red-green colour deficiency.
- Every numeric section renders through `ReportTable.svelte`, so column headers, delta
  colouring and empty states are identical everywhere. `lowerIsBetter` flips the colouring
  for yields (byproducts, value added) versus costs.
- Section order is fixed — Summary, Resources, Labor, Value Added, Cross-profession
  transitions — and empty sections say "None" rather than disappearing.
- **Every section's table shares one column grid.** `ReportTable` is `table-layout: fixed`
  with a `<colgroup>` built from percentage constants (`LABEL_BLOCK`, `DELTA_W`, `VALUE_W`,
  `TRAILING_W`), so a version's column sits at the same x whether the section has one label
  column (Profession), three (Table / Item / Profession) or trailing EDM columns — a
  spreadsheet's column B does not move between sheets. Two rules keep it working: the widths
  must sum to **under 100% for the widest section** (Raw Ingredients, the only one with
  trailing columns) or the browser scales every column down and the other sections drift out
  of step; and each table ends in an unsized `.col-spacer` cell that absorbs the slack, so
  sections without trailing columns don't stretch their sized columns to fill the row.
- `.report-body` is the scroll container, not `.report-panel`: the header, version bar and
  jump bar are plain flex children pinned by layout (they used to be `position: sticky` with
  hardcoded `top: 0` / `top: 55px`, and any header-height change opened a gap between them),
  and `thead th` sticks at `top: 0` with no magic offset.
- URL state is one `cols` parameter (`cols=eco12:0.5;eco13:0.25;eco14:basic,modern`). Links
  shared before it existed carry `cmpMode`/`cmpVal`/`cmpSlots` and are still read.

`modules.eco14.json` is loaded on first `loadData` regardless of the active mode, because the
report can hold an Eco 14 column while you plan in Eco 12/13. It previously loaded only when
Eco 14 was active, which silently gave that column *no* module reduction — Steam Truck read
200 Iron Ore instead of 40.

## EDM for Items Nothing Produces

Recipes consume several items no recipe produces (Recycling feedstock, waste streams), so
the planner makes them raw leaves. A raw leaf with no EDM sets `baseEdm = null`, which nulls
the plan's whole total and exits the CLI with an error — one unpriced item blanks the report.

- **Garbage** (`Bio Residue`, `Food Scrap`, `Glass Scrap`, `Plastic Scrap`, `Electronic
  Scrap`, `Tailings`, `Wet Tailings`, and eco12/13's `Spoiled Food`) is `0.01` in
  `DEFAULT_EDM_VALUES`, like `Dirt` and `Compost`.
- **Metal scrap** is *derived*, not a literal: `Iron/Copper/Gold Scrap` substitute 1:1 for
  the matching concentrate in otherwise identical recipes, so `edmDerived.ts` plans one unit
  of the concentrate and uses its per-unit EDM. Everything that costs a plan must therefore
  run `withDerivedEdmValues` first — `+page.svelte`'s `edmSettings` derived, one call per
  report column, and `cli/edm.ts`. A user override always wins, and derivation runs against
  the *original* settings so a chain that came back through a derived item resolves to null
  and is skipped rather than recursing.
- `Clam`, `Moon Jellyfish` and `Pacific Sardine` are priced per item, deliberately not via a
  `Fish` / `Small Fish` tag default: `resolveItemEdmValue` returns the **first** matching
  tag, so a broad `Fish` default would shadow `Large Fish` for items carrying both.
- `Wood Scrap` and `Textiles` are knowingly left unpriced — `edmCoverage.test.ts` walks all
  three versions' real data files and fails on any *new* unpriced ingredient, with those two
  in an explicit `ACCEPTED_GAPS` set.

## Theming

`src/app.css` holds the token layer (`:root`, overridden wholesale under `html.light`),
imported once from `src/routes/+layout.svelte`. Only `ReportModal` and `ReportTable` are
converted; `+page.svelte` and `ResolveModal.svelte` still carry hand-written
`:global(html.light)` rules, which is what let the report's delta greens/reds go missing in
light mode. Style new report elements with `var(--…)` and they need no light-mode rule.

## Sandbox Version

`src/lib/sandbox.ts` — a fourth version for what-if balancing: Eco 14 plus a patch, costed
side by side against the three real versions.

- **Overrides are keyed by variant key, not recipe key.** One recipe has several variants
  (Iron Bar 2 ore → 4 bars, Smelt Iron 4 → 8); lowering one yield must not move its sibling.
- `applySandboxPatch` copies only touched recipes and variants, sharing the rest by
  reference — it must never mutate the parsed data another version's index is holding, and
  deep-copying ~3000 recipes per keystroke is not an option.
- Overrides that match no variant come back as `unmatched` and are surfaced in the editor
  and as a CLI warning, rather than silently doing nothing after a data refresh.
- Talents are switched off by filtering `professions` *before* `buildTalentIndex` — that
  index is the only place a talent has any effect.
- Stored in `settings.sandboxPatch` (localStorage), validated through `parseSandboxPatch` on
  load rather than trusted. Export/Import in the editor writes the same JSON the CLI's
  `--patch` reads. It is deliberately **not** in the `cols` URL param: a dozen edits is well
  over a kilobyte of link.
- The Sandbox column joins the report only when the patch is non-empty or Sandbox is the
  version being planned — an empty patch would just duplicate the Eco 14 column.
- `rebuildSandbox()` in `+page.svelte` rebuilds its indexes from `rawDataByVersion`, the
  cached unpatched files, so an edit never refetches Eco 14's 1.1 MB of recipes.

CLI: `./edm "<item>" <n> --eco sandbox --patch eco-sandbox-patch.json`.

## Settings Persistence Gotcha

`$effect` bodies run in creation order, and the settings-persisting effect in `+page.svelte`
is created before `onMount`. It therefore used to fire *first*, write `DEFAULT_SETTINGS` over
localStorage, and leave `onMount`'s `loadSettings()` reading back the defaults it had just
clobbered — no setting survived a reload at all. The `settingsLoaded` guard is what prevents
that; any new state restored in `onMount` must be in place before it is set.

## Refreshing Eco 14 Data

```bash
scripts/refresh-eco14.sh                       # current build (Steam tree + gs1)
scripts/refresh-eco14.sh --mods ../ecoserv_14/Mods   # once White Tiger leaves the Beta
```

Pulls recipes from `http://gs1.play.eco:3041/api/v1/plugins/GoodPrice/recipes` and extracts
modules, tags and talents from the game's C# sources via `scripts/extract-{modules.mjs,tags.py,talents.py}`.

**The mods tree and the recipe endpoint must be the same build.** `../ecoserv_14/Mods` is the
Eco 14 *Beta* (Advanced −5%, Modern −5%); the current build is the Steam install (Advanced
−10%, Modern −15%), which is what gs1 serves. `refresh-eco14.sh` asserts this and fails
loudly rather than silently mixing builds.

The GoodPrice `/tags` and `/allTalentDefinitions` routes are **not** usable: `/tags` emits
only recipe-referenced tags (47 vs 93, missing `Ore`, which EDM tag defaults need) and
`/allTalentDefinitions` returns an empty list. Hence the C# extractors.

## Known Gotchas

- **`Ammount` double-m**: intentional misspelling in both `recipes.json` and `types.ts` — matches the game's export format
- **ELK cycle handling**: ELK can throw on graphs with cycles; the fallback is a simple grid layout
- **Svelte 5 stores for SvelteFlow**: `flowNodes` and `flowEdges` must be `writable()` stores (not `$state`) because SvelteFlow's internal binding expects the store interface
- **`$derived.by`**: used in `TablePane.svelte` for the skill-group map because `$derived` requires a single expression
- **Callback injection**: node callbacks (`onRecipeChange`, etc.) are injected in `replan()` after layout, not stored in `PlannerGraph` — this avoids stale closures and `$effect` loops
- **`+layout.ts`**: must export `prerender = true; ssr = false` — the static adapter requires it
- **Recycling recipes are de-prioritized** in `recipeIndex.ts`: Eco 14's `Recycling` skill consumes scrap/waste streams (Iron Scrap, Textiles, Tailings) that no recipe produces, so they can never be planned from raw resources. Without this, `Recycled Steel Bar` beats `Steel Bar` on a craft-time tie-break. They still win when they are the only producer. Inert for eco12/eco13, which have no `Recycling` skill.
- **Parsing C# bonus blocks**: match `/new Bonus\s*\{(.*?)\n\s*\},/s`, never `split('new Bonus')` — that substring also occurs in `new BonusEffect…`, which truncates every block before its Effects list and silently yields 0% for every module.
- **`Recycling` has no `PROFESSION_FOOD_TIER` entry** (`edm.ts`), so it falls back to `'basic'`. Pre-existing siblings: the map keys `'Advanced Bakery'` and `'Basic Engineer'` do not match the recipes' `'Advanced Baking'` and `'Basic Engineering'`, so those already fall through in eco13 too.
