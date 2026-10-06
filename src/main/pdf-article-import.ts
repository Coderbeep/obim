import { lookup as lookupAddress } from "node:dns/promises";
import { lstat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { normalizeArxivId, normalizePdfArticleReference, type PdfArticleImportResult } from "@shared/pdf-article-import";
import { isValidFilename } from "@shared/pathUtils";

import ConfigManager from "./app-config";
import { createWorkspaceFileUniquely } from "./workspace-mutations";
import { toFileItem } from "./workspace-files";

const JSON_LIMIT_BYTES = 5 * 1024 * 1024;
const PDF_LIMIT_BYTES = 100 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

type JsonObject = Record<string, unknown>;

type DoiRecord = {
  landingPage?: string;
  pdfCandidates: string[];
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const boundedBody = async (response: Response, limit: number) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) throw new Error("The response is too large.");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("The response is too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const requestJson = async (url: string): Promise<{ response: Response; value?: JsonObject }> => {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Obim/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return { response };
  const bytes = await boundedBody(response, JSON_LIMIT_BYTES);
  return { response, value: JSON.parse(new TextDecoder().decode(bytes)) as JsonObject };
};

const asObject = (value: unknown): JsonObject => (value && typeof value === "object" ? (value as JsonObject) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const doiUrl = (doi: string) => `https://doi.org/${encodeURIComponent(doi)}`;

const crossrefRecord = async (doi: string): Promise<DoiRecord | null> => {
  const { response, value } = await requestJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (response.status === 404) return null;
  if (!response.ok || !value) throw new Error(`Crossref lookup failed (${response.status}).`);
  const message = asObject(value.message);
  const links = asArray(message.link).map(asObject);
  return {
    landingPage: asString(message.URL) || doiUrl(doi),
    pdfCandidates: links
      .filter((link) => asString(link["content-type"]).toLocaleLowerCase() === "application/pdf")
      .map((link) => asString(link.URL))
      .filter(Boolean),
  };
};

const dataciteRecord = async (doi: string): Promise<DoiRecord | null> => {
  const { response, value } = await requestJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
  if (response.status === 404) return null;
  if (!response.ok || !value) throw new Error(`DataCite lookup failed (${response.status}).`);
  const attributes = asObject(asObject(value.data).attributes);
  return {
    landingPage: asString(attributes.url) || doiUrl(doi),
    pdfCandidates: asArray(attributes.contentUrl).map(asString).filter(Boolean),
  };
};

const doiResolverRecord = async (doi: string): Promise<DoiRecord | null> => {
  const response = await fetch(doiUrl(doi), {
    headers: {
      Accept: "application/vnd.citationstyles.csl+json",
      "User-Agent": "Obim/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`DOI lookup failed (${response.status}).`);
  await boundedBody(response, JSON_LIMIT_BYTES);
  return { landingPage: doiUrl(doi), pdfCandidates: [] };
};

const lookupRecord = async (doi: string): Promise<DoiRecord | null> => {
  let lastError: unknown;
  for (const lookup of [crossrefRecord, dataciteRecord, doiResolverRecord]) {
    try {
      const record = await lookup(doi);
      if (record) return record;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
};

const isPrivateIpv4 = (address: string) => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
};

const isPrivateAddress = (address: string) => {
  const type = isIP(address);
  if (type === 4) return isPrivateIpv4(address);
  if (type !== 6) return true;
  const normalized = address.toLocaleLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
};

const assertPublicHttpsUrl = async (input: string) => {
  const upgraded = input.replace(/^http:\/\//iu, "https://");
  const url = new URL(upgraded);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("The PDF URL is not safe.");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost"))
    throw new Error("The PDF URL is not public.");
  const addresses = await lookupAddress(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("The PDF URL does not resolve to a public address.");
  }
  return url;
};

const downloadPdf = async (candidate: string) => {
  let url = await assertPublicHttpsUrl(candidate);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(url, {
      headers: { Accept: "application/pdf", "User-Agent": "Obim/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("The PDF download redirected too many times.");
      url = await assertPublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`PDF download failed (${response.status}).`);
    const bytes = await boundedBody(response, PDF_LIMIT_BYTES);
    const header = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
    if (!header.includes("%PDF-")) throw new Error("The download returned a web page instead of a PDF.");
    return bytes;
  }
  throw new Error("The PDF could not be downloaded.");
};

/** Derives a portable PDF filename from the arXiv id or DOI, since no metadata is stored. */
const portablePdfFilename = (arxiv: string | undefined, doi: string) => {
  const identifier = (arxiv ?? doi).replaceAll(/[/\\<>:"|?*]+/gu, "-").replaceAll(/\s+/gu, "");
  const stem = identifier.replace(/[. ]+$/u, "").slice(0, 150) || "article";
  const filename = `${stem}.pdf`;
  return isValidFilename(filename) ? filename : "article.pdf";
};

export const importPdfArticle = async (input: unknown): Promise<PdfArticleImportResult> => {
  const reference = normalizePdfArticleReference(input);
  if (!reference)
    return { success: false, error: "Enter a valid DOI or arXiv link, such as https://arxiv.org/abs/1706.03762." };
  const { doi } = reference;
  try {
    const record = await lookupRecord(doi);
    const arxiv =
      reference.arxiv ??
      (doi.startsWith("10.48550/arxiv.")
        ? (normalizeArxivId(doi.slice("10.48550/arxiv.".length)) ?? undefined)
        : undefined);
    const candidates = [...(arxiv ? [`https://arxiv.org/pdf/${arxiv}`] : []), ...(record?.pdfCandidates ?? [])].filter(
      (candidate, index, all) => candidate && all.indexOf(candidate) === index,
    );
    let pdfBytes: Uint8Array | null = null;
    for (const candidate of candidates) {
      try {
        pdfBytes = await downloadPdf(candidate);
        break;
      } catch {
        // A DOI registry can advertise authentication or text-mining links that are not direct PDFs.
      }
    }
    if (!pdfBytes) {
      const landingPage = arxiv ? `https://arxiv.org/abs/${arxiv}` : (record?.landingPage ?? undefined);
      return {
        success: false,
        error:
          "No direct PDF was available for this article. Open the article page to download it manually, then add the PDF through Files.",
        ...(landingPage ? { landingPage } : {}),
      };
    }
    const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
    const desiredPath = path.join(workspacePath, portablePdfFilename(arxiv, doi));
    const filePath = await createWorkspaceFileUniquely(desiredPath, pdfBytes);
    const file = toFileItem(filePath, await lstat(filePath), workspacePath);
    if (file.isDirectory) throw new Error("The imported PDF path is not a file.");
    return { success: true, file };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
};
