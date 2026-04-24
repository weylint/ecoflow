import type { PlannerGraph, PlannerNode, ItemPlannerNode, TablePlannerNode, RawPlannerNode, MarketPlannerNode, TagPlannerNode, LayoutOptions } from './types.js';
import { DEFAULT_LAYOUT_OPTIONS } from './types.js';
import type { Node, Edge } from '@xyflow/svelte';
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

interface EdgeLabelData {
  tooltip?: string;
}

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 140;
const GROUP_PADDING = { top: 40, right: 20, bottom: 20, left: 20 };
const EDGE_LABEL_INLINE_LIMIT = 2;

function elkNodeId(id: string): string {
  // ELK needs IDs without special characters in some cases; we encode them
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const LABEL_STYLE = 'color: #ffffff; background: #2563eb; font-size: 11px; font-weight: 500; border-radius: 4px; padding: 2px 6px;';

function labeledEdge(id: string, source: string, target: string, label: string, tooltip?: string): Edge<Record<string, unknown>, 'labeledEdge'> {
  return {
    id,
    source,
    target,
    type: 'labeledEdge',
    label,
    labelStyle: LABEL_STYLE,
    data: tooltip ? { tooltip } : undefined,
  };
}

function formatTransferList(entries: { itemName: string; amount: number }[], maxInline = EDGE_LABEL_INLINE_LIMIT): { label: string; tooltip?: string } {
  const formatted = entries
    .filter(entry => entry.amount > 0)
    .map(entry => `${entry.itemName} ×${fmt(entry.amount)}`);

  if (formatted.length === 0) {
    return { label: '' };
  }

  if (formatted.length <= maxInline) {
    return { label: formatted.join(', ') };
  }

  return {
    label: `${formatted.slice(0, maxInline).join(', ')} +${formatted.length - maxInline} more`,
    tooltip: formatted.join('\n')
  };
}

export async function buildFlowGraph(
  plannerGraph: PlannerGraph,
  groupByProfession = false,
  layoutOptions: LayoutOptions = DEFAULT_LAYOUT_OPTIONS
): Promise<FlowGraph> {
  if (plannerGraph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // ── Index item and table nodes for edge-label conversion ───────────
  const itemNodes = new Map<string, ItemPlannerNode>();
  const tableNodes = new Map<string, TablePlannerNode>();
  const rawNodes = new Map<string, RawPlannerNode>();
  const marketNodes = new Map<string, MarketPlannerNode>();
  const tagNodes = new Map<string, TagPlannerNode>();
  for (const n of plannerGraph.nodes) {
    if (n.type === 'item') itemNodes.set(n.id, n as ItemPlannerNode);
    if (n.type === 'table') tableNodes.set(n.id, n as TablePlannerNode);
    if (n.type === 'raw') rawNodes.set(n.id, n as RawPlannerNode);
    if (n.type === 'market') marketNodes.set(n.id, n as MarketPlannerNode);
    if (n.type === 'tag') tagNodes.set(n.id, n as TagPlannerNode);
  }

  // ── Build replacement edges for item nodes ─────────────────────────
  // item nodes sit between two other nodes → merge into one labeled edge.
  const itemIn  = new Map<string, string[]>(); // itemId → [sourceIds]
  const itemOut = new Map<string, string[]>(); // itemId → [targetIds]

  for (const edge of plannerGraph.edges) {
    if (itemNodes.has(edge.target)) {
      if (!itemIn.has(edge.target)) itemIn.set(edge.target, []);
      itemIn.get(edge.target)!.push(edge.source);
    }
    if (itemNodes.has(edge.source)) {
      if (!itemOut.has(edge.source)) itemOut.set(edge.source, []);
      itemOut.get(edge.source)!.push(edge.target);
    }
  }

  // Pre-compute total consumer amounts per item node, used as % denominator.
  // Sums Pass-2 net-cycle amounts so the denominator matches the numerators exactly.
  const itemConsumerTotal = new Map<string, number>();
  for (const [itemId, item] of itemNodes) {
    const targets = itemOut.get(itemId) ?? [];
    let total = 0;
    for (const tgt of targets) {
      const tgtTable = tableNodes.get(tgt);
      if (tgtTable) {
        const ing = tgtTable.variant.Ingredients.find(i => i.Name === item.itemName);
        if (ing) {
          const perCycle = ing.IsStatic ? ing.Ammount : ing.Ammount * (1 - tgtTable.effectiveReduction);
          total += perCycle * tgtTable.cycles;
        }
      }
    }
    if (total > 0) itemConsumerTotal.set(itemId, total);
  }

  const directConsumerTotal = new Map<string, number>();
  for (const [nodeId, raw] of rawNodes) {
    const targets = plannerGraph.edges.filter(e => e.source === nodeId).map(e => e.target);
    let total = 0;
    for (const tgt of targets) {
      const tgtTable = tableNodes.get(tgt);
      if (!tgtTable) continue;
      const ing = tgtTable.variant.Ingredients.find(i => i.IsSpecificItem && i.Name === raw.itemName);
      if (!ing) continue;
      const perCycle = ing.IsStatic ? ing.Ammount : ing.Ammount * (1 - tgtTable.effectiveReduction);
      total += perCycle * tgtTable.cycles;
    }
    if (total > 0) directConsumerTotal.set(nodeId, total);
  }
  for (const [nodeId, market] of marketNodes) {
    const targets = plannerGraph.edges.filter(e => e.source === nodeId).map(e => e.target);
    let total = 0;
    for (const tgt of targets) {
      const tgtTable = tableNodes.get(tgt);
      if (!tgtTable) continue;
      const ing = tgtTable.variant.Ingredients.find(i => i.IsSpecificItem && i.Name === market.itemName);
      if (!ing) continue;
      const perCycle = ing.IsStatic ? ing.Ammount : ing.Ammount * (1 - tgtTable.effectiveReduction);
      total += perCycle * tgtTable.cycles;
    }
    if (total > 0) directConsumerTotal.set(nodeId, total);
  }

  const tagConsumerTotal = new Map<string, number>();
  for (const [nodeId, tagNode] of tagNodes) {
    const targets = plannerGraph.edges.filter(e => e.source === nodeId).map(e => e.target);
    let total = 0;
    for (const tgt of targets) {
      const tgtTable = tableNodes.get(tgt);
      if (!tgtTable) continue;
      const ing = tgtTable.variant.Ingredients.find(i => !i.IsSpecificItem && i.Tag === tagNode.tag);
      if (!ing) continue;
      const perCycle = ing.IsStatic ? ing.Ammount : ing.Ammount * (1 - tgtTable.effectiveReduction);
      total += perCycle * tgtTable.cycles;
    }
    if (total > 0) tagConsumerTotal.set(nodeId, total);
  }

  const tagEdgeLabels = new Map<string, { label: string; tooltip?: string }>();
  for (const [nodeId, tagNode] of tagNodes) {
    const targets = plannerGraph.edges.filter(e => e.source === nodeId).map(e => e.target);
    if (targets.length === 0) continue;

    const remainingSupply = [
      ...(tagNode.byproductContributors ?? []).map(contributor => ({
        itemName: contributor.itemName,
        remaining: contributor.contribution,
      })),
      ...(tagNode.selectedItem && tagNode.amount > 0
        ? [{ itemName: tagNode.selectedItem, remaining: tagNode.amount }]
        : []),
    ];

    for (const tgt of targets) {
      const tgtTable = tableNodes.get(tgt);
      if (!tgtTable) continue;

      const ing = tgtTable.variant.Ingredients.find(i => !i.IsSpecificItem && i.Tag === tagNode.tag);
      if (!ing) continue;

      let remainingNeed = (ing.IsStatic ? ing.Ammount : ing.Ammount * (1 - tgtTable.effectiveReduction)) * tgtTable.cycles;
      const allocations: { itemName: string; amount: number }[] = [];

      for (const supply of remainingSupply) {
        if (remainingNeed <= 0) break;
        if (supply.remaining <= 0) continue;

        const used = Math.min(supply.remaining, remainingNeed);
        allocations.push({ itemName: supply.itemName, amount: used });
        supply.remaining -= used;
        remainingNeed -= used;
      }

      if (allocations.length === 0) continue;

      const total = tagConsumerTotal.get(nodeId) ?? 0;
      const allocatedTotal = allocations.reduce((sum, entry) => sum + entry.amount, 0);
      const transfer = formatTransferList(allocations);
      const pctSuffix = total > 0 ? ` (${Math.round(allocatedTotal / total * 100)}%)` : '';
      tagEdgeLabels.set(`${nodeId}->${tgt}`, {
        label: `${transfer.label}${pctSuffix}`,
        tooltip: transfer.tooltip,
      });
    }
  }

  // Only mark edges for skipping after confirming the item node will be converted
  // (safety: nodes with no connection on either side fall back to staying as nodes)
  const skipEdgeIds = new Set<string>();
  const skipNodeIds = new Set<string>();
  const syntheticEdges: Edge[] = [];

  for (const [itemId, item] of itemNodes) {
    const sources = itemIn.get(itemId)  ?? [];
    const targets = itemOut.get(itemId) ?? [];

    if (sources.length === 0 || targets.length === 0) continue;

    skipNodeIds.add(itemId);
    for (const edge of plannerGraph.edges) {
      if (edge.source === itemId || edge.target === itemId) skipEdgeIds.add(edge.id);
    }

    // Fallback label using the item's total net amount (used for non-table targets)
    let totalLabel: string;
    if (item.amount === 0) {
      totalLabel = `${item.itemName} · ✓`;
    } else {
      totalLabel = `${item.itemName} · ×${fmt(item.amount)}`;
      if (item.byproductSupply) totalLabel += ` (+${fmt(item.byproductSupply)} bp)`;
    }

    for (const src of sources) {
      for (const tgt of targets) {
        let edgeLabel = totalLabel;
        const tgtTable = tableNodes.get(tgt);
        if (tgtTable) {
          const ing = tgtTable.variant.Ingredients.find(i => i.Name === item.itemName);
          if (ing) {
            const perCycle = ing.IsStatic
              ? ing.Ammount
              : ing.Ammount * (1 - tgtTable.effectiveReduction);
            const amt = perCycle * tgtTable.cycles;
            const itemTotal = itemConsumerTotal.get(itemId) ?? 0;
            if (itemTotal > 0) {
              const pct = Math.round(amt / itemTotal * 100);
              edgeLabel = `${item.itemName} · ×${fmt(amt)} (${pct}%)`;
            } else {
              edgeLabel = `${item.itemName} · ×${fmt(amt)}`;
            }
          }
        }
        syntheticEdges.push(labeledEdge(`lbl:${src}→${itemId}→${tgt}`, src, tgt, edgeLabel));
      }
    }
  }

  const plainEdges: Edge[] = plannerGraph.edges
    .filter(e => !skipEdgeIds.has(e.id))
    .map(e => {
      const tgtTable = tableNodes.get(e.target);
      const rawNode = rawNodes.get(e.source);
      const marketNode = marketNodes.get(e.source);

      if (tgtTable && (rawNode || marketNode)) {
        const itemName = rawNode?.itemName ?? marketNode?.itemName ?? '';
        const ing = tgtTable.variant.Ingredients.find(i => i.IsSpecificItem && i.Name === itemName);
        if (ing) {
          const perCycle = ing.IsStatic ? ing.Ammount : ing.Ammount * (1 - tgtTable.effectiveReduction);
          const amt = perCycle * tgtTable.cycles;
          const total = directConsumerTotal.get(e.source) ?? 0;
          if (total > 0) {
            const pct = Math.round(amt / total * 100);
            return labeledEdge(e.id, e.source, e.target, `${itemName} · ×${fmt(amt)} (${pct}%)`);
          }
          return labeledEdge(e.id, e.source, e.target, `${itemName} · ×${fmt(amt)}`);
        }
      }

      const tagNode = tagNodes.get(e.source);
      if (tgtTable && tagNode) {
        const transfer = tagEdgeLabels.get(`${e.source}->${e.target}`);
        if (transfer) {
          return labeledEdge(e.id, e.source, e.target, transfer.label, transfer.tooltip);
        }
      }

      return { id: e.id, source: e.source, target: e.target, type: 'default' } as Edge;
    });

  // ── ELK layout ─────────────────────────────────────────────────────
  const layoutNodes = plannerGraph.nodes.filter(n => !skipNodeIds.has(n.id));

  const idMap = new Map<string, string>();
  const reverseIdMap = new Map<string, string>();

  for (const node of layoutNodes) {
    const safe = elkNodeId(node.id);
    idMap.set(node.id, safe);
    reverseIdMap.set(safe, node.id);
  }

  // ── Build skill groups (only when groupByProfession is enabled) ────
  const skillGroups = new Map<string, string[]>();
  const groupELKIdToSkill = new Map<string, string>();

  if (groupByProfession) {
    const tableLayoutNodes = layoutNodes.filter(n => n.type === 'table') as TablePlannerNode[];
    for (const t of tableLayoutNodes) {
      const skill = t.recipe?.SkillNeeds?.[0]?.Skill ?? 'No Skill Required';
      if (!skillGroups.has(skill)) skillGroups.set(skill, []);
      skillGroups.get(skill)!.push(t.id);
    }
    for (const [skill] of skillGroups) {
      groupELKIdToSkill.set(elkNodeId(`group:${skill}`), skill);
    }
  }

  const tableNodeIds = new Set(Array.from(skillGroups.values()).flat());

  // ── Build ELK children ─────────────────────────────────────────────
  const elkGroupNodes = Array.from(skillGroups.entries()).map(([skill, ids]) => ({
    id: elkNodeId(`group:${skill}`),
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': layoutOptions.direction,
      'elk.padding': `[top=${GROUP_PADDING.top},right=${GROUP_PADDING.right},bottom=${GROUP_PADDING.bottom},left=${GROUP_PADDING.left}]`,
      'elk.layered.thoroughness': String(layoutOptions.thoroughness),
      'elk.layered.nodePlacement.strategy': layoutOptions.nodePlacement,
    },
    children: ids.map(id => ({
      id: idMap.get(id)!,
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    }))
  }));

  const elkFlatNodes = layoutNodes
    .filter(n => !tableNodeIds.has(n.id))
    .map(n => ({
      id: idMap.get(n.id)!,
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    }));

  // Feed all edges (plain + synthetic) to ELK so it knows the connections
  const allEdgesForElk = [
    ...plainEdges,
    ...syntheticEdges,
  ];

  const elkEdges = allEdgesForElk
    .filter(e => idMap.has(e.source) && idMap.has(e.target))
    .map(e => ({
      id: elkNodeId(e.id),
      sources: [idMap.get(e.source)!],
      targets: [idMap.get(e.target)!]
    }));

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': layoutOptions.direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40',
      'elk.layered.thoroughness': String(layoutOptions.thoroughness),
      'elk.layered.nodePlacement.strategy': layoutOptions.nodePlacement,
    },
    children: [...elkFlatNodes, ...elkGroupNodes],
    edges: elkEdges
  };

  const posMap = new Map<string, { x: number; y: number }>();
  // group skill → { x, y, width, height } for SvelteFlow group nodes
  const groupLayout = new Map<string, { x: number; y: number; width: number; height: number }>();

  try {
    const layouted = await elk.layout(graph);
    for (const child of layouted.children ?? []) {
      const skill = groupELKIdToSkill.get(child.id);
      if (skill) {
        // compound node: record group layout and recurse into children
        groupLayout.set(skill, {
          x: child.x ?? 0,
          y: child.y ?? 0,
          width: child.width ?? NODE_WIDTH,
          height: child.height ?? NODE_HEIGHT
        });
        for (const grandchild of child.children ?? []) {
          const originalId = reverseIdMap.get(grandchild.id);
          if (originalId) {
            posMap.set(originalId, { x: grandchild.x ?? 0, y: grandchild.y ?? 0 });
          }
        }
      } else {
        const originalId = reverseIdMap.get(child.id);
        if (originalId) {
          posMap.set(originalId, { x: child.x ?? 0, y: child.y ?? 0 });
        }
      }
    }
  } catch {
    // Fallback: simple grid layout, no grouping
    layoutNodes.forEach((n, i) => {
      posMap.set(n.id, { x: (i % 5) * 280, y: Math.floor(i / 5) * 180 });
    });
  }

  // Build SvelteFlow group nodes for each skill
  const groupNodes: Node[] = [];
  for (const [skill, layout] of groupLayout) {
    groupNodes.push({
      id: `group:${skill}`,
      type: 'professionGroup',
      position: { x: layout.x, y: layout.y },
      style: `width: ${layout.width}px; height: ${layout.height}px;`,
      data: { skill } as unknown as Record<string, unknown>,
      zIndex: -1
    });
  }

  // Build the set of table node IDs → their skill group, for parentId assignment
  const tableToSkill = new Map<string, string>();
  for (const [skill, ids] of skillGroups) {
    for (const id of ids) tableToSkill.set(id, skill);
  }

  const nodes: Node[] = [
    ...groupNodes,
    ...layoutNodes.map(n => {
      const skill = tableToSkill.get(n.id);
      const base: Node = {
        id: n.id,
        type: plannerNodeType(n),
        position: posMap.get(n.id) ?? { x: 0, y: 0 },
        data: n as unknown as Record<string, unknown>
      };
      if (skill && groupLayout.has(skill)) {
        base.parentId = `group:${skill}`;
        base.extent = 'parent';
      }
      return base;
    })
  ];

  return { nodes, edges: [...plainEdges, ...syntheticEdges] };
}

function plannerNodeType(node: PlannerNode): string {
  switch (node.type) {
    case 'table':     return 'tableNode';
    case 'item':      return 'itemNode';   // fallback, normally converted to edge labels
    case 'raw':       return 'rawNode';
    case 'tag':       return 'tagNode';
    case 'market':    return 'marketNode';
    case 'byproduct': return 'byproductNode';
  }
}
