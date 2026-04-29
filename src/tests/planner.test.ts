import { describe, it, expect } from 'vitest';
import { buildGraph } from '$lib/planner.js';
import { buildRecipeIndex } from '$lib/recipeIndex.js';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { buildTalentIndex } from '$lib/talentIndex.js';
import { simpleRecipe, tagRecipe, multiProductRecipe, widgetRecipe, sampleTags, slabRecipe, pathRecipe, crushedRockTags, multiVariantRecipe, byproductOnlyRecipe, pumpJackRecipe, plasticRecipe, barrelRecipe, gasolineRecipe } from './fixtures.js';
import type { UserChoices, RecipeObject, ProfessionData } from '$lib/types.js';

function emptyChoices(): UserChoices {
  return {
    recipeByItem: new Map(),
    variantByItem: new Map(),
    itemByTag: new Map(),
    marketItems: new Set(),
    upgradeByTable: new Map()
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
      globalUpgrade: 0
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
      globalUpgrade: 0
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
      globalUpgrade: 0
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
      globalUpgrade: 0
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
      globalUpgrade: 0
    });

    const tagNodes = graph.nodes.filter(n => n.type === 'tag');
    expect(tagNodes.length).toBeGreaterThan(0);
    const woodTag = tagNodes.find(n => n.type === 'tag' && (n as { tag: string }).tag === 'Wood');
    expect(woodTag).toBeDefined();
    if (woodTag?.type === 'tag') {
      expect(woodTag.selectedItem).toBeNull();
      expect(woodTag.availableItems).toEqual(['Birch Log', 'Oak Log', 'Pine Log']);
      expect(woodTag.craftableItems).toEqual([]);
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
      marketItems: new Set(),
      upgradeByTable: new Map()
    };
    const graph = buildGraph({
      targetItem: 'Wooden Plank',
      totalAmount: 10,
      recipeIndex,
      tagsIndex,
      choices,
      globalUpgrade: 0
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
      globalUpgrade: 0.5
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
      globalUpgrade: 0.5
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

  it('talent reduction applies to IsStatic: true ingredients', () => {
    const laserRecipe: RecipeObject = {
      Key: 'Laser',
      Untranslated: 'Laser Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 100,
      BaseXPGain: 1,
      CraftingTable: 'Robotic Assembly Line',
      CraftingTableCanUseModules: true,
      DefaultVariant: 'Laser',
      NumberOfVariants: 1,
      SkillNeeds: [{ Skill: 'Electronics', Level: 7 }],
      Variants: [{
        Key: 'Laser',
        Name: 'Laser',
        Ingredients: [{ IsSpecificItem: true, Tag: null, Name: 'Laser Body', Ammount: 1, IsStatic: true }],
        Products: [{ Name: 'Laser', Ammount: 1 }]
      }]
    };

    const professions: ProfessionData[] = [{
      profession: 'Electronics',
      source_file: 'test',
      skills: [{
        skill: 'Electronics',
        talents: [{
          display_name: 'Robotic Assistance: Electronics',
          description: '',
          level: 7,
          class: 'RoboticAssistanceTalentGroup',
          max_takes: 1,
          effects: [{
            effect: '-10% resource cost',
            penalty: false,
            craft_stations: ['Robotic Assembly Line']
          }]
        }]
      }]
    }];

    const recipeIndex = buildRecipeIndex([laserRecipe]);
    const tagsIndex = buildTagsIndex({});
    const talentData = buildTalentIndex(professions, [laserRecipe], {});
    const graph = buildGraph({
      targetItem: 'Laser',
      totalAmount: 20,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0,
      talentData
    });

    const bodyNode = graph.nodes.find(n =>
      n.type === 'raw' && (n as { itemName: string }).itemName === 'Laser Body'
    );
    expect(bodyNode).toBeDefined();
    if (bodyNode?.type === 'raw') {
      expect(bodyNode.amount).toBeCloseTo(18);
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
      globalUpgrade: 0
    })).not.toThrow();
  });

  it('market item produces MarketNode and stops ingredient resolution', () => {
    const recipeIndex = buildRecipeIndex([simpleRecipe]);
    const tagsIndex = buildTagsIndex({});
    const choices: UserChoices = {
      recipeByItem: new Map(),
      variantByItem: new Map(),
      itemByTag: new Map(),
      marketItems: new Set(['Iron Bar']),
      upgradeByTable: new Map()
    };
    const graph = buildGraph({
      targetItem: 'Iron Bar',
      totalAmount: 50,
      recipeIndex,
      tagsIndex,
      choices,
      globalUpgrade: 0
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
      globalUpgrade: 0
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

  it('byproduct satisfies tag ingredient: TagNode shows selectedItem=byproduct, amount=0', () => {
    // Stone Slab recipe: 2 Stone → 1 Stone Slab + 2 Crushed Granite (byproduct)
    // Stone Path recipe: needs tag "Crushed Rock" (2/cycle) → 1 Stone Path
    // Stone Kit: needs 1 Stone Slab + 1 Stone Path
    // Stone Slab produces Crushed Granite as byproduct → auto-satisfies "Crushed Rock" tag for Stone Path.
    // Fix B: table:Stone Slab → tag:Crushed Rock (directly, no item:Crushed Granite node)

    const kitRecipe: RecipeObject = {
      Key: 'StoneKit',
      Untranslated: 'Stone Kit Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 5,
      BaseXPGain: 0,
      CraftingTable: 'Masonry Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Stone Kit',
      NumberOfVariants: 1,
      SkillNeeds: [],
      Variants: [{
        Key: 'StoneKit',
        Name: 'Stone Kit',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Stone Slab', Ammount: 1, IsStatic: false },
          { IsSpecificItem: true, Tag: null, Name: 'Stone Path', Ammount: 1, IsStatic: false }
        ],
        Products: [{ Name: 'Stone Kit', Ammount: 1 }]
      }]
    };

    const recipeIndex = buildRecipeIndex([slabRecipe, pathRecipe, kitRecipe]);
    const tagsIndex = buildTagsIndex(crushedRockTags);
    const graph = buildGraph({
      targetItem: 'Stone Kit',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0
    });

    // TagNode for "Crushed Rock" should be auto-resolved by byproduct contributor
    const tagNode = graph.nodes.find(n => n.type === 'tag' && (n as { tag: string }).tag === 'Crushed Rock');
    expect(tagNode).toBeDefined();
    if (tagNode?.type === 'tag') {
      expect(tagNode.selectedItem).toBeNull(); // auto-byproduct; not a user choice
      expect(tagNode.amount).toBe(0);
      expect(tagNode.byproductContributors).toBeDefined();
      expect(tagNode.byproductContributors).toHaveLength(1);
      expect(tagNode.byproductContributors![0].itemName).toBe('Crushed Granite');
      expect(tagNode.byproductContributors![0].contribution).toBe(2);
      expect(tagNode.craftableItems).toEqual(['Crushed Granite']); // Crushed Granite is produced by slabRecipe
    }

    // Fix B: table:Stone Slab → tag:Crushed Rock (byproduct routes to tag directly)
    const edgeFromSlab = graph.edges.find(e => e.source === 'table:Stone Slab' && e.target === 'tag:Crushed Rock');
    expect(edgeFromSlab).toBeDefined();

    // tag:Crushed Rock → table:Stone Path (tag supplies table)
    const edgeToPath = graph.edges.find(e => e.source === 'tag:Crushed Rock' && e.target === 'table:Stone Path');
    expect(edgeToPath).toBeDefined();

    // No item:Crushed Granite node — it's unified into the tag representation
    const graniteItem = graph.nodes.find(n => n.id === 'item:Crushed Granite');
    expect(graniteItem).toBeUndefined();

    // No dead-end byproduct node for Crushed Granite
    const byproductNode = graph.nodes.find(n => n.type === 'byproduct' && (n as { itemName: string }).itemName === 'Crushed Granite');
    expect(byproductNode).toBeUndefined();
  });

  it('partial byproduct coverage + user-chosen item covers only remainder', () => {
    // packRecipe: 2 Stone Slab + 3 Stone Path → 1 Stone Pack
    // Stone Slab (slabRecipe): 2 Stone → 1 Stone Slab + 2 Crushed Granite
    // Stone Path (pathRecipe): 2 Crushed Rock (tag) → 1 Stone Path
    // Tags: Crushed Rock includes Crushed Granite and Crushed Sandstone
    //
    // Plan: 1 Stone Pack
    //   → 2 Stone Slabs: 2 cycles → 4 Crushed Granite byproduct
    //   → 3 Stone Paths: 3 cycles × 2 = 6 Crushed Rock needed
    //   → Byproduct covers 4, user picks Crushed Sandstone for remaining 2
    const packRecipe: RecipeObject = {
      Key: 'StonePack',
      Untranslated: 'Stone Pack Recipe',
      BaseCraftTime: 3,
      BaseLaborCost: 15,
      BaseXPGain: 1,
      CraftingTable: 'Masonry Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Stone Pack',
      NumberOfVariants: 1,
      SkillNeeds: [],
      Variants: [{
        Key: 'StonePack',
        Name: 'Stone Pack',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Stone Slab', Ammount: 2, IsStatic: false },
          { IsSpecificItem: true, Tag: null, Name: 'Stone Path', Ammount: 3, IsStatic: false }
        ],
        Products: [{ Name: 'Stone Pack', Ammount: 1 }]
      }]
    };

    const recipeIndex = buildRecipeIndex([slabRecipe, pathRecipe, packRecipe]);
    const tagsIndex = buildTagsIndex(crushedRockTags);
    const choices: UserChoices = {
      recipeByItem: new Map(),
      variantByItem: new Map(),
      itemByTag: new Map([['Crushed Rock', 'Crushed Sandstone']]),
      marketItems: new Set(),
      upgradeByTable: new Map()
    };
    const graph = buildGraph({
      targetItem: 'Stone Pack',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices,
      globalUpgrade: 0
    });

    // TagNode: byproduct covers 4 of 6, user-chosen covers remaining 2
    const tagNode = graph.nodes.find(n => n.type === 'tag' && (n as { tag: string }).tag === 'Crushed Rock');
    expect(tagNode).toBeDefined();
    if (tagNode?.type === 'tag') {
      expect(tagNode.byproductContributors).toBeDefined();
      expect(tagNode.byproductContributors![0].itemName).toBe('Crushed Granite');
      expect(tagNode.byproductContributors![0].contribution).toBe(4);
      expect(tagNode.amount).toBe(2); // 6 - 4 = 2 remaining
      expect(tagNode.selectedItem).toBe('Crushed Sandstone');
    }

    // Crushed Sandstone raw node should request only 2 (the remainder), not 6
    const sandstoneNode = graph.nodes.find(n =>
      n.type === 'raw' && (n as { itemName: string }).itemName === 'Crushed Sandstone'
    );
    expect(sandstoneNode).toBeDefined();
    if (sandstoneNode?.type === 'raw') {
      expect(sandstoneNode.amount).toBe(2);
    }
  });

  it('craftable tag options populate craftableItems', () => {
    // tagRecipe: Wooden Plank needs tag "Wood" (Birch Log, Oak Log, Pine Log)
    // Add a recipe that crafts "Birch Log" so it shows as craftable
    const birchRecipe: RecipeObject = {
      Key: 'BirchLog',
      Untranslated: 'Birch Log Recipe',
      BaseCraftTime: 1,
      BaseLaborCost: 5,
      BaseXPGain: 0,
      CraftingTable: 'Carpentry Table',
      CraftingTableCanUseModules: false,
      DefaultVariant: 'Birch Log',
      NumberOfVariants: 1,
      SkillNeeds: [],
      Variants: [{
        Key: 'BirchLog',
        Name: 'Birch Log',
        Ingredients: [
          { IsSpecificItem: true, Tag: null, Name: 'Wood Pulp', Ammount: 5, IsStatic: false }
        ],
        Products: [{ Name: 'Birch Log', Ammount: 1 }]
      }]
    };

    const recipeIndex = buildRecipeIndex([tagRecipe, birchRecipe]);
    const tagsIndex = buildTagsIndex(sampleTags);
    const graph = buildGraph({
      targetItem: 'Wooden Plank',
      totalAmount: 10,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0
    });

    const tagNode = graph.nodes.find(n => n.type === 'tag' && (n as { tag: string }).tag === 'Wood');
    expect(tagNode).toBeDefined();
    if (tagNode?.type === 'tag') {
      expect(tagNode.craftableItems).toEqual(['Birch Log']);
    }
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
      globalUpgrade: 0
    });

    expect(graph.edges.length).toBeGreaterThan(0);
  });
});

