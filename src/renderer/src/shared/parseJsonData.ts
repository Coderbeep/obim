/**
 * Parses an optional native drag payload without throwing.
 *
 * @param raw JSON text read from `DataTransfer`.
 * @returns The parsed payload, or `null` when the text is empty or invalid.
 */
export const parseJsonData = <T>(raw: string): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};
