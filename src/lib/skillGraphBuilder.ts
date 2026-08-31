// Builds a SvelteFlow-renderable layout for the skill/specialty dependency
// DAG exported by `eco-graph graph --json` (see ecoflow2/crates/eco-graph).
// Deliberately independent of graphBuilder.ts / PlannerGraph: this is a much
// simpler graph (one node type, one edge type, no groups/loopbacks), just
// reusing the same ELK-layout + feedback-edge-detection approach.

import type { Node, Edge } from '@xyflow/svelte';
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

export interface SkillGraphEdgeJson {
  from: string;
  to: string;
  recipes: string[];
}

export interface SkillGraphJson {
  skills: string[];
  edges: SkillGraphEdgeJson[];
}

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 50;
const EDGE_LABEL_INLINE_LIMIT = 2;

const LABEL_STYLE =
  'color: #ffffff; background: #2563eb; font-size: 11px; font-weight: 500; border-radius: 4px; padding: 2px 6px;';
const FEEDBACK_STYLE = 'stroke: #f59e0b; stroke-width: 2; stroke-dasharray: 6 3;';

function elkNodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function edgeLabel(recipes: string[]): { label: string; tooltip?: string } {
  if (recipes.length <= EDGE_LABEL_INLINE_LIMIT) {
    return { label: recipes.join(', ') };
  }
  return {
    label: `${recipes.slice(0, EDGE_LABEL_INLINE_LIMIT).join(', ')} +${recipes.length - EDGE_LABEL_INLINE_LIMIT} more`,
    tooltip: recipes.join('\n'),
  };
}

export async function buildSkillFlowGraph(
  graph: SkillGraphJson,
  direction: 'RIGHT' | 'DOWN' = 'RIGHT'
): Promise<FlowGraph> {
  if (graph.skills.length === 0) {
    return { nodes: [], edges: [] };
  }

  const idMap = new Map<string, string>();
  const reverseIdMap = new Map<string, string>();
  for (const skill of graph.skills) {
    const safe = elkNodeId(skill);
    idMap.set(skill, safe);
    reverseIdMap.set(safe, skill);
  }

  const elkNodes = graph.skills.map((skill) => ({
    id: idMap.get(skill)!,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));

  const elkEdges = graph.edges.map((e, i) => ({
    id: `e${i}`,
    sources: [idMap.get(e.from)!],
    targets: [idMap.get(e.to)!],
  }));

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '30',
      'elk.layered.thoroughness': '7',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOPP',
      'elk.layered.feedbackEdges': 'true',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    },
    children: elkNodes,
    edges: elkEdges,
  };

  const posMap = new Map<string, { x: number; y: number }>();
  try {
    const layouted = await elk.layout(elkGraph);
    for (const child of layouted.children ?? []) {
      const originalId = reverseIdMap.get(child.id);
      if (originalId) posMap.set(originalId, { x: child.x ?? 0, y: child.y ?? 0 });
    }
  } catch {
    // Fallback: simple grid layout if ELK throws (e.g. on pathological cycles).
    graph.skills.forEach((skill, i) => {
      posMap.set(skill, { x: (i % 6) * (NODE_WIDTH + 40), y: Math.floor(i / 6) * (NODE_HEIGHT + 60) });
    });
  }

  const isRight = direction === 'RIGHT';
  const feedbackEdgeIds = new Set<number>();
  graph.edges.forEach((e, i) => {
    const srcPos = posMap.get(e.from);
    const tgtPos = posMap.get(e.to);
    if (!srcPos || !tgtPos) return;
    const isBackward = isRight
      ? srcPos.x > tgtPos.x + NODE_WIDTH / 2
      : srcPos.y > tgtPos.y + NODE_HEIGHT / 2;
    if (isBackward) feedbackEdgeIds.add(i);
  });

  const nodes: Node[] = graph.skills.map((skill) => ({
    id: skill,
    type: 'skillNode',
    position: posMap.get(skill) ?? { x: 0, y: 0 },
    data: { skill },
  }));

  const edges: Edge[] = graph.edges.map((e, i) => {
    const { label, tooltip } = edgeLabel(e.recipes);
    const isFeedback = feedbackEdgeIds.has(i);
    return {
      id: `${e.from}->${e.to}:${i}`,
      source: e.from,
      target: e.to,
      type: 'labeledEdge',
      label,
      labelStyle: LABEL_STYLE,
      data: tooltip ? { tooltip } : undefined,
      ...(isFeedback ? { animated: true, style: FEEDBACK_STYLE } : {}),
    };
  });

  return { nodes, edges };
}
