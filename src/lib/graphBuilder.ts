import type { PlannerGraph, PlannerNode, LoopbackPlannerNode } from './types.js';
import type { Node, Edge } from '@xyflow/svelte';
import { MarkerType } from '@xyflow/svelte';
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 140;

function elkNodeId(id: string): string {
  // ELK needs IDs without special characters in some cases; we encode them
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function buildFlowGraph(plannerGraph: PlannerGraph): Promise<FlowGraph> {
  if (plannerGraph.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Separate loopback nodes — they are excluded from ELK and positioned manually
  const loopbackNodes = plannerGraph.nodes.filter(n => n.type === 'loopback') as LoopbackPlannerNode[];
  const regularNodes = plannerGraph.nodes.filter(n => n.type !== 'loopback');
  const loopbackNodeIds = new Set(loopbackNodes.map(n => n.id));

  // Map from original planner node id → elk-safe id (only for regular nodes)
  const idMap = new Map<string, string>();
  const reverseIdMap = new Map<string, string>();

  for (const node of regularNodes) {
    const safe = elkNodeId(node.id);
    idMap.set(node.id, safe);
    reverseIdMap.set(safe, node.id);
  }

  const elkNodes = regularNodes.map(n => ({
    id: idMap.get(n.id)!,
    width: NODE_WIDTH,
    height: NODE_HEIGHT
  }));

  const elkEdges = plannerGraph.edges
    .filter(e => !loopbackNodeIds.has(e.source) && !loopbackNodeIds.has(e.target))
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
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      'elk.spacing.nodeNode': '40'
    },
    children: elkNodes,
    edges: elkEdges
  };

  const posMap = new Map<string, { x: number; y: number }>();

  try {
    const layouted = await elk.layout(graph);
    for (const child of layouted.children ?? []) {
      const originalId = reverseIdMap.get(child.id);
      if (originalId) {
        posMap.set(originalId, { x: child.x ?? 0, y: child.y ?? 0 });
      }
    }
  } catch {
    // Fallback: simple grid layout for regular nodes
    regularNodes.forEach((n, i) => {
      posMap.set(n.id, { x: (i % 5) * 280, y: Math.floor(i / 5) * 180 });
    });
  }

  // Post-position loopback nodes below their associated table
  for (const loopNode of loopbackNodes) {
    const tablePos = posMap.get(loopNode.tableId);
    posMap.set(loopNode.id, {
      x: tablePos?.x ?? 0,
      y: (tablePos?.y ?? 0) + NODE_HEIGHT + 20
    });
  }

  const nodes: Node[] = plannerGraph.nodes.map(n => ({
    id: n.id,
    type: plannerNodeType(n),
    position: posMap.get(n.id) ?? { x: 0, y: 0 },
    data: n
  }));

  const edges: Edge[] = plannerGraph.edges.map(e => {
    const isLoopbackEdge = loopbackNodeIds.has(e.source) || loopbackNodeIds.has(e.target);
    if (isLoopbackEdge) {
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'default',
        animated: true,
        markerStart: { type: MarkerType.ArrowClosed },
        markerEnd: { type: MarkerType.ArrowClosed }
      };
    }
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'default'
    };
  });

  return { nodes, edges };
}

function plannerNodeType(node: PlannerNode): string {
  switch (node.type) {
    case 'table':     return 'tableNode';
    case 'item':      return 'itemNode';
    case 'raw':       return 'rawNode';
    case 'tag':       return 'tagNode';
    case 'market':    return 'marketNode';
    case 'byproduct': return 'byproductNode';
    case 'loopback':  return 'loopbackNode';
  }
}
