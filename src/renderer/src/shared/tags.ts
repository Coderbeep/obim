export const normalizeTag = (value: string) => value.trim().replace(/\s+/gu, " ");

export const tagKey = (value: string) => normalizeTag(value).toLocaleLowerCase();

export const normalizeTags = (tags: readonly string[]) => {
  const seen = new Set<string>();
  return tags.map(normalizeTag).filter((tag) => tag && !seen.has(tagKey(tag)) && Boolean(seen.add(tagKey(tag))));
};
