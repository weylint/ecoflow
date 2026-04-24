import { describe, it, expect, vi } from 'vitest';
import { buildFlowGraph } from '$lib/graphBuilder.js';
import type { PlannerGraph } from '$lib/types.js';

// Mock ELK since it's not available in the test environment
vi.mock('elkjs/lib/elk.bundled.js', () => {
  return {
    default: class MockELK {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async layout(graph: { children: Array<any> }) {
        return {
          children: graph.children.map((n, i) => ({
            ...n,
            x: i * 300,
            y: 0,
            width: n.width ?? 220,
            height: n.height ?? 140,
            // recurse into compound node children
            children: n.children?.map((child: { id: string; width?: number; height?: number }, j: number) => ({
              ...child,
              x: j * 280,
              y: 40,
              width: child.width ?? 220,
              height: child.height ?? 140
            }))
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
    {
      type: 'table',
      id: 'table:Iron Bar',
      itemName: 'Iron Bar',
      table: 'Bloomery',
      recipe: {} as never,
      variant: {
        Key: 'IronBar',
        Name: 'Iron Bar',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Iron Ore', Ammount: 2, IsStatic: false }],
        Products: [{ Name: 'Iron Bar', Ammount: 1 }]
      },
      cycles: 10,
      effectiveReduction: 0,
      appliedTalents: [],
      availableRecipes: []
    },
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

  it('groupByProfession adds profession group nodes', async () => {
    const flow = await buildFlowGraph(sampleGraph, true);
    // 3 planner nodes + 1 professionGroup container node
    expect(flow.nodes).toHaveLength(4);
    expect(flow.nodes.some(n => n.type === 'professionGroup')).toBe(true);
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
        { type: 'tag', id: 'tag:Wood', tag: 'Wood', amount: 15, availableItems: ['Birch Log'], selectedItem: null, craftableItems: [] }
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

  it('raw-to-table edges get amount labels from the consuming recipe', async () => {
    const flow = await buildFlowGraph(sampleGraph);
    const edge = flow.edges.find(e => e.id === 'raw:Iron Ore->table:Iron Bar');
    expect(edge?.label).toBe('Iron Ore · ×20 (100%)');
  });

  it('shared raw inputs show consumer share percentages', async () => {
    const graph: PlannerGraph = {
      nodes: [
        { type: 'raw', id: 'raw:Sandstone', itemName: 'Sandstone', amount: 420 },
        {
          type: 'table',
          id: 'table:Crushed Sandstone',
          itemName: 'Crushed Sandstone',
          table: 'Jaw Crusher',
          recipe: {} as never,
          variant: {
            Key: 'CrushedSandstoneLv3',
            Name: 'Crushed Sandstone Lv3',
            Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Sandstone', Ammount: 20, IsStatic: true }],
            Products: [{ Name: 'Crushed Sandstone', Ammount: 5 }]
          },
          cycles: 6,
          effectiveReduction: 0,
          appliedTalents: [],
          availableRecipes: []
        },
        {
          type: 'table',
          id: 'table:Mortared Sandstone',
          itemName: 'Mortared Sandstone',
          table: 'Masonry Table',
          recipe: {} as never,
          variant: {
            Key: 'MortaredSandstone',
            Name: 'Mortared Sandstone',
            Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Sandstone', Ammount: 4, IsStatic: false }],
            Products: [{ Name: 'Mortared Sandstone', Ammount: 1 }]
          },
          cycles: 100,
          effectiveReduction: 0.25,
          appliedTalents: [],
          availableRecipes: []
        }
      ],
      edges: [
        { id: 'raw:Sandstone->table:Crushed Sandstone', source: 'raw:Sandstone', target: 'table:Crushed Sandstone' },
        { id: 'raw:Sandstone->table:Mortared Sandstone', source: 'raw:Sandstone', target: 'table:Mortared Sandstone' }
      ]
    };

    const flow = await buildFlowGraph(graph);
    expect(flow.edges.find(e => e.id === 'raw:Sandstone->table:Crushed Sandstone')?.label).toBe('Sandstone · ×120 (29%)');
    expect(flow.edges.find(e => e.id === 'raw:Sandstone->table:Mortared Sandstone')?.label).toBe('Sandstone · ×300 (71%)');
  });

  it('tag-to-table edges show the concrete items consumed from the tag', async () => {
    const graph: PlannerGraph = {
      nodes: [
        {
          type: 'tag',
          id: 'tag:Silica',
          tag: 'Silica',
          amount: 27,
          availableItems: ['Crushed Sandstone'],
          selectedItem: 'Crushed Sandstone',
          craftableItems: ['Crushed Sandstone']
        },
        {
          type: 'table',
          id: 'table:Sand Concentrate',
          itemName: 'Sand Concentrate',
          table: 'Masonry Table',
          recipe: {} as never,
          variant: {
            Key: 'SandConcentrate',
            Name: 'Sand Concentrate',
            Ingredients: [{ IsSpecificItem: false, Tag: 'Silica', Name: 'Silica', Ammount: 3, IsStatic: false }],
            Products: [{ Name: 'Sand Concentrate', Ammount: 1 }]
          },
          cycles: 9,
          effectiveReduction: 0,
          appliedTalents: [],
          availableRecipes: []
        }
      ],
      edges: [
        { id: 'tag:Silica->table:Sand Concentrate', source: 'tag:Silica', target: 'table:Sand Concentrate' }
      ]
    };

    const flow = await buildFlowGraph(graph);
    const edge = flow.edges.find(e => e.id === 'tag:Silica->table:Sand Concentrate');
    expect(edge?.label).toBe('Crushed Sandstone ×27 (100%)');
    expect(edge?.type).toBe('labeledEdge');
  });

  it('tag-to-table labels collapse long mixes and keep the full list in a tooltip', async () => {
    const graph: PlannerGraph = {
      nodes: [
        {
          type: 'tag',
          id: 'tag:Silica',
          tag: 'Silica',
          amount: 3,
          availableItems: ['Quartz', 'Crushed Granite', 'Crushed Sandstone'],
          selectedItem: 'Quartz',
          byproductContributors: [
            { itemName: 'Crushed Granite', contribution: 4 },
            { itemName: 'Crushed Sandstone', contribution: 5 }
          ],
          craftableItems: ['Quartz', 'Crushed Granite', 'Crushed Sandstone']
        },
        {
          type: 'table',
          id: 'table:Sand Concentrate',
          itemName: 'Sand Concentrate',
          table: 'Masonry Table',
          recipe: {} as never,
          variant: {
            Key: 'SandConcentrate',
            Name: 'Sand Concentrate',
            Ingredients: [{ IsSpecificItem: false, Tag: 'Silica', Name: 'Silica', Ammount: 12, IsStatic: true }],
            Products: [{ Name: 'Sand Concentrate', Ammount: 1 }]
          },
          cycles: 1,
          effectiveReduction: 0,
          appliedTalents: [],
          availableRecipes: []
        }
      ],
      edges: [
        { id: 'tag:Silica->table:Sand Concentrate', source: 'tag:Silica', target: 'table:Sand Concentrate' }
      ]
    };

    const flow = await buildFlowGraph(graph);
    const edge = flow.edges.find(e => e.id === 'tag:Silica->table:Sand Concentrate');
    expect(edge?.label).toBe('Crushed Granite ×4, Crushed Sandstone ×5 +1 more (100%)');
    expect(edge?.data).toEqual({ tooltip: 'Crushed Granite ×4\nCrushed Sandstone ×5\nQuartz ×3' });
  });
});
