import { describe, it, expect, vi } from 'vitest';
import { buildFlowGraph } from '$lib/graphBuilder.js';
import type { PlannerGraph } from '$lib/types.js';

// Mock ELK since it's not available in the test environment
vi.mock('elkjs/lib/elk.bundled.js', () => {
  return {
    default: class MockELK {
      async layout(graph: { children: Array<{ id: string; width: number; height: number }> }) {
        return {
          children: graph.children.map((n, i) => ({
            ...n,
            x: i * 300,
            y: 0
          })),
          edges: []
        };
      }
    }
  };
});

const sampleGraph: PlannerGraph = {
  nodes: [
    { type: 'item', id: 'item:Iron Bar', itemName: 'Iron Bar', amount: 10 },
    { type: 'table', id: 'table:Iron Bar', itemName: 'Iron Bar', table: 'Bloomery', recipe: {} as never, variant: {} as never, cycles: 10, availableRecipes: [] },
    { type: 'raw', id: 'raw:Iron Ore', itemName: 'Iron Ore', amount: 20 }
  ],
  edges: [
    { id: 'table:Iron Bar->item:Iron Bar', source: 'table:Iron Bar', target: 'item:Iron Bar' },
    { id: 'raw:Iron Ore->table:Iron Bar', source: 'raw:Iron Ore', target: 'table:Iron Bar' }
  ]
};

describe('buildFlowGraph', () => {
  it('all PlannerNodes produce corresponding SvelteFlow nodes', async () => {
    const flow = await buildFlowGraph(sampleGraph);
    expect(flow.nodes).toHaveLength(3);
  });

  it('edge count matches PlannerGraph edges', async () => {
    const flow = await buildFlowGraph(sampleGraph);
    expect(flow.edges).toHaveLength(2);
  });

  it('node types are set correctly', async () => {
    const flow = await buildFlowGraph(sampleGraph);
    const types = flow.nodes.map(n => n.type);
    expect(types).toContain('itemNode');
    expect(types).toContain('tableNode');
    expect(types).toContain('rawNode');
  });

  it('tag nodes get tagNode type', async () => {
    const graphWithTag: PlannerGraph = {
      nodes: [
        { type: 'tag', id: 'tag:Wood', tag: 'Wood', amount: 15, availableItems: ['Birch Log'], selectedItem: null }
      ],
      edges: []
    };
    const flow = await buildFlowGraph(graphWithTag);
    expect(flow.nodes[0].type).toBe('tagNode');
  });

  it('empty graph returns empty nodes and edges', async () => {
    const flow = await buildFlowGraph({ nodes: [], edges: [] });
    expect(flow.nodes).toHaveLength(0);
    expect(flow.edges).toHaveLength(0);
  });

  it('each node has a position', async () => {
    const flow = await buildFlowGraph(sampleGraph);
    for (const node of flow.nodes) {
      expect(node.position).toBeDefined();
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
    }
  });
});
