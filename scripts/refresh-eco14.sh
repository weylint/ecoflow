#!/usr/bin/env bash
# Refresh the frozen Eco 14 data snapshot in static/.
#
# Eco 14 data is a committed snapshot, not a runtime fetch: the GoodPrice endpoint
# is HTTP-only and the app is served over HTTPS from GitHub Pages.
#
# The mods tree and the recipe endpoint must be the SAME build. ../ecoserv_14/Mods
# is the Eco 14 *Beta* (Advanced -5%, Modern -5%); the current build lives in the
# Steam install (Advanced -10%, Modern -15%) and is what gs1 serves. The
# fingerprint check below fails loudly if the two ever drift apart.
#
# Usage: scripts/refresh-eco14.sh [--mods <dir>] [--api <base-url>]

set -euo pipefail
cd "$(dirname "$0")/.."

MODS="/mnt/c/Games/Steam/steamapps/common/Eco/Eco_Data/Server/Mods"
API="http://gs1.play.eco:3041/api/v1/plugins/GoodPrice"

while [ $# -gt 0 ]; do
  case "$1" in
    --mods) MODS="$2"; shift 2 ;;
    --api)  API="$2";  shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Error: unknown argument $1" >&2; exit 1 ;;
  esac
done

echo "==> recipes from $API"
curl -fsS --max-time 60 "$API/recipes" -o static/recipes.eco14.json
python3 -c "import json,sys; d=json.load(open('static/recipes.eco14.json')); print(f'static/recipes.eco14.json: {len(d[\"Recipes\"])} recipes')"

echo "==> modules from $MODS"
node scripts/extract-modules.mjs --mods "$MODS"

echo "==> tags from $MODS"
python3 scripts/extract-tags.py --mods "$MODS" --out static/tags.eco14.json

echo "==> talents from $MODS"
python3 scripts/extract-talents.py --mods "$MODS" --out static/professions.eco14.json >/dev/null

echo "==> consistency check"
python3 - "$MODS" <<'PY'
import json, sys, pathlib

mods = pathlib.Path(sys.argv[1])
recipes = json.load(open('static/recipes.eco14.json'))['Recipes']
modules = json.load(open('static/modules.eco14.json'))
failures = []

# 1. Every module-capable table in the export must have an extracted allow-list.
missing = sorted({r['CraftingTable'] for r in recipes
                  if r['CraftingTableCanUseModules'] and r['CraftingTable'] not in modules['tables']})
if missing:
    failures.append(f"tables with no allow-list: {missing}")

# 2. The mods tree must be the same build as the API export. These recipes exist
#    only in the current build; their absence means the tree is the Beta (or newer).
generic = {m['slot']: m['resourceCostPercent'] for m in modules['modules'] if m['skill'] is None}
keys = {r['Key'] for r in recipes}
for key in ('Bio Gasoline', 'Dissolve Electronic Scrap', 'Reprocess Dry Tailings'):
    if key not in keys:
        failures.append(f"expected recipe {key!r} missing from the export")
if generic.get('Advanced') == 0.05 and generic.get('Modern') == 0.05:
    failures.append(f"module values look like the Eco 14 Beta ({mods}); expected Advanced -10%, Modern -15%")

if failures:
    for f in failures:
        print(f"  FAIL: {f}")
    sys.exit(1)
print(f"  ok — generic modules: " + ", ".join(f"{s} -{p*100:.0f}%" for s, p in sorted(generic.items())))
PY

echo "Done."
