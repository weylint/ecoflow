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
- `byproduct:Name:from:ProducerItem` — dead-end byproduct
- `loopback:Name:from:ProducerItem` — returnable tool/container (Mold, Barrel)
- `market:Name` → actually uses `item:Name` id (MarketNode reuses the item slot)

## Upgrade / Skill Reduction

- `globalUpgrade` (0–1 fraction) is the default for all tables
- `choices.upgradeByTable: Map<string, number>` overrides per crafting table name
- `effectiveReduction = choices.upgradeByTable.get(recipe.CraftingTable) ?? globalUpgrade`
- Applied as: `IsStatic ? amount : amount * (1 - effectiveReduction)`
- `UPGRADE_LEVELS` constant in `types.ts` defines the 6 tiers (0%, 15%, 25%, 40%, 45%, 50%)

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

## Known Gotchas

- **`Ammount` double-m**: intentional misspelling in both `recipes.json` and `types.ts` — matches the game's export format
- **ELK cycle handling**: ELK can throw on graphs with cycles; the fallback is a simple grid layout
- **Svelte 5 stores for SvelteFlow**: `flowNodes` and `flowEdges` must be `writable()` stores (not `$state`) because SvelteFlow's internal binding expects the store interface
- **`$derived.by`**: used in `TablePane.svelte` for the skill-group map because `$derived` requires a single expression
- **Callback injection**: node callbacks (`onRecipeChange`, etc.) are injected in `replan()` after layout, not stored in `PlannerGraph` — this avoids stale closures and `$effect` loops
- **`+layout.ts`**: must export `prerender = true; ssr = false` — the static adapter requires it
