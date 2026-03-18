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
});
