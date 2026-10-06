import {
  parsePdfReferenceColor,
  parsePdfTextSelection,
  type PdfReferenceColor,
  type PdfTextSelection,
} from "./pdfReference";

export const PDF_DEEP_LINK_EVENT = "obim:pdf-deep-link";

export const pdfReaderId = (paneId: string, resourceKey: string) => JSON.stringify([paneId, resourceKey]);

export interface PdfDeepLink {
  readerId?: string;
  page: number;
  path: string;
  selection?: PdfTextSelection;
  color?: PdfReferenceColor;
  invalidSelection?: boolean;
}

export const parsePdfDeepLink = (value: string): PdfDeepLink | null => {
  const hashIndex = value.lastIndexOf("#");
  if (hashIndex < 0) return null;
  const path = value.slice(0, hashIndex);
  const params = new URLSearchParams(value.slice(hashIndex + 1));
  const pageValue = params.get("page");
  const page = pageValue && /^\d+$/.test(pageValue) ? Number(pageValue) : NaN;
  if (!path || !Number.isSafeInteger(page) || page < 1) return null;
  const selectionValue = params.get("selection");
  const selection = parsePdfTextSelection(selectionValue);
  return {
    path,
    page,
    ...(selection ? { selection } : {}),
    color: parsePdfReferenceColor(params.get("color")),
    ...(selectionValue !== null && !selection ? { invalidSelection: true } : {}),
  };
};

export interface PdfNavigationRequest extends PdfDeepLink {
  requestId: number;
}
const pendingPdfLinks = new Map<string, { request: PdfNavigationRequest; owner?: string }>();
let nextPdfRequestId = 0;
const requestKey = (detail: PdfDeepLink) => JSON.stringify([detail.readerId ?? "", detail.path]);

export const dispatchPdfDeepLink = (detail: PdfDeepLink) => {
  const request = { ...detail, requestId: ++nextPdfRequestId };
  pendingPdfLinks.set(requestKey(detail), { request });
  // Requests can precede a lazy viewer mount; retain only a bounded set of latest destinations.
  if (pendingPdfLinks.size > 128) pendingPdfLinks.delete(pendingPdfLinks.keys().next().value!);
  window.dispatchEvent(new CustomEvent<PdfNavigationRequest>(PDF_DEEP_LINK_EVENT, { detail: request }));
  return request;
};

export const claimPdfDeepLink = (path: string, readerId: string | undefined, owner: string) => {
  const entry =
    pendingPdfLinks.get(requestKey({ path, readerId, page: 1 })) ?? pendingPdfLinks.get(requestKey({ path, page: 1 }));
  if (!entry || (entry.owner && entry.owner !== owner)) return null;
  entry.owner = owner;
  return entry.request;
};

export const finishPdfDeepLink = (request: PdfNavigationRequest) => {
  const key = requestKey(request);
  if (pendingPdfLinks.get(key)?.request.requestId === request.requestId) pendingPdfLinks.delete(key);
};
