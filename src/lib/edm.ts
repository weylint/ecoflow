import type { PlannerGraph, PlannerNode, RawPlannerNode, TablePlannerNode, MarketPlannerNode, TagPlannerNode } from './types.js';
import { EDM_MARKUP_EXCLUDED_RECIPES } from './types.js';
import type { AppSettings } from './settings.js';
import type { TagsIndex } from './tagsIndex.js';

export interface RawCost {
  itemName: string;
  amount: number;
  edmPerUnit: number | null;
  totalEdm: number | null;
}

export interface TablePathEntry {
  kind: 'table';
  depth: number;
  tableName: string;
  itemName: string;
  profession: string;
  neededAmount: number;
  subtreeEdm: number | null;
  cycles: number;
  outputAmount: number;
  markupApplied: boolean;
}

export interface LeafPathEntry {
  kind: 'leaf';
  depth: number;
  itemName: string;
  nodeType: 'raw' | 'market';
  amount: number;
  edmPerUnit: number | null;
  totalEdm: number | null;
}

export type TransitionPathEntry = TablePathEntry | LeafPathEntry;

export interface CrossProfTransition {
  fromProf: string;
  toProf: string;
  itemName: string;
  baseEdm: number | null;
  markupAmount: number | null;
  pathEntries: TransitionPathEntry[];
}

export interface EdmReport {
  rawCosts: RawCost[];
  crossProfTransitions: CrossProfTransition[];
  baseEdm: number | null;
  markupEdm: number | null;
  totalEdm: number | null;
  missingItems: string[];
}

export function resolveItemEdmValue(
  itemName: string,
  settings: AppSettings,
  tagsIndex: TagsIndex
): number | null {
  if (settings.edmValues[itemName] !== undefined) return settings.edmValues[itemName];
  for (const tag of tagsIndex.itemToTags.get(itemName) ?? []) {
    if (settings.edmTagDefaults[tag] !== undefined) return settings.edmTagDefaults[tag];
  }
  return null;
}

