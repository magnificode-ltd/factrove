import { isIP } from "node:net";
import { parse as parsePublicSuffix } from "psl";
import { readTrustedProxies } from "../auth/client-ip.js";

export const API_CONFIG = Symbol("API_CONFIG");

export type ApiConfig = {
  host: string;
  port: number;
  webOrigin: string;
  apiPublicOrigin: string;
  authSecret: string;
  authCookieDomain: string | null;
  trustedProxies: readonly string[];
};

const DEFAULT_WEB_ORIGIN = "http://localhost:3000";
const DEFAULT_API_ORIGIN = "http://localhost:3001";
const MIN_AUTH_SECRET_LENGTH = 32;

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const webOrigin = readOrigin(env.WEB_ORIGIN, DEFAULT_WEB_ORIGIN, "WEB_ORIGIN");
  const apiPublicOrigin = readOrigin(env.API_PUBLIC_ORIGIN, DEFAULT_API_ORIGIN, "API_PUBLIC_ORIGIN");
  return {
    host: readHost(env.HOST),
    port: readPort(env.PORT),
    webOrigin,
    apiPublicOrigin,
    authSecret: readAuthSecret(env.BETTER_AUTH_SECRET),
    authCookieDomain: readCookieDomain(env.AUTH_COOKIE_DOMAIN, webOrigin, apiPublicOrigin),
    trustedProxies: readTrustedProxies(env.TRUSTED_PROXIES),
  };
}

function readHost(value: string | undefined): string {
  const host = value?.trim() ?? "";
  return host.length > 0 ? host : "127.0.0.1";
}

function readPort(value: string | undefined): number {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return 3001;
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}

function readOrigin(value: string | undefined, fallback: string, name: string): string {
  const raw = value?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${name} must not include credentials`);
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(`${name} must be an origin without a path, query, or hash`);
  }
  return url.origin;
}

function readCookieDomain(value: string | undefined, webOrigin: string, apiPublicOrigin: string): string | null {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return null;
  }
  const domain = (raw.startsWith(".") ? raw.slice(1) : raw).toLowerCase();
  if (isIP(domain) !== 0) {
    throw new Error("AUTH_COOKIE_DOMAIN must be a domain name, not an IP address");
  }
  const labels = domain.split(".");
  const valid = labels.length >= 2
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!valid || domain.length > 253) {
    throw new Error("AUTH_COOKIE_DOMAIN must be a parent domain such as factrove.example.com");
  }
  const parsed = parsePublicSuffix(domain);
  if ("error" in parsed || parsed.domain === null) {
    throw new Error("AUTH_COOKIE_DOMAIN must be a registrable domain, not a public suffix");
  }
  const webHost = new URL(webOrigin).hostname;
  const apiHost = new URL(apiPublicOrigin).hostname;
  if (!hostIsAtOrUnder(webHost, domain) || !hostIsAtOrUnder(apiHost, domain)) {
    throw new Error("AUTH_COOKIE_DOMAIN must be WEB_ORIGIN and API_PUBLIC_ORIGIN or a parent of both");
  }
  return domain;
}

function hostIsAtOrUnder(host: string, domain: string): boolean {
  const normalized = host.toLowerCase().replace(/\.+$/, "");
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

function readAuthSecret(value: string | undefined): string {
  const secret = value?.trim() ?? "";
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
  }
  return secret;
}
