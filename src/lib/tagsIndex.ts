export interface TagsIndex {
  byTag: Map<string, string[]>;
}

export function buildTagsIndex(tags: Record<string, string[]>): TagsIndex {
  const byTag = new Map<string, string[]>();
  for (const [tag, items] of Object.entries(tags)) {
    byTag.set(tag, items);
  }
  return { byTag };
}
