export interface TagsIndex {
  byTag: Map<string, string[]>;
  itemToTags: Map<string, string[]>;  // item → tags it belongs to
}

export function buildTagsIndex(tags: Record<string, string[]>): TagsIndex {
  const byTag = new Map<string, string[]>();
  const itemToTags = new Map<string, string[]>();
  for (const [tag, items] of Object.entries(tags)) {
    byTag.set(tag, items);
    for (const item of items) {
      const list = itemToTags.get(item) ?? [];
      list.push(tag);
      itemToTags.set(item, list);
    }
  }
  return { byTag, itemToTags };
}
