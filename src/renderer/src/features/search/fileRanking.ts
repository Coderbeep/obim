import type { FileItem } from "@shared/file-item";

const WORD_BOUNDARY_CHARS = new Set(["/", "\\", "-", "_", " ", "."]);
const normalizedFileFields = new WeakMap<FileItem, { filename: string; relativePath: string }>();

const normalize = (value: string) => value.toLocaleLowerCase().trim();

function contiguousMatchScore(query: string, text: string) {
  const index = text.indexOf(query);
  if (index === -1) return null;

  let score = 140;
  if (index === 0) score += 30;
  if (index > 0 && WORD_BOUNDARY_CHARS.has(text[index - 1])) score += 25;
  score += Math.max(0, 30 - index * 2);
  score += Math.max(0, 20 - (text.length - query.length));
  return score;
}

function fuzzySequenceScore(query: string, text: string) {
  let queryIndex = 0;
  let firstMatchIndex = -1;
  let previousMatchIndex = -2;
  let sequenceBonus = 0;
  let score = 0;

  for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) continue;
    if (firstMatchIndex === -1) firstMatchIndex = textIndex;

    const consecutive = textIndex === previousMatchIndex + 1;
    sequenceBonus = consecutive ? sequenceBonus + 1 : 0;
    score += 10 + sequenceBonus * 6;
    if (textIndex === 0) score += 18;
    if (textIndex > 0 && WORD_BOUNDARY_CHARS.has(text[textIndex - 1])) score += 12;

    previousMatchIndex = textIndex;
    queryIndex += 1;
    if (queryIndex === query.length) break;
  }

  if (queryIndex !== query.length || firstMatchIndex === -1) return null;
  const gaps = previousMatchIndex - firstMatchIndex + 1 - query.length;
  score += Math.max(0, 24 - gaps * 2);
  score += Math.max(0, 12 - firstMatchIndex);
  score += Math.max(0, 20 - text.length);
  return score;
}

function bestFieldScore(query: string, text: string) {
  const contiguous = contiguousMatchScore(query, text);
  const fuzzy = fuzzySequenceScore(query, text);
  if (contiguous === null && fuzzy === null) return null;
  return Math.max(contiguous ?? Number.NEGATIVE_INFINITY, fuzzy ?? Number.NEGATIVE_INFINITY);
}

const searchableFields = (file: FileItem) => {
  const cached = normalizedFileFields.get(file);
  if (cached) return cached;
  const fields = { filename: normalize(file.filename), relativePath: normalize(file.relativePath) };
  normalizedFileFields.set(file, fields);
  return fields;
};

function fileScore(file: FileItem, tokens: string[]) {
  const { filename, relativePath } = searchableFields(file);
  let total = 0;

  for (const token of tokens) {
    const filenameScore = bestFieldScore(token, filename);
    const pathScore = bestFieldScore(token, relativePath);
    const score = Math.max(
      filenameScore === null ? Number.NEGATIVE_INFINITY : filenameScore * 6,
      pathScore === null ? Number.NEGATIVE_INFINITY : pathScore * 3,
    );
    if (score === Number.NEGATIVE_INFINITY) return null;
    total += score;
  }

  return total + Math.max(0, 50 - relativePath.length);
}

type RankedFile = { file: FileItem; score: number };

const compareRankedFiles = (left: RankedFile, right: RankedFile) =>
  right.score - left.score ||
  left.file.relativePath.length - right.file.relativePath.length ||
  left.file.relativePath.localeCompare(right.file.relativePath);

export function rankFiles(files: readonly FileItem[], query: string, limit?: number) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return limit === undefined ? [...files] : files.slice(0, Math.max(0, limit));

  if (limit === undefined) {
    return files
      .map((file) => ({ file, score: fileScore(file, tokens) }))
      .filter((entry): entry is RankedFile => entry.score !== null)
      .sort(compareRankedFiles)
      .map(({ file }) => file);
  }

  const boundedLimit = Math.max(0, limit);
  if (!boundedLimit) return [];
  const ranked: RankedFile[] = [];

  files.forEach((file) => {
    const score = fileScore(file, tokens);
    if (score === null) return;
    const entry = { file, score };
    let low = 0;
    let high = ranked.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareRankedFiles(entry, ranked[middle]) < 0) high = middle;
      else low = middle + 1;
    }
    if (low >= boundedLimit) return;
    ranked.splice(low, 0, entry);
    if (ranked.length > boundedLimit) ranked.pop();
  });

  return ranked.map(({ file }) => file);
}
