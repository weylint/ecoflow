#!/usr/bin/env python3
"""
Extract item tag data from Eco game C# AutoGen sources into ecoflow's tags JSON.

Usage:
    python3 scripts/extract-tags.py [--mods <dir>] [--out static/tags.eco14.json]

Adapted from the eco_skills extract_tags.py, with two changes:
  * the mods tree is an argument rather than a fixed symlink, so Eco 13 reference
    data is never overwritten by an Eco 14 extraction;
  * Mods/UserCode is scanned after Mods/__core__ so server overrides win.

The GoodPrice /tags endpoint is NOT a substitute: it only emits tags referenced by
a recipe ingredient (47 vs 89 here) and omits Ore, which EDM tag defaults need.
"""

import re
import json
import os
from pathlib import Path
from collections import defaultdict


DEFAULT_MODS = "/mnt/c/Games/Steam/steamapps/common/Eco/Eco_Data/Server/Mods"


TAG_RE        = re.compile(r'\[Tag\("([^"]+)"\)\]')
LOC_NAME_RE   = re.compile(r'\[LocDisplayName\("([^"]+)"\)\]')
# Block-template files split the base class onto the next line, so we only match the class name here.
CLASS_ITEM_RE = re.compile(r'public\s+partial\s+class\s+(\w+Item)\b')


def camel_to_words(name: str) -> str:
    """'AdvancedCombustionEngine' -> 'Advanced Combustion Engine'"""
    return re.sub(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', name)


def parse_cs_file(path: Path) -> list[dict]:
    """Return list of {display_name, tags} for every *Item class in a .cs file."""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    results = []
    for i, line in enumerate(lines):
        m = CLASS_ITEM_RE.search(line)
        if not m:
            continue

        class_name = m.group(1)

        # Scan backward through the attribute block above this class declaration.
        tags         = []
        display_name = None
        j = i - 1
        while j >= 0:
            stripped = lines[j].strip()
            if not stripped:
                j -= 1
                continue
            # Skip XML doc comment lines and plain C-style comment lines.
            if stripped.startswith("///") or stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
                j -= 1
                continue
            if stripped.startswith("["):
                tag_m = TAG_RE.search(stripped)
                if tag_m:
                    tags.append(tag_m.group(1))
                name_m = LOC_NAME_RE.search(stripped)
                if name_m:
                    display_name = name_m.group(1)
                j -= 1
            else:
                break  # hit non-attribute code — stop scanning

        # Infer implicit tags from base class inheritance.
        # Block-template files put the base class on the line(s) after the class declaration,
        # so scan the declaration line and the next few lines.
        window = "".join(lines[i : min(i + 4, len(lines))])
        if re.search(r'\bPartItem\b', window) and "Parts" not in tags:
            tags.append("Parts")
        if re.search(r'\bSeedItem\b', window) and "Seed" not in tags:
            tags.append("Seed")
        if re.search(r'\bFoodItem\b', window) and "Food" not in tags:
            tags.append("Food")

        if display_name is None:
            display_name = camel_to_words(class_name[:-4])  # strip trailing "Item"

        if tags:
            results.append({"display_name": display_name, "tags": tags})

    return results


def collect_all_items(core_autogen_dir: Path) -> dict[str, list[str]]:
    """Walk all .cs files under core_autogen_dir and build tag -> sorted [display names]."""
    tag_map: dict[str, set[str]] = defaultdict(set)

    for root, _dirs, files in os.walk(core_autogen_dir):
        for fname in files:
            if not fname.endswith(".cs"):
                continue
            for item in parse_cs_file(Path(root) / fname):
                for tag in item["tags"]:
                    tag_map[camel_to_words(tag)].add(item["display_name"])

    return {tag: sorted(names) for tag, names in sorted(tag_map.items())}


def check_radiator_bug(tags_dict: dict[str, list[str]]) -> None:
    if "Radiator" in tags_dict.get("Parts", []):
        print(
            "WARNING: Radiator now has the 'Parts' tag — "
            "the known bug (RadiatorItem not inheriting PartItem) appears to have been fixed."
        )


def run_assertions(tags_dict: dict[str, list[str]]) -> None:
    assert "Lumber Dresser" in tags_dict.get("Housing", []), (
        "ASSERTION FAILED: 'Lumber Dresser' is missing from the 'Housing' tag"
    )
    assert "Advanced Combustion Engine" in tags_dict.get("Parts", []), (
        "ASSERTION FAILED: 'Advanced Combustion Engine' is missing from the 'Parts' tag"
    )
    print("Assertions passed: Housing contains 'Lumber Dresser', Parts contains 'Advanced Combustion Engine'.")


def compatibility_test(tags_dict: dict[str, list[str]], old_path: Path) -> None:
    """Check that every item in the old tags.json is present in the new output."""
    if not old_path.exists():
        print(f"Skipping compatibility test — {old_path} not found.")
        return

    old = json.loads(old_path.read_text(encoding="utf-8"))["Tags"]
    missing = [
        (tag, item)
        for tag, items in old.items()
        for item in items
        if item not in tags_dict.get(tag, [])
    ]

    if missing:
        print(f"Compatibility check: {len(missing)} item(s) present in old tags.json but missing from new output:")
        for tag, item in missing:
            print(f"  [{tag}] {item}")
    else:
        print("Compatibility check passed: all old tags.json entries are present in new output.")


def collect_with_overrides(mods_dir: Path) -> dict[str, list[str]]:
    """__core__ first, then UserCode: a display name redefined in UserCode replaces
    the core entry rather than merging with it."""
    core = collect_all_items(mods_dir / "__core__" / "AutoGen")
    user_root = mods_dir / "UserCode"
    if not user_root.exists():
        return core
    user = collect_all_items(user_root)
    if not user:
        return core

    overridden = {name for names in user.values() for name in names}
    merged: dict[str, set[str]] = {tag: set(names) for tag, names in core.items()}
    for tag in merged:
        merged[tag] -= overridden
    for tag, names in user.items():
        merged.setdefault(tag, set()).update(names)
    return {tag: sorted(names) for tag, names in sorted(merged.items()) if names}


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Extract Eco item tags to JSON.")
    parser.add_argument("--mods", default=DEFAULT_MODS, help="Eco server Mods/ directory")
    parser.add_argument("--out", default="static/tags.eco14.json", help="output JSON path")
    parser.add_argument("--compare", help="existing tags JSON to report coverage against")
    opts = parser.parse_args()

    mods_dir = Path(opts.mods)
    if not (mods_dir / "__core__" / "AutoGen").exists():
        raise SystemExit(f"ERROR: {mods_dir}/__core__/AutoGen not found")

    tags_dict = collect_with_overrides(mods_dir)
    check_radiator_bug(tags_dict)
    run_assertions(tags_dict)

    if opts.compare:
        compatibility_test(tags_dict, Path(opts.compare))

    out_path = Path(opts.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"Tags": tags_dict}, indent=2), encoding="utf-8")

    pairs = sum(len(v) for v in tags_dict.values())
    print(f"{out_path}: {pairs} item-tag pairs across {len(tags_dict)} tags")


if __name__ == "__main__":
    main()