export function computeEdmReport(graph: PlannerGraph, settings: AppSettings, tagsIndex: TagsIndex): EdmReport {
  const itemNodeId = (name: string) => `item:${name}`;
  const tagNodeId = (tag: string) => `tag:${tag}`;
  const nodeMap = new Map<string, PlannerNode>(graph.nodes.map(n => [n.id, n]));

  // edgesByTarget[targetId] = [sourceIds] — i.e. what feeds into targetId
  const edgesByTarget = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const arr = edgesByTarget.get(edge.target) ?? [];
    arr.push(edge.source);
    edgesByTarget.set(edge.target, arr);
  }

  // For each item/tag node, which table produces it (source of table→item edge)
  const producerTableOf = new Map<string, TablePlannerNode>();
  for (const edge of graph.edges) {
    if (edge.source.startsWith('table:')) {
      const tableNode = nodeMap.get(edge.source);
      if (tableNode?.type === 'table') {
        producerTableOf.set(edge.target, tableNode as TablePlannerNode);
      }
    }
  }

  const crossProfTransitions: CrossProfTransition[] = [];
  const memoized = new Map<string, number | null>();

  // Resolve the producing table through item/tag/byproduct intermediate nodes.
  // producerTableOf only contains direct table→node edges; this walks further back
  // through item→tag chains so tag-based transitions are detected correctly.
  function resolveProducerTable(nodeId: string, seen = new Set<string>()): TablePlannerNode | undefined {
    if (seen.has(nodeId)) return undefined;
    seen.add(nodeId);
    const direct = producerTableOf.get(nodeId);
    if (direct) return direct;
    for (const sourceId of edgesByTarget.get(nodeId) ?? []) {
      const sourceNode = nodeMap.get(sourceId);
      if (sourceNode?.type === 'table') return sourceNode as TablePlannerNode;
      const indirect = resolveProducerTable(sourceId, seen);
      if (indirect) return indirect;
    }
    return undefined;
  }

  const isSpecializedSkill = (skill: string, level: number) =>
    skill !== '' && skill !== 'Self Improvement' && level > 0;

  interface LocalPathResult {
    entries: TransitionPathEntry[];
    subtreeEdm: number | null;
  }

  // Build a branch-local path for the detail pane. This intentionally avoids
  // graph-global node amounts so shared ingredients show the amount used by this
  // branch, not the total amount used elsewhere in the plan.
  function buildLocalPath(
    nodeId: string,
    neededAmount: number,
    depth: number,
    consumerCtx: { prof: string; level: number; recipeKey: string } | null = null,
    visited = new Set<string>()
  ): LocalPathResult {
    const visitKey = `${nodeId}:${neededAmount.toFixed(6)}`;
    if (visited.has(visitKey)) return { entries: [], subtreeEdm: 0 };
    visited.add(visitKey);

    const node = nodeMap.get(nodeId);
    if (!node) return { entries: [], subtreeEdm: 0 };

    if (node.type === 'raw') {
      const rawNode = node as RawPlannerNode;
      const edmPerUnit = resolveItemEdmValue(rawNode.itemName, settings, tagsIndex);
      const totalEdm = edmPerUnit !== null ? neededAmount * edmPerUnit : null;
      return {
        entries: [{
          kind: 'leaf',
          depth,
          itemName: rawNode.itemName,
          nodeType: 'raw',
          amount: neededAmount,
          edmPerUnit,
          totalEdm,
        }],
        subtreeEdm: totalEdm,
      };
    }

    if (node.type === 'market') {
      const marketNode = node as MarketPlannerNode;
      const edmPerUnit = resolveItemEdmValue(marketNode.itemName, settings, tagsIndex);
      const totalEdm = edmPerUnit !== null ? neededAmount * edmPerUnit : null;
      return {
        entries: [{
          kind: 'leaf',
          depth,
          itemName: marketNode.itemName,
          nodeType: 'market',
          amount: neededAmount,
          edmPerUnit,
          totalEdm,
        }],
        subtreeEdm: totalEdm,
      };
    }

    if (node.type === 'table') {
      const tableNode = node as TablePlannerNode;
      const profession = tableNode.recipe.SkillNeeds[0]?.Skill ?? '';
      const level = tableNode.recipe.SkillNeeds[0]?.Level ?? 0;
      const primaryOutputPerCycle = tableNode.variant.Products.find(p => p.Name === tableNode.itemName)?.Ammount ?? 1;
      const cycles = Math.ceil(neededAmount / primaryOutputPerCycle);
      const outputAmount = cycles * primaryOutputPerCycle;

      const markupApplied = consumerCtx !== null &&
        !EDM_MARKUP_EXCLUDED_RECIPES.has(consumerCtx.recipeKey) &&
        isSpecializedSkill(consumerCtx.prof, consumerCtx.level) &&
        isSpecializedSkill(profession, level) &&
        profession !== consumerCtx.prof;

      const childEntries: TransitionPathEntry[] = [];
      let total: number | null = 0;
      const myCtx = { prof: profession, level, recipeKey: tableNode.recipe.Key };

      for (const ingredient of tableNode.variant.Ingredients) {
        const ingredientNeeded = (ingredient.IsStatic
          ? ingredient.Ammount
          : ingredient.Ammount * (1 - tableNode.effectiveReduction)) * cycles;

        const inputId = ingredient.IsSpecificItem
          ? itemNodeId(ingredient.Name)
          : tagNodeId(ingredient.Tag as string);

        let child: LocalPathResult;
        if (ingredient.IsSpecificItem) {
          child = buildLocalPath(inputId, ingredientNeeded, depth + 1, myCtx, visited);
        } else {
          const tagNode = nodeMap.get(inputId);
          if (tagNode?.type === 'tag' && (tagNode as TagPlannerNode).selectedItem) {
            child = buildLocalPath(
              itemNodeId((tagNode as TagPlannerNode).selectedItem as string),
              ingredientNeeded,
              depth + 1,
              myCtx,
              visited
            );
          } else {
            child = buildLocalPath(inputId, ingredientNeeded, depth + 1, myCtx, visited);
          }
        }

        childEntries.push(...child.entries);

        const producerTable = resolveProducerTable(inputId);
        const producerProf = producerTable?.recipe.SkillNeeds[0]?.Skill ?? '';
        const producerLevel = producerTable?.recipe.SkillNeeds[0]?.Level ?? 0;
        const profChanged =
          !EDM_MARKUP_EXCLUDED_RECIPES.has(tableNode.recipe.Key) &&
          isSpecializedSkill(profession, level) &&
          isSpecializedSkill(producerProf, producerLevel) &&
          producerProf !== profession;
        const markup = profChanged ? settings.crossProfessionMarkup : 0;

        if (child.subtreeEdm === null) {
          total = null;
        } else if (total !== null) {
          total += child.subtreeEdm * (1 + markup);
        }
      }

      const entry: TablePathEntry = {
        kind: 'table',
        depth,
        tableName: tableNode.table,
        itemName: tableNode.itemName,
        profession,
        neededAmount,
        subtreeEdm: total,
        cycles,
        outputAmount,
        markupApplied,
      };

      return { entries: [entry, ...childEntries], subtreeEdm: total };
    }

    const producer = producerTableOf.get(nodeId);
    if (producer) {
      return buildLocalPath(producer.id, neededAmount, depth, consumerCtx, visited);
    }

    let total: number | null = 0;
    const entries: TransitionPathEntry[] = [];
    for (const sourceId of edgesByTarget.get(nodeId) ?? []) {
      const child = buildLocalPath(sourceId, neededAmount, depth, consumerCtx, visited);
      entries.push(...child.entries);
      if (child.subtreeEdm === null) {
        total = null;
      } else if (total !== null) {
        total += child.subtreeEdm;
      }
    }
    return { entries, subtreeEdm: total };
  }
  // Tracks nodes currently being computed — used to detect cycles.
  // When a cycle is detected, we return 0 instead of null to avoid
  // false "missing" markers on transitions (e.g. Plastic→Petroleum→Barrel→Plastic).
  const computing = new Set<string>();

  function subtreeEdm(nodeId: string): number | null {
    if (memoized.has(nodeId)) return memoized.get(nodeId) as number | null;
    if (computing.has(nodeId)) return 0;
    computing.add(nodeId);

    const node = nodeMap.get(nodeId);
    let result: number | null;

    if (!node) {
      result = 0;

    } else if (node.type === 'raw') {
      const perUnit = resolveItemEdmValue((node as RawPlannerNode).itemName, settings, tagsIndex);
      result = perUnit !== null ? (node as RawPlannerNode).amount * perUnit : null;

    } else if (node.type === 'market') {
      // Market items are bought/gathered: treat exactly like raw nodes for EDM
      const marketNode = node as MarketPlannerNode;
      const perUnit = resolveItemEdmValue(marketNode.itemName, settings, tagsIndex);
      result = perUnit !== null ? marketNode.amount * perUnit : null;

    } else if (node.type === 'table') {
      const tableNode = node as TablePlannerNode;
      const myProf = tableNode.recipe.SkillNeeds[0]?.Skill ?? '';
      const myLevel = tableNode.recipe.SkillNeeds[0]?.Level ?? 0;
      let total: number | null = 0;

      for (const ingredient of tableNode.variant.Ingredients) {
        const inputId = ingredient.IsSpecificItem
          ? itemNodeId(ingredient.Name)
          : tagNodeId(ingredient.Tag as string);
        const ingredientTotal = (ingredient.IsStatic
          ? ingredient.Ammount
          : ingredient.Ammount * (1 - tableNode.effectiveReduction)) * tableNode.cycles;
        const inputEdm = subtreeEdm(inputId);
        const producerTable = resolveProducerTable(inputId);
        const producerProf = producerTable?.recipe.SkillNeeds[0]?.Skill ?? '';
        const producerLevel = producerTable?.recipe.SkillNeeds[0]?.Level ?? 0;
        const profChanged =
          !EDM_MARKUP_EXCLUDED_RECIPES.has(tableNode.recipe.Key) &&
          isSpecializedSkill(myProf, myLevel) &&
          isSpecializedSkill(producerProf, producerLevel) &&
          producerProf !== myProf;
        const markup = profChanged ? settings.crossProfessionMarkup : 0;

        if (profChanged && producerTable) {
          const localPath = buildLocalPath(producerTable.id, ingredientTotal, 0);
          const baseEdm = localPath.subtreeEdm;
          const markupAmount = baseEdm !== null ? baseEdm * markup : null;
          const exists = crossProfTransitions.some(
            t => t.fromProf === producerProf && t.toProf === myProf && t.itemName === inputId.replace(/^(item:|tag:)/, '')
          );
          if (!exists) {
            crossProfTransitions.push({
              fromProf: producerProf,
              toProf: myProf,
              itemName: inputId.replace(/^(item:|tag:)/, ''),
              baseEdm,
              markupAmount,
              pathEntries: localPath.entries,
            });
          }
        }

        if (inputEdm === null) {
          total = null;
        } else if (total !== null) {
          total += inputEdm * (1 + markup);
        }
      }
      result = total;

    } else {
      // item / tag / byproduct — pass through to producer table if directly known,
      // otherwise sum up EDM from all incoming sources (handles tag→item chains)
      const producer = producerTableOf.get(nodeId);
      if (producer) {
        result = subtreeEdm(producer.id);
      } else {
        let total: number | null = 0;
        for (const sourceId of edgesByTarget.get(nodeId) ?? []) {
          const edm = subtreeEdm(sourceId);
          if (edm === null) { total = null; }
          else if (total !== null) { total += edm; }
        }
        result = total;
      }
    }

    computing.delete(nodeId);
    memoized.set(nodeId, result);
    return result;
  }

  // Raw + market costs
  const rawNodes = graph.nodes.filter((n): n is RawPlannerNode => n.type === 'raw');
  const marketNodes = graph.nodes.filter((n): n is MarketPlannerNode => n.type === 'market');
  const rawCosts: RawCost[] = [
    ...rawNodes.map(n => {
      const edmPerUnit = resolveItemEdmValue(n.itemName, settings, tagsIndex);
      return { itemName: n.itemName, amount: n.amount, edmPerUnit, totalEdm: edmPerUnit !== null ? n.amount * edmPerUnit : null };
    }),
    ...marketNodes.map(n => {
      const edmPerUnit = resolveItemEdmValue(n.itemName, settings, tagsIndex);
      return { itemName: n.itemName, amount: n.amount, edmPerUnit, totalEdm: edmPerUnit !== null ? n.amount * edmPerUnit : null };
    }),
  ];

  const missingItems = rawCosts.filter(r => r.edmPerUnit === null).map(r => r.itemName);

  const baseEdm = missingItems.length === 0
    ? rawCosts.reduce((sum, r) => sum + (r.totalEdm ?? 0), 0)
    : null;

  // Trigger subtree computation to populate crossProfTransitions
  for (const node of graph.nodes) {
    if (node.type === 'table') {
      subtreeEdm(node.id);
    }
  }

  const markupEdm = crossProfTransitions.every(t => t.markupAmount !== null)
    ? crossProfTransitions.reduce((sum, t) => sum + (t.markupAmount ?? 0), 0)
    : null;

  const totalEdm =
    baseEdm !== null && markupEdm !== null ? baseEdm + markupEdm : null;

  return { rawCosts, crossProfTransitions, baseEdm, markupEdm, totalEdm, missingItems };
}
