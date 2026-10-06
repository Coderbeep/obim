import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  denied.addSubnet(address, prefix, "ipv6");

export const isPublicAddress = (address: string) => {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !denied.check(address, "ipv6");
};

const abortableLookup = (hostname: string, signal?: AbortSignal) =>
  new Promise<{ address: string; family: number }[]>((resolve, reject) => {
    const abort = () => reject(new Error("Preview cancelled."));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    lookup(hostname, { all: true })
      .then(resolve, () => reject(new Error("Preview destination could not be resolved.")))
      .finally(() => signal?.removeEventListener("abort", abort));
  });

export const resolvePublicDestination = async (input: string, signal?: AbortSignal) => {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Preview URL is not allowed.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (!hostname.includes(":") && !hostname.includes("."))
  )
    throw new Error("Preview destination is not public.");
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await abortableLookup(hostname, signal);
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("Preview destination is not public.");
  return { url, address: addresses[0] };
};

export interface PublicResource {
  bytes: Buffer;
  contentType: string;
  url: string;
}

/** Every redirect is validated; the connected address is pinned to the validated DNS result. */
export const readPublicResource = async (
  input: string,
  options: { signal: AbortSignal; maxBytes: number; accept: string },
): Promise<PublicResource> => {
  let next = input;
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    options.signal.throwIfAborted();
    const { url, address } = await resolvePublicDestination(next, options.signal);
    options.signal.throwIfAborted();
    const result = await new Promise<PublicResource | { location: string }>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          signal: options.signal,
          agent: false,
          family: address.family,
          // Keep hostname/TLS identity but do not resolve again at connect time.
          lookup: (_hostname, _lookupOptions, callback) => callback(null, address.address, address.family),
          headers: { Accept: options.accept, "User-Agent": "Obim/1.0" },
        },
        (response) => {
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
            const location = response.headers.location;
            response.destroy();
            if (!location || redirect === 4) reject(new Error("Preview redirect limit reached."));
            else resolve({ location: new URL(location, url).href });
            return;
          }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            response.destroy();
            reject(new Error("Preview could not be loaded."));
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > options.maxBytes) {
              response.destroy();
              reject(new Error("Preview resource exceeds the size limit."));
            } else chunks.push(Buffer.from(chunk));
          });
          response.on("end", () =>
            resolve({
              bytes: Buffer.concat(chunks),
              contentType: String(response.headers["content-type"] ?? "")
                .split(";")[0]
                .trim()
                .toLowerCase(),
              url: url.href,
            }),
          );
          response.on("error", () => reject(new Error("Preview could not be loaded.")));
        },
      );
      request.on("error", () => reject(new Error("Preview could not be loaded.")));
      request.end();
    });
    if (!("location" in result)) return result;
    next = result.location;
  }
  throw new Error("Preview redirect limit reached.");
};
