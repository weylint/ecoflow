import { describe, it, expect } from 'vitest';
import { buildTagsIndex } from '$lib/tagsIndex.js';
import { sampleTags } from './fixtures.js';

describe('buildTagsIndex', () => {
  it('maps tag to items correctly', () => {
    const idx = buildTagsIndex(sampleTags);
    expect(idx.byTag.get('Wood')).toEqual(['Birch Log', 'Oak Log', 'Pine Log']);
  });

  it('missing tag returns undefined', () => {
    const idx = buildTagsIndex(sampleTags);
    expect(idx.byTag.get('NonExistentTag')).toBeUndefined();
  });

  it('indexes all tags', () => {
    const tags = { A: ['x', 'y'], B: ['z'] };
    const idx = buildTagsIndex(tags);
    expect(idx.byTag.size).toBe(2);
    expect(idx.byTag.get('A')).toEqual(['x', 'y']);
    expect(idx.byTag.get('B')).toEqual(['z']);
  });

  it('itemToTags: builds reverse map correctly', () => {
    const idx = buildTagsIndex(sampleTags);
    expect(idx.itemToTags.get('Birch Log')).toEqual(['Wood']);
    expect(idx.itemToTags.get('Oak Log')).toEqual(['Wood']);
    expect(idx.itemToTags.get('Pine Log')).toEqual(['Wood']);
  });

  it('itemToTags: item in multiple tags appears in all of them', () => {
    const tags = { A: ['x', 'y'], B: ['x', 'z'] };
    const idx = buildTagsIndex(tags);
    expect(idx.itemToTags.get('x')).toEqual(['A', 'B']);
    expect(idx.itemToTags.get('y')).toEqual(['A']);
    expect(idx.itemToTags.get('z')).toEqual(['B']);
  });

  it('itemToTags: item not in any tag returns undefined', () => {
    const idx = buildTagsIndex(sampleTags);
    expect(idx.itemToTags.get('Iron Ore')).toBeUndefined();
  });
});
