#!/usr/bin/env python3
"""
Extract Eco talent/profession data from the game's C# sources into ecoflow's
professions JSON.

Usage:
    python3 scripts/extract-talents.py [--mods <dir>] [--out static/professions.eco14.json]

Adapted from the eco_skills extract_talents.py, with two changes:
  * the mods tree is an argument rather than a fixed symlink, so an Eco 14
    extraction can never overwrite the frozen Eco 13 reference data;
  * Mods/UserCode/Benefits/*.cs is parsed after the core files, so a server's
    profession overrides win (they are partial classes with the same names).

The GoodPrice /allTalentDefinitions endpoint is not a substitute: it returns an
empty list.
"""

DEFAULT_MODS = "/mnt/c/Games/Steam/steamapps/common/Eco/Eco_Data/Server/Mods"

import re
import sys
import json
import math
from pathlib import Path
from collections import defaultdict


def camel_to_words(name: str) -> str:
    """Convert CamelCase to space-separated words. 'AdvancedBaking' -> 'Advanced Baking'"""
    return re.sub(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', name)


def skill_class_to_name(skill_class: str) -> str:
    """'AdvancedBakingSkill' -> 'Advanced Baking'"""
    name = re.sub(r'Skill$', '', skill_class)
    return camel_to_words(name)


def profession_from_filename(filename: str) -> str:
    """'ChiefProfession.cs' -> 'Chef'"""
    stem = Path(filename).stem
    name = re.sub(r'Profession$', '', stem)
    return camel_to_words(name)


# Matches TalentGroups with [LocDisplayName] and [LocDescription] attributes.
TALENT_GROUP_PATTERN = re.compile(
    r'(?:'
    r'\[LocDisplayName\("(?P<display_name>[^"]+)"\)\]\s*'
    r'(?:\[[^\]]+\]\s*)*'        # optional other attributes between
    r'\[LocDescription\("(?P<description>[^"]+)"\)\]'
    r'|'
    r'\[LocDescription\("(?P<description2>[^"]+)"\)\]\s*'
    r'(?:\[[^\]]+\]\s*)*'
    r'\[LocDisplayName\("(?P<display_name2>[^"]+)"\)\]'
    r')'
    r'(?:\s*\[[^\]]+\])*'        # remaining attributes (e.g. [Serialized])
    r'\s*public\s+partial\s+class\s+(?P<class_name>\w+)\s*:\s*TalentGroup\b'
    r'.*?'
    r'this\.OwningSkill\s*=\s*typeof\((?P<owning_skill>\w+)\)\s*;'
    r'.*?'
    r'this\.Level\s*=\s*(?P<level>\d+)\s*;',
    re.DOTALL,
)

# Fallback: TalentGroups with only [Serialized], name/description from preceding comment:
#   // Level 3 - Seed Sorting: 20% faster seed crafting
UNATTRIBUTED_PATTERN = re.compile(
    r'//\s*Level\s*\d+\s*-\s*(?P<comment_name>[^:\n]+):\s*(?P<comment_desc>[^\n]+)\n\s*'
    r'\[Serialized\]\s*public\s+partial\s+class\s+(?P<class_name>\w+)\s*:\s*TalentGroup\b'
    r'.*?'
    r'this\.OwningSkill\s*=\s*typeof\((?P<owning_skill>\w+)\)\s*;'
    r'.*?'
    r'this\.Level\s*=\s*(?P<level>\d+)\s*;',
    re.DOTALL,
)


CAPPED_LINE_RE = re.compile(
    r'BonusEffectCappedMultiplicative\s*\{(?=[^}]*\bValue\s*=\s*(?P<v>[0-9.]+)f)(?=[^}]*\bCap\s*=\s*(?P<c>[0-9.]+)f)'
    r'(?=[^}]*\bLowerIsBetter\s*=\s*(?P<lower>true|false))'
)

CLASS_DECL_RE = re.compile(r'public\s+(?:partial\s+)?class\s+(\w+Talent)\b')

TALENT_INHERIT_RE = re.compile(
    r'public\s+(?:partial\s+)?class\s+(\w+Talent)\s*:\s*(\w+Talent)\b'
)

TALENT_ARRAY_RE = re.compile(
    r'class\s+(\w+TalentGroup)\b.*?Talents\s*=\s*new\s+(?:System\.)?Type\[\]\s*\{[^}]*typeof\((\w+Talent)\)',
    re.DOTALL,
)

# Matches a plain multiplicative effect line (no cap).
MULTIPLICATIVE_RE = re.compile(
    r'new BonusEffectMultiplicative\s*\{[^}]*Value\s*=\s*(?P<v>[0-9.]+)f'
    r'(?:[^}]*LowerIsBetter\s*=\s*(?P<lower>true|false))?'
)
# Matches the ResourceCost action in a Causes block on a single line.
BONUS_ACTION_RE = re.compile(r'Action\s*=\s*BonusAction\.(\w+)')
BONUS_RECIPE_RE = re.compile(r'typeof\((\w+)Recipe\)')
OVERRIDE_RE     = re.compile(r'new BonusEffectOverride\s*\{[^}]*Value\s*=\s*([0-9.]+)f')
ITEM_TAGS_RE    = re.compile(r'ItemTags\s*=\s*new\s+HashSet<string>\s*\{([^}]+)\}')
ADDITIVE_RE     = re.compile(r'new BonusEffectAdditive\s*\{[^}]*Value\s*=\s*([0-9.]+)f')


ACTION_LABELS: dict[str, str] = {
    'ResourceCost': 'resource cost',
    'LaborCost':    'labor cost',
    'CraftTime':    'craft time',
    'Pollution':    'pollution',
    'Yield':        'yield',
    'Power':        'power usage',
}


def recipe_type_to_display(raw: str) -> str:
    """'CorrugatedSteel' (from CorrugatedSteelRecipe) -> 'Corrugated Steel'"""
    return camel_to_words(raw)


def craft_station_to_display(raw: str) -> str:
    """'SawmillObject' -> 'Sawmill'"""
    return camel_to_words(re.sub(r'Object$', '', raw))


def _pct(v: float) -> str:
    """Format a multiplier as a signed percentage string: 0.925 -> '-7.5%', 1.2 -> '+20%'."""
    p = (v - 1.0) * 100.0
    sign = '+' if p >= 0 else ''
    # Avoid trailing zeros: 7.50 -> '7.5', 6.00 -> '6'
    formatted = f'{abs(p):.10g}'
    return f'{sign}{"-" if p < 0 else ""}{formatted}%'


def parse_talent_bonuses(cs_text: str) -> dict[str, list[dict]]:
    """
    For each `XxxTalent : Talent` base class in cs_text, extract ALL bonus blocks and
    return {class_name: [bonus_info, ...]} where each bonus_info is one of:

    Numeric effect:
        'effect'  : formatted string (e.g. '-7.5% resource cost')
        'penalty' : bool — True if this effect is harmful to the player
        'recipes' : list of display names (if bonus targets specific recipes)
        'skills'  : list of display names (if bonus targets skill types instead)

    Unlock:
        'unlocks' : list of recipe display names

    Bonuses with Value == 1.0 on a Multiplicative effect print a warning and are skipped.
    Other non-numeric effects (plain Override, etc.) are also skipped.
    """
    parts = re.split(
        r'(public\s+partial\s+class\s+\w+Talent\s*:\s*Talent\b)',
        cs_text,
    )
    result: dict[str, list[dict]] = {}
    i = 1
    while i < len(parts) - 1:
        decl, body = parts[i], parts[i + 1]
        class_m = re.search(r'class\s+(\w+Talent)', decl)
        if not class_m:
            i += 2
            continue
        class_name = class_m.group(1)

        bonuses: list[dict] = []
        for seg in re.split(r'this\.Bonuses\.Add\(', body)[1:]:
            end = seg.find('});')
            if end == -1:
                continue
            block = seg[:end]

            action_m     = BONUS_ACTION_RE.search(block)
            action_raw   = action_m.group(1) if action_m else ''
            action_label = ACTION_LABELS.get(action_raw, action_raw.lower())

            recipes = [recipe_type_to_display(r) for r in BONUS_RECIPE_RE.findall(block)]
            skills  = [skill_class_to_name(s) for s in re.findall(r'typeof\((\w+Skill)\)', block)]
            item_tags_m = ITEM_TAGS_RE.search(block)
            item_tags   = re.findall(r'"([^"]+)"', item_tags_m.group(1)) if item_tags_m else []
            craft_stns  = list(dict.fromkeys(
                craft_station_to_display(s)
                for s in re.findall(r'typeof\((\w+Object)\)', block)
            ))

            # --- Unlock (BonusAction.Unlock + BonusEffectOverride) ---
            if action_raw == 'Unlock' and OVERRIDE_RE.search(block) and recipes:
                bonuses.append({'unlocks': recipes})
                continue

            capped_m = CAPPED_LINE_RE.search(block)
            mult_m   = MULTIPLICATIVE_RE.search(block)

            effect_str: str | None = None
            penalty: bool | None   = None

            if capped_m:
                v, c  = float(capped_m.group('v')), float(capped_m.group('c'))
                lower = capped_m.group('lower') == 'true'
                is_benefit = (lower and v < 1.0) or (not lower and v > 1.0)
                penalty    = not is_benefit
                effect_str = f'{_pct(v)} {action_label} per take (cap: {_pct(c)})'
            elif mult_m:
                v         = float(mult_m.group('v'))
                lower_str = mult_m.group('lower')
                if v == 1.0:
                    print(f'WARNING: BonusEffectMultiplicative Value=1.0 in {class_name}',
                          file=sys.stderr)
                    continue
                if lower_str is not None:
                    lower   = lower_str == 'true'
                    penalty = (lower and v > 1.0) or (not lower and v < 1.0)
                else:
                    # No LowerIsBetter annotation — infer: reductions benefit, increases penalise
                    penalty = v > 1.0
                effect_str = f'{_pct(v)} {action_label}'
            elif additive_m := ADDITIVE_RE.search(block):
                v = float(additive_m.group(1))
                formatted  = f'{v:g}'
                effect_str = f'+{formatted} {action_label}' if v >= 0 else f'{formatted} {action_label}'
                cost_actions = {'ResourceCost', 'LaborCost', 'CraftTime', 'Power', 'Pollution'}
                penalty = (action_raw in cost_actions and v > 0) or (action_raw not in cost_actions and v < 0)

            if action_raw == 'ResourceCost' and craft_stns and not recipes and not item_tags:
                print(f'WARNING: ResourceCost via CraftStationTypes in {class_name}: {craft_stns}',
                      file=sys.stderr)

            if effect_str is not None:
                info: dict = {'effect': effect_str.strip(), 'penalty': penalty}
                if recipes:
                    info['recipes'] = recipes
                if item_tags:
                    info['item_tags'] = item_tags
                if craft_stns:
                    info['craft_stations'] = craft_stns
                if skills:
                    info['skills'] = skills
                bonuses.append(info)

        if bonuses:
            result[class_name] = bonuses
        i += 2
    return result


def parse_class_cap_info(cs_text: str) -> dict[str, int]:
    """Return {class_name: max_takes} for talent base classes with BonusEffectCappedMultiplicative."""
    result: dict[str, int] = {}
    current_class: str | None = None
    for line in cs_text.splitlines():
        m = CLASS_DECL_RE.search(line)
        if m:
            current_class = m.group(1)
        if current_class is None:
            continue
        cm = CAPPED_LINE_RE.search(line)
        if cm:
            v = float(cm.group('v'))
            c = float(cm.group('c'))
            lower = cm.group('lower') == 'true'
            # Only use beneficial effects to determine max_takes.
            # Penalty effects (e.g. gold cost increase on a copper reduction talent) must not
            # cap the take count earlier than the primary benefit does.
            is_benefit = (lower and v < 1.0) or (not lower and v > 1.0)
            if not is_benefit or v == 1.0 or c == 1.0:
                continue
            takes = min(math.floor(math.log(c) / math.log(v)), 5)
            if takes > 1:
                prev = result.get(current_class)
                result[current_class] = takes if prev is None else min(prev, takes)
    return result


def parse_talent_inheritance(cs_text: str) -> dict[str, str]:
    """Return {child_talent_class: parent_talent_class} from class declarations."""
    return {m.group(1): m.group(2) for m in TALENT_INHERIT_RE.finditer(cs_text)}


def parse_group_to_talent(cs_text: str) -> dict[str, str]:
    """Return {TalentGroupClass: TalentClass} from Talents array in TalentGroup constructors."""
    return {m.group(1): m.group(2) for m in TALENT_ARRAY_RE.finditer(cs_text)}


def resolve_max_takes(
    group_class: str | None,
    group_to_talent: dict[str, str],
    inheritance: dict[str, str],
    cap_info: dict[str, int],
) -> int:
    """Return computed max_takes for a TalentGroup, or 1 if not repeatable."""
    if group_class is None:
        return 1
    talent_class = group_to_talent.get(group_class)
    if talent_class is None:
        return 1
    visited: set[str] = set()
    current = talent_class
    while current and current not in visited:
        if current in cap_info:
            return cap_info[current]
        visited.add(current)
        current = inheritance.get(current)
    return 1


def extract_talents(cs_text: str) -> list[dict]:
    """Extract all TalentGroup entries from a C# source text."""
    seen: set[str] = set()
    talents = []

    # Pass 1: attributed TalentGroups with [LocDisplayName] and [LocDescription]
    for m in TALENT_GROUP_PATTERN.finditer(cs_text):
        class_name = m.group('class_name')
        seen.add(class_name)
        talents.append({
            'class': class_name,
            'display_name': m.group('display_name') or m.group('display_name2'),
            'description': m.group('description') or m.group('description2'),
            'level': int(m.group('level')),
            'owning_skill': m.group('owning_skill'),
        })

    # Pass 2: fallback for TalentGroups missing loc attributes, using comment metadata
    for m in UNATTRIBUTED_PATTERN.finditer(cs_text):
        class_name = m.group('class_name')
        if class_name in seen:
            continue
        skill_raw = m.group('owning_skill')
        comment_name = m.group('comment_name').strip()
        talents.append({
            'class': class_name,
            'display_name': f'{comment_name}: {skill_class_to_name(skill_raw)}',
            'description': m.group('comment_desc').strip(),
            'level': int(m.group('level')),
            'owning_skill': skill_raw,
            'uncertain': True,
        })

    return talents


def collect_all_talents(
    files: list[Path],
) -> tuple[dict[str, dict], dict[str, int], dict[str, str], dict[str, str], dict[str, dict]]:
    """Scan all given files and return (talent_pool, cap_info, inheritance, group_to_talent, primary_bonuses)."""
    pool: dict[str, dict] = {}
    cap_info: dict[str, int] = {}
    inheritance: dict[str, str] = {}
    group_to_talent: dict[str, str] = {}
    primary_bonuses: dict[str, dict] = {}
    for path in files:
        text = path.read_text(encoding='utf-8')
        for talent in extract_talents(text):
            pool[talent['class']] = talent
        cap_info.update(parse_class_cap_info(text))
        inheritance.update(parse_talent_inheritance(text))
        group_to_talent.update(parse_group_to_talent(text))
        primary_bonuses.update(parse_talent_bonuses(text))
    return pool, cap_info, inheritance, group_to_talent, primary_bonuses


# Matches class names referenced in AutoGen comment stubs inside profession files:
#   // Level 3 - Arrow Recovery (HuntingArrowRecoveryTalentGroup)
AUTOGEN_REF_PATTERN = re.compile(r'\((\w+TalentGroup)\)')
REGION_PATTERN = re.compile(r'#region\s+(\w+)')

# Matches talent description lines in section comment blocks:
#   // Level 3 - Garden Tools - Increased integrity by 20% + Increased cost by 5% per level
SECTION_TALENT_LINE_PATTERN = re.compile(
    r'//\s*Level\s*(\d+)\s*-\s*([^-\n]+?)\s*-\s*([^\n]+)'
)


def extract_section_comment_talents(cs_text: str) -> list[dict]:
    """
    For #region blocks that contain NO TalentGroup class declarations,
    scan preceding comment lines for: // Level N - TalentName - Description
    and produce synthetic (uncertain=True) talent entries.
    """
    results = []
    lines = cs_text.splitlines()

    i = 0
    while i < len(lines):
        rm = re.match(r'\s*#region\s+(\w+)', lines[i])
        if not rm:
            i += 1
            continue

        region_name = rm.group(1)
        region_start = i

        # Find the matching #endregion (depth-aware)
        depth = 1
        j = i + 1
        while j < len(lines) and depth > 0:
            if re.match(r'\s*#region\b', lines[j]):
                depth += 1
            elif re.match(r'\s*#endregion\b', lines[j]):
                depth -= 1
            j += 1
        region_end = j  # exclusive

        region_body = '\n'.join(lines[region_start:region_end])

        # Only process regions with no TalentGroup declarations
        if ': TalentGroup' not in region_body:
            skill_class = region_name + 'Skill'
            skill_display = skill_class_to_name(skill_class)

            for comment_line in lines[max(0, region_start - 20):region_start]:
                cm = SECTION_TALENT_LINE_PATTERN.search(comment_line)
                if cm:
                    talent_name = cm.group(2).strip()
                    if not talent_name:
                        continue  # skip malformed lines
                    results.append({
                        'class': None,
                        'display_name': f'{talent_name}: {skill_display}',
                        'description': cm.group(3).strip(),
                        'level': int(cm.group(1)),
                        'owning_skill': skill_class,
                        'uncertain': True,
                    })

        i += 1  # advance by one line so inner regions are processed individually

    return results


def build_skill_profession_map(
    profession_files: list[Path],
    all_talents: dict[str, dict],
    inheritance: dict[str, str] | None = None,
    group_to_talent: dict[str, str] | None = None,
) -> dict[str, str]:
    """
    Return {owning_skill_class: profession_name} by scanning each *Profession.cs for:
    - OwningSkill values from actual TalentGroups in that file
    - TalentGroup class names referenced in AutoGen comment stubs: (XxxTalentGroup)
    - #region names that match known owning skill classes: #region PaperMilling → PaperMillingSkill
    - The profession's own implied skill from the filename: SelfImprovementProfession → SelfImprovementSkill
    - Inheritance chain: AutoGen concrete Talent → base Talent defined in a profession file
    """
    known_skills = {t['owning_skill'] for t in all_talents.values()}
    skill_to_profession: dict[str, str] = {}

    # Build map: base talent class name → profession (from classes defined in profession files)
    base_talent_to_profession: dict[str, str] = {}

    for pf in profession_files:
        profession = profession_from_filename(pf)
        text = pf.read_text(encoding='utf-8')

        # From TalentGroups defined in this file
        for talent in extract_talents(text):
            skill_to_profession[talent['owning_skill']] = profession

        # From AutoGen reference comments: (XxxTalentGroup) → look up OwningSkill
        for m in AUTOGEN_REF_PATTERN.finditer(text):
            class_name = m.group(1)
            if class_name in all_talents:
                skill_to_profession[all_talents[class_name]['owning_skill']] = profession

        # From #region names: #region PaperMilling → try PaperMillingSkill
        for m in REGION_PATTERN.finditer(text):
            candidate = m.group(1) + 'Skill'
            if candidate in known_skills:
                skill_to_profession[candidate] = profession

        # From the profession filename itself: SelfImprovementProfession → SelfImprovementSkill
        stem = re.sub(r'Profession$', '', pf.stem)
        candidate = stem + 'Skill'
        if candidate in known_skills:
            skill_to_profession[candidate] = profession

        # Record all Talent base classes defined in this profession file
        for m in CLASS_DECL_RE.finditer(text):
            base_talent_to_profession[m.group(1)] = profession

    # Final strategy: walk inheritance chain from AutoGen concrete talent up to base talent
    # defined in a profession file. Resolves cases where #region names don't match skill names.
    if inheritance and group_to_talent:
        for group_class, talent in all_talents.items():
            skill = talent['owning_skill']
            if skill in skill_to_profession:
                continue
            concrete = group_to_talent.get(group_class)
            current = concrete
            visited: set[str] = set()
            while current and current not in visited:
                if current in base_talent_to_profession:
                    skill_to_profession[skill] = base_talent_to_profession[current]
                    break
                visited.add(current)
                current = inheritance.get(current)

    return skill_to_profession


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Extract Eco talents to JSON.")
    parser.add_argument("--mods", default=DEFAULT_MODS, help="Eco server Mods/ directory")
    parser.add_argument("--out", default="static/professions.eco14.json", help="output JSON path")
    opts = parser.parse_args()

    mods = Path(opts.mods)
    benefits_dir = mods / "__core__" / "Benefits"
    autogen_dir = mods / "__core__" / "AutoGen" / "Benefit"

    if not benefits_dir.exists():
        print(f"ERROR: {benefits_dir} not found", file=sys.stderr)
        sys.exit(1)

    profession_files = sorted(benefits_dir.glob('*[Pp]rofession.cs'))
    autogen_files = sorted(autogen_dir.glob('*.cs'))

    # Server overrides are partial classes reopening the core ones; parsing them
    # last lets their bonus definitions replace the core entries.
    user_benefits = mods / "UserCode" / "Benefits"
    override_files = sorted(user_benefits.glob('*.cs')) if user_benefits.exists() else []
    profession_files += [f for f in override_files if 'rofession' in f.name]
    autogen_files += [f for f in override_files if 'rofession' not in f.name]

    if not profession_files:
        print(f'No *Profession.cs files found in {benefits_dir}', file=sys.stderr)
        sys.exit(1)

    all_talents, cap_info, inheritance, group_to_talent, primary_bonuses = collect_all_talents(
        list(profession_files) + list(autogen_files)
    )

    # Add backup section-comment talents (uncertain=True) only for skills with no AutoGen entry.
    # Guard by both owning_skill and base name (before ':') to handle region names that don't
    # exactly match the skill class (e.g. '#region Butchering Talents' vs ButcherySkill).
    skills_with_talents = {t['owning_skill'] for t in all_talents.values()}
    existing_base_names = {t['display_name'].split(':')[0].strip().lower() for t in all_talents.values()}
    for pf in profession_files:
        for talent in extract_section_comment_talents(pf.read_text(encoding='utf-8')):
            base_name = talent['display_name'].split(':')[0].strip().lower()
            if talent['owning_skill'] in skills_with_talents or base_name in existing_base_names:
                continue
            key = f"__{talent['owning_skill']}_{talent['display_name']}"
            all_talents[key] = talent

    skill_to_profession = build_skill_profession_map(
        profession_files, all_talents, inheritance, group_to_talent
    )

    # Group talents by profession → skill (preserving insertion order)
    groups: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    for talent in all_talents.values():
        profession = skill_to_profession.get(talent['owning_skill'], 'Unknown')
        skill_name = skill_class_to_name(talent['owning_skill'])
        entry: dict = {
            'display_name': talent['display_name'],
            'description': talent['description'],
            'level': talent['level'],
        }
        if talent['class'] is not None:
            entry['class'] = talent['class']
        if talent.get('uncertain'):
            entry['uncertain'] = True
        entry['max_takes'] = resolve_max_takes(
            talent['class'], group_to_talent, inheritance, cap_info
        )
        # Attach primary bonus info (effect description + affected recipes) if available.
        # Walk the inheritance chain from the concrete AutoGen talent up to the base class
        # defined in a profession file, where the bonus implementation lives.
        group_class = talent['class']
        if group_class is not None:
            concrete = group_to_talent.get(group_class)
            current = concrete
            visited: set[str] = set()
            while current and current not in visited:
                if current in primary_bonuses:
                    entry['effects'] = primary_bonuses[current]
                    break
                visited.add(current)
                current = inheritance.get(current)
        groups[profession][skill_name].append(entry)

    # Build output ordered by profession file order
    all_professions = []
    for pf in profession_files:
        profession = profession_from_filename(pf)
        if profession not in groups:
            print(f'WARNING: no talents for profession {profession}', file=sys.stderr)
            continue
        skills = groups[profession]
        talent_count = sum(len(t) for t in skills.values())
        print(f'  {profession}: {talent_count} talents across {len(skills)} skills')
        all_professions.append({
            'profession': profession,
            'source_file': pf.name,
            'skills': [
                {'skill': skill, 'talents': talent_list}
                for skill, talent_list in skills.items()
            ],
        })

    if 'Unknown' in groups:
        unknown_count = sum(len(t) for t in groups['Unknown'].values())
        print(f'WARNING: {unknown_count} talents could not be assigned to a profession',
              file=sys.stderr)

    out_path = Path(opts.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps({'professions': all_professions}, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )
    print(f'Written {len(all_professions)} professions to {out_path}')


if __name__ == '__main__':
    main()
