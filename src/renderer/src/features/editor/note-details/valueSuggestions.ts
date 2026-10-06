const normalizeValueIdentity = (value: string) => value.trim().toLocaleLowerCase();

/** Filters values and detects exact matches case-insensitively. */
export const filterValueSuggestions = ({
  excluded = [],
  query,
  suggestions,
}: {
  excluded?: readonly string[];
  query: string;
  suggestions: readonly string[];
}) => {
  const normalizedQuery = normalizeValueIdentity(query);
  const excludedValues = new Set(excluded.map(normalizeValueIdentity));
  const visibleSuggestions = suggestions.filter(
    (suggestion) =>
      !excludedValues.has(normalizeValueIdentity(suggestion)) &&
      (!normalizedQuery || normalizeValueIdentity(suggestion).includes(normalizedQuery)),
  );
  const exactMatch = [...suggestions, ...excluded].some(
    (value) => normalizeValueIdentity(value) === normalizedQuery,
  );

  return { exactMatch, visibleSuggestions };
};