describe('multi-variant recipe indexing', () => {
  it('non-default variant products appear in allCraftableNames', () => {
    const recipeIndex = buildRecipeIndex([multiVariantRecipe]);
    expect(recipeIndex.allCraftableNames).toContain('Composite Oak Lumber');
    expect(recipeIndex.allCraftableNames).toContain('Composite Spruce Lumber');
    expect(recipeIndex.allCraftableNames).toContain('Composite Lumber');
  });

  it('planning a non-default variant product produces a table node, not a raw node', () => {
    const recipeIndex = buildRecipeIndex([multiVariantRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Composite Oak Lumber',
      totalAmount: 10,
      recipeIndex,
      tagsIndex,
      choices: {
        recipeByItem: new Map(),
        variantByItem: new Map(),
        itemByTag: new Map(),
        marketItems: new Set(),
        upgradeByTable: new Map()
      },
      globalUpgrade: 0
    });

    const rawNodes = graph.nodes.filter(n => n.type === 'raw');
    const tableNodes = graph.nodes.filter(n => n.type === 'table');
    expect(tableNodes.length).toBe(1);
    expect(tableNodes[0].type === 'table' && (tableNodes[0] as any).itemName).toBe('Composite Oak Lumber');
    // Oak Log should be the raw ingredient, not Composite Oak Lumber itself
    expect(rawNodes.some(n => (n as any).itemName === 'Composite Oak Lumber')).toBe(false);
    expect(rawNodes.some(n => (n as any).itemName === 'Oak Log')).toBe(true);
  });

  it('byproduct-only items (never Products[0]) are absent from allCraftableNames', () => {
    const recipeIndex = buildRecipeIndex([byproductOnlyRecipe]);
    // Raw Meat is Products[0] — should be craftable
    expect(recipeIndex.allCraftableNames).toContain('Raw Meat');
    // Wool is only ever Products[1] — should NOT be listed as a plannable target
    expect(recipeIndex.allCraftableNames).not.toContain('Wool');
  });
});

