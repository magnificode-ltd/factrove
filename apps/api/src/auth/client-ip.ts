import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { isIP, BlockList } from "node:net";

// Better Auth keys its limiter on this header alone. Callers cannot supply it.
export const CLIENT_IP_HEADER = "x-factrove-client-ip";

const TRUSTED_PROXIES_ERROR = "TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDR ranges";

export function readTrustedProxies(value: string | undefined): readonly string[] {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return [];
  }
  const entries = raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.some((entry) => !isTrustedProxyEntry(entry))) {
    throw new Error(TRUSTED_PROXIES_ERROR);
  }
  return entries;
}

export function assignClientIp(request: IncomingMessage, trustedProxies: readonly string[]): void {
  delete request.headers[CLIENT_IP_HEADER];
  const clientIp = resolveClientIp(request.socket?.remoteAddress, headerValue(request.headers, "x-forwarded-for"), trustedProxies);
  if (clientIp) {
    request.headers[CLIENT_IP_HEADER] = clientIp;
  }
}

export function resolveClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | undefined,
  trustedProxies: readonly string[],
): string | null {
  const peer = remoteAddress ? normalizeClientIp(remoteAddress) : null;
  if (!peer) {
    return null;
  }
  if (trustedProxies.length === 0) {
    return peer;
  }
  const trusted = compileTrustedProxies(trustedProxies);
  if (!isTrustedAddress(peer, trusted)) {
    return peer;
  }
  return clientFromForwarded(forwardedFor, trusted) ?? peer;
}

export function normalizeClientIp(value: string): string | null {
  const trimmed = value.trim();
  if (isIP(trimmed) === 4) {
    return trimmed;
  }
  if (isIP(trimmed) !== 6) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const mappedPrefix = "::ffff:";
  if (lower.startsWith(mappedPrefix)) {
    const mapped = lower.slice(mappedPrefix.length);
    if (isIP(mapped) === 4) {
      return mapped;
    }
  }
  return lower;
}

function clientFromForwarded(value: string | undefined, trusted: BlockList): string | null {
  if (!value) {
    return null;
  }
  const hops = value.split(",").map((hop) => hop.trim()).filter((hop) => hop.length > 0);
  if (hops.length === 0) {
    return null;
  }
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = normalizeClientIp(hops[index] ?? "");
    if (!hop) {
      return null;
    }
    if (isTrustedAddress(hop, trusted)) {
      continue;
    }
    return hop;
  }
  return null;
}

function compileTrustedProxies(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const slash = entry.lastIndexOf("/");
    const address = slash === -1 ? entry : entry.slice(0, slash);
    const version = isIP(address);
    const family = version === 4 ? "ipv4" : "ipv6";
    if (slash === -1) {
      const normalized = normalizeClientIp(address);
      if (!normalized) {
        continue;
      }
      list.addAddress(normalized, isIP(normalized) === 4 ? "ipv4" : "ipv6");
      continue;
    }
    list.addSubnet(address, Number(entry.slice(slash + 1)), family);
  }
  return list;
}

function isTrustedAddress(ip: string, list: BlockList): boolean {
  return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
}

function isTrustedProxyEntry(entry: string): boolean {
  const slash = entry.lastIndexOf("/");
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const version = isIP(address);
  if (version === 0) {
    return false;
  }
  if (slash === -1) {
    return true;
  }
  const prefixText = entry.slice(slash + 1);
  if (!/^\d+$/.test(prefixText)) {
    return false;
  }
  const prefix = Number(prefixText);
  return prefix <= (version === 4 ? 32 : 128);
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return undefined;
}
