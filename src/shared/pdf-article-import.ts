import type { FileItem } from "./file-item";

export type PdfArticleImportResult =
  | { success: true; file: Extract<FileItem, { isDirectory: false }> }
  | {
      success: false;
      error: string;
      /** Article landing page to open when no direct PDF could be downloaded. */
      landingPage?: string;
    };

export interface PdfArticleReference {
  doi: string;
  arxiv?: string;
}

const trimDoiPunctuation = (value: string) => value.replace(/[.,;]+$/u, "");
const containsDoiWhitespaceOrControl = (value: string) =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 32 || code === 127;
  });

/** Accepts a bare DOI, a doi: prefix, or a doi.org URL and returns its canonical lowercase form. */
export const normalizeDoi = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  let value = input.trim();
  value = value.replace(/^doi:\s*/iu, "");
  value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  value = trimDoiPunctuation(value.trim());
  if (value.length > 512 || !/^10\.\d{4,9}\/\S+$/iu.test(value) || containsDoiWhitespaceOrControl(value)) {
    return null;
  }
  return value.toLocaleLowerCase();
};

const arxivIdFromUrl = (input: string) => {
  if (!/^https?:\/\//iu.test(input)) return undefined;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  const hostname = url.hostname.toLocaleLowerCase().replace(/^www\./u, "");
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !["arxiv.org", "export.arxiv.org"].includes(hostname)
  ) {
    return null;
  }
  const match = /^\/(?:abs|html|pdf)\/(.+?)\/?$/iu.exec(url.pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/** Accepts bare, prefixed, abstract-page, and PDF-form arXiv identifiers. */
export const normalizeArxivId = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const fromUrl = arxivIdFromUrl(trimmed);
  if (fromUrl === null) return null;
  const value = (fromUrl ?? trimmed)
    .replace(/^arxiv:\s*/iu, "")
    .replace(/\.pdf$/iu, "")
    .replace(/v\d+$/iu, "")
    .toLocaleLowerCase();
  return /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})$/u.test(value) ? value : null;
};

/** Converts a DOI or arXiv input into the canonical DOI used by the registry import path. */
export const normalizePdfArticleReference = (input: unknown): PdfArticleReference | null => {
  const doi = normalizeDoi(input);
  if (doi) {
    const arxivPrefix = "10.48550/arxiv.";
    const arxiv = doi.startsWith(arxivPrefix) ? normalizeArxivId(doi.slice(arxivPrefix.length)) : null;
    return { doi, ...(arxiv ? { arxiv } : {}) };
  }
  const arxiv = normalizeArxivId(input);
  return arxiv ? { arxiv, doi: `10.48550/arxiv.${arxiv}` } : null;
};