describe('inline production (Petroleum/Barrel cycle)', () => {
  // Plastic: 4 Petroleum → 2 Plastic + 3 Barrel + 1 Sulfur  (Oil Refinery)
  // PumpJack: 1 Barrel (IsStatic) → 1 Petroleum
  // Barrel: 4 Iron Bar → 4 Barrel (Rolling Mill)
  // At 0% upgrade, planning 2 Plastic:
  //   cycles = ceil(2/2) = 1
  //   Petroleum needed = 4 × 1 = 4 → 4 PumpJack cycles → 4 Barrel consumed, 3 Barrel returned
  //   net Barrel = 4 - 3 = 1 → ceil(1/4) = 1 Rolling Mill cycle → 4 Barrel, 3 iron bars

  function buildPlasticGraph(totalAmount = 2) {
    const recipeIndex = buildRecipeIndex([plasticRecipe, pumpJackRecipe, barrelRecipe]);
    const tagsIndex = buildTagsIndex({});
    return buildGraph({
      targetItem: 'Plastic',
      totalAmount,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0,
    });
  }

  it('suppresses item:Petroleum and table:Petroleum nodes', () => {
    const graph = buildPlasticGraph();
    expect(graph.nodes.find(n => n.id === 'item:Petroleum')).toBeUndefined();
    expect(graph.nodes.find(n => n.id === 'table:Petroleum')).toBeUndefined();
  });

  it('populates inlinedProductions on the Oil Refinery table node', () => {
    const graph = buildPlasticGraph();
    const tableNode = graph.nodes.find(n => n.type === 'table') as any;
    expect(tableNode?.inlinedProductions).toHaveLength(1);
    expect(tableNode.inlinedProductions[0].itemName).toBe('Petroleum');
    expect(tableNode.inlinedProductions[0].producerTable).toBe('Pump Jack');
  });

  it('computes net Barrel = 1 at 0% upgrade for 2 Plastic', () => {
    const graph = buildPlasticGraph();
    const tableNode = graph.nodes.find(n => n.type === 'table') as any;
    const ip = tableNode.inlinedProductions[0];
    const barrelNet = ip.netIngredients.find((i: any) => i.name === 'Barrel');
    expect(barrelNet).toBeDefined();
    expect(barrelNet.amount).toBe(1);
  });

  it('clears byproductSupply from the Barrel node', () => {
    const graph = buildPlasticGraph();
    const barrelNode = graph.nodes.find(n => (n as any).itemName === 'Barrel') as any;
    expect(barrelNode).toBeDefined();
    expect(barrelNode.byproductSupply).toBeUndefined();
  });

  it('adds edge item:Barrel → table:Plastic (net external demand)', () => {
    const graph = buildPlasticGraph();
    const tableNode = graph.nodes.find(n => n.type === 'table')!;
    expect(graph.edges.some(e => e.source === 'item:Barrel' && e.target === tableNode.id)).toBe(true);
  });

  it('does NOT add byproduct edge table:Plastic → item:Barrel', () => {
    const graph = buildPlasticGraph();
    const tableNode = graph.nodes.find(n => n.type === 'table')!;
    expect(graph.edges.some(e => e.source === tableNode.id && e.target === 'item:Barrel')).toBe(false);
  });

  it('includes Rolling Mill in the graph', () => {
    const graph = buildPlasticGraph();
    expect(graph.nodes.some(n => n.type === 'table' && (n as any).table === 'Rolling Mill')).toBe(true);
  });

  it('does NOT inline Gasoline (no Barrel in products)', () => {
    const recipeIndex = buildRecipeIndex([gasolineRecipe, pumpJackRecipe, barrelRecipe]);
    const tagsIndex = buildTagsIndex({});
    const graph = buildGraph({
      targetItem: 'Gasoline',
      totalAmount: 1,
      recipeIndex,
      tagsIndex,
      choices: emptyChoices(),
      globalUpgrade: 0,
    });
    // Petroleum should NOT be inlined — it should appear as a normal item/table node
    expect(graph.nodes.find(n => n.id === 'item:Petroleum')).toBeDefined();
    const tableNode = graph.nodes.find(n => n.type === 'table' && (n as any).itemName === 'Gasoline') as any;
    expect(tableNode?.inlinedProductions ?? []).toHaveLength(0);
  });
});
