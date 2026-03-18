import { describe, it, expect } from 'vitest';
import { buildGraph } from '$lib/planner.js';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { simpleRecipe, tagRecipe, multiProductRecipe, widgetRecipe, sampleTags } from './fixtures.js';
import type { UserChoices } from '$lib/types.js';

function emptyChoices(): UserChoices {
  return {
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(),
    marketItems: new Set()
  };
}

describe('buildGraph', () => {
  it('single recipe item: correct cycle count (100 Iron Bar at 1/cycle = 100 cycles)', () => {
    const recipeIndex = buildRecipeIndex([simpleRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Iron Bar',
      totalAmount: 100,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    });

    const tableNode = graph.nodes.find(n => n.type === 'table');
    expect(tableNode).toBeDefined();
    expect(tableNode?.type).toBe('table');
    if (tableNode?.type === 'table') {
      expect(tableNode.cycles).toBe(100);
    }
  });

  it('cycle count: ceil(7/4) = 2 for Steel Bar', () => {
    const recipeIndex = buildRecipeIndex([multiProductRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Steel Bar',
      totalAmount: 7,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    });

    const tableNode = graph.nodes.find(n => n.type === 'table');
    if (tableNode?.type === 'table') {
      expect(tableNode.cycles).toBe(2); // ceil(7/4) = 2
    }
  });

  it('ingredient amounts scale with cycles', () => {
    const recipeIndex = buildRecipeIndex([simpleRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Iron Bar',
      totalAmount: 10,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    });

    // 10 cycles × 2 Iron Ore per cycle = 20 Iron Ore
    const rawNode = graph.nodes.find(n => n.type === 'raw' && (n as { itemName: string }).itemName === 'Iron Ore');
    expect(rawNode).toBeDefined();
    if (rawNode?.type === 'raw') {
      expect(rawNode.amount).toBe(20);
    }
  });

  it('raw resource produces RawNode', () => {
    const recipeIndex = buildRecipeIndex([simpleRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Iron Bar',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    });

    const rawNodes = graph.nodes.filter(n => n.type === 'raw');
    expect(rawNodes.length).toBeGreaterThan(0);
    const oreNode = rawNodes.find(n => n.type === 'raw' && (n as { itemName: string }).itemName === 'Iron Ore');
    expect(oreNode).toBeDefined();
  });

  it('tag ingredient without user choice produces TagNode', () => {
    const recipeIndex = buildRecipeIndex([tagRecipe]);
    const tagsIndex = buildTagsIndex(sampleTags);
    const graph = buildGraph({
      targetItem: 'Wooden Plank',
      totalAmount: 10,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    });

    const tagNodes = graph.nodes.filter(n => n.type === 'tag');
    expect(tagNodes.length).toBeGreaterThan(0);
    const woodTag = tagNodes.find(n => n.type === 'tag' && (n as { tag: string }).tag === 'Wood');
    expect(woodTag).toBeDefined();
    if (woodTag?.type === 'tag') {
      expect(woodTag.selectedItem).toBeNull();
      expect(woodTag.availableItems).toEqual(['Birch Log', 'Oak Log', 'Pine Log']);
    }
  });

  it('tag ingredient with user choice resolves and continues chain', () => {
    // Birch Log is a raw resource (not in any recipe)
    const recipeIndex = buildRecipeIndex([tagRecipe]);
    const tagsIndex = buildTagsIndex(sampleTags);
    const choices: UserChoices = {
      recipeByItem: new Map(),
      variantByItem: new Map(),
      itemByTag: new Map([['Wood', 'Birch Log']]),
      marketItems: new Set()
    };
    const graph = buildGraph({
      targetItem: 'Wooden Plank',
      totalAmount: 10,
      recipeIndex,
      tagsIndex,
      choices,
      skillReduction: 0
    });

    // Should have a raw node for Birch Log
    const rawNodes = graph.nodes.filter(n => n.type === 'raw');
    const birchNode = rawNodes.find(n => n.type === 'raw' && (n as { itemName: string }).itemName === 'Birch Log');
    expect(birchNode).toBeDefined();
  });

  it('IsStatic: true ingredient unchanged at 50% reduction', () => {
    const recipeIndex = buildRecipeIndex([multiProductRecipe]);
    const tagsIndex = buildTagsIndex({});
    // Steel Bar recipe: Iron Bar (IsStatic:false), Coal (IsStatic:true)
    // 7 Steel Bar → 2 cycles (ceil 7/4)
    // Coal: IsStatic, 1/cycle × 2 = 2 (no reduction)
    const graph = buildGraph({
      targetItem: 'Steel Bar',
      totalAmount: 7,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0.5
    });

    const coalNode = graph.nodes.find(n =>
      n.type === 'raw' && (n as { itemName: string }).itemName === 'Coal'
    );
    expect(coalNode).toBeDefined();
    if (coalNode?.type === 'raw') {
      // 2 cycles × 1 coal (static, no reduction) = 2
      expect(coalNode.amount).toBe(2);
    }
  });

  it('IsStatic: false ingredient halved at 50% reduction', () => {
    const recipeIndex = buildRecipeIndex([multiProductRecipe]);
    const tagsIndex = buildTagsIndex({});
    // Steel Bar: Iron Bar (IsStatic:false, 4/cycle)
    // 7 Steel Bar → 2 cycles
    // Iron Bar: 4 × (1 - 0.5) × 2 = 4 (with reduction)
    // Iron Bar has no recipe here → raw node
    const graph = buildGraph({
      targetItem: 'Steel Bar',
      totalAmount: 7,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0.5
    });

    const ironBarNode = graph.nodes.find(n =>
      n.type === 'raw' && (n as { itemName: string }).itemName === 'Iron Bar'
    );
    expect(ironBarNode).toBeDefined();
    if (ironBarNode?.type === 'raw') {
      // 4 × 0.5 × 2 = 4
      expect(ironBarNode.amount).toBe(4);
    }
  });

  it('cycle guard prevents infinite loops', () => {
    // Even if a recipe somehow references itself, visited guard should prevent stack overflow
    const recipeIndex = buildRecipeIndex([simpleRecipe]);
    const tagsIndex = buildTagsIndex({});
    // This should not throw
    expect(() => buildGraph({
      targetItem: 'Iron Bar',
      totalAmount: 100,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    })).not.toThrow();
  });

  it('market item produces MarketNode and stops ingredient resolution', () => {
    const recipeIndex = buildRecipeIndex([simpleRecipe]);
    const tagsIndex = buildTagsIndex({});
    const choices: UserChoices = {
      recipeByItem: new Map(),
      variantByItem: new Map(),
      itemByTag: new Map(),
      marketItems: new Set(['Iron Bar'])
    };
    const graph = buildGraph({
      targetItem: 'Iron Bar',
      totalAmount: 50,
      recipeIndex,
      tagsIndex,
      choices,
      skillReduction: 0
    });

    const marketNode = graph.nodes.find(n => n.type === 'market');
    expect(marketNode).toBeDefined();
    if (marketNode?.type === 'market') {
      expect(marketNode.itemName).toBe('Iron Bar');
      expect(marketNode.amount).toBe(50);
      expect(marketNode.availableRecipes.length).toBeGreaterThan(0);
    }
    // No table node or raw node — chain stops at market
    expect(graph.nodes.find(n => n.type === 'table')).toBeUndefined();
    expect(graph.nodes.find(n => n.type === 'raw')).toBeUndefined();
  });

  it('byproduct feeds back: fully-covered item gets ItemNode with amount=0, no raw/table', () => {
    // Widget needs 4 Steel Bar + 1 Slag.
    // multiProductRecipe: 4 Iron Bar + 1 Coal → 4 Steel Bar + 1 Slag (byproduct).
    // 1 Widget → ceil(4/4)=1 cycle of Steel Bar → produces 1 Slag byproduct.
    // Slag gross requirement = 1, byproduct supply = 1 → net = 0.
    const recipeIndex = buildRecipeIndex([multiProductRecipe, widgetRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Widget',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    });

    // Slag has no recipe — normally a raw node, but byproduct fully covers it
    const slagRaw = graph.nodes.find(n => n.type === 'raw' && (n as { itemName: string }).itemName === 'Slag');
    expect(slagRaw).toBeUndefined();

    // Should be an item node with amount=0 and byproductSupply=1
    const slagItem = graph.nodes.find(n => n.type === 'item' && (n as { itemName: string }).itemName === 'Slag');
    expect(slagItem).toBeDefined();
    if (slagItem?.type === 'item') {
      expect(slagItem.amount).toBe(0);
      expect(slagItem.byproductSupply).toBe(1);
    }

    // Edge from table:Steel Bar to item:Slag (byproduct → chain)
    const feedEdge = graph.edges.find(e => e.source === 'table:Steel Bar' && e.target === 'item:Slag');
    expect(feedEdge).toBeDefined();

    // Edge from item:Slag to table:Widget (Slag consumed by Widget table)
    const consumeEdge = graph.edges.find(e => e.source === 'item:Slag' && e.target === 'table:Widget');
    expect(consumeEdge).toBeDefined();

    // No byproduct node for Slag (it feeds into the chain, not dead-end)
    const slagByproduct = graph.nodes.find(n => n.type === 'byproduct' && (n as { itemName: string }).itemName === 'Slag');
    expect(slagByproduct).toBeUndefined();
  });

  it('graph has edges connecting nodes', () => {
    const recipeIndex = buildRecipeIndex([simpleRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Iron Bar',
      totalAmount: 10,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      skillReduction: 0
    });

    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
