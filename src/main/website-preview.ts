import { readPublicResource } from "./public-resource";

export interface WebsitePreviewRequest {
  userInitiated: true;
  requestId: string;
}
export interface WebsitePreview {
  imageDataUrl: string;
  url: string;
}
const active = new Map<string, AbortController>();
const validRequest = (value: unknown): value is WebsitePreviewRequest => {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<WebsitePreviewRequest>;
  return (
    request.userInitiated === true &&
    typeof request.requestId === "string" &&
    /^[a-zA-Z0-9-]{1,100}$/.test(request.requestId)
  );
};
const decodeAttribute = (value: string) =>
  value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const names: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    if (names[entity.toLowerCase()]) return names[entity.toLowerCase()];
    const number =
      entity[2].toLowerCase() === "x" ? Number.parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
  });
const attribute = (tag: string, key: string) => {
  const match = new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? decodeAttribute(match[1] ?? match[2] ?? match[3]) : undefined;
};
const imageCandidates = (html: string, url: string) => {
  const candidates: string[] = [];
  for (const tag of html.match(/<(?:meta|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const property = attribute(tag, "property") ?? attribute(tag, "name");
    const candidate = ["og:image", "twitter:image"].includes(property ?? "")
      ? attribute(tag, "content")
      : /(?:^|\s)icon(?:\s|$)/i.test(attribute(tag, "rel") ?? "")
        ? attribute(tag, "href")
        : undefined;
    if (candidate) {
      try {
        candidates.push(new URL(candidate, url).href);
      } catch {
        /* Ignore malformed metadata. */
      }
    }
  }
  candidates.push(new URL("/favicon.ico", url).href);
  return [...new Set(candidates)].slice(0, 4);
};

/** No preview network activity without an explicit per-link request. Both HTML and images use the same destination policy. */
export const getWebsitePreview = async (
  rawUrl: string,
  request?: unknown,
  signal?: AbortSignal,
): Promise<WebsitePreview | null> => {
  if (!validRequest(request) || typeof rawUrl !== "string" || rawUrl.length > 8192) return null;
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  try {
    const page = await readPublicResource(rawUrl, { signal: boundedSignal, maxBytes: 256 * 1024, accept: "text/html" });
    if (page.contentType !== "text/html") return null;
    for (const candidate of imageCandidates(page.bytes.toString("utf8"), page.url)) {
      try {
        const image = await readPublicResource(candidate, {
          signal: boundedSignal,
          maxBytes: 2 * 1024 * 1024,
          accept: "image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon",
        });
        if (
          !["image/png", "image/jpeg", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"].includes(
            image.contentType,
          )
        )
          continue;
        return { imageDataUrl: `data:${image.contentType};base64,${image.bytes.toString("base64")}`, url: page.url };
      } catch {
        if (boundedSignal.aborted) return null;
      }
    }
  } catch {
    /* No full URL is logged: paths and queries can carry private tokens. */
  }
  return null;
};

export const requestWebsitePreview = async (senderId: number, rawUrl: string, request: unknown) => {
  if (!validRequest(request)) return null;
  const key = `${senderId}:${request.requestId}`;
  if (active.has(key) || active.size >= 20) return null;
  const controller = new AbortController();
  active.set(key, controller);
  try {
    return await getWebsitePreview(rawUrl, request, controller.signal);
  } finally {
    active.delete(key);
  }
};
export const cancelWebsitePreview = (senderId: number, requestId: unknown) => {
  if (typeof requestId === "string") active.get(`${senderId}:${requestId}`)?.abort();
};
export const cancelWebsitePreviewsForSender = (senderId: number) => {
  for (const [key, controller] of active) if (key.startsWith(`${senderId}:`)) controller.abort();
};
