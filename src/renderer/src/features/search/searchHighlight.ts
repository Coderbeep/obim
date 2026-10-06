export type SearchMatchRange = { from: number; to: number };

export const getSearchMatchRanges = (value: string, query: string): SearchMatchRange[] => {
  const normalizedValue = value.toLocaleLowerCase();
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const ranges: SearchMatchRange[] = [];

  tokens.forEach((token) => {
    const contiguousIndex = normalizedValue.indexOf(token);
    if (contiguousIndex >= 0) {
      ranges.push({ from: contiguousIndex, to: contiguousIndex + token.length });
      return;
    }

    const fuzzyRanges: SearchMatchRange[] = [];
    let cursor = 0;
    for (const character of token) {
      const index = normalizedValue.indexOf(character, cursor);
      if (index < 0) return;
      fuzzyRanges.push({ from: index, to: index + 1 });
      cursor = index + 1;
    }
    ranges.push(...fuzzyRanges);
  });

  return ranges
    .sort((left, right) => left.from - right.from)
    .reduce<SearchMatchRange[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
      else merged.push({ ...range });
      return merged;
    }, []);
};
