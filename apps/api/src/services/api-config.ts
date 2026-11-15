import { isIP } from "node:net";
import { parse as parsePublicSuffix } from "psl";
import { readTrustedProxies } from "../auth/client-ip.js";

export const API_CONFIG = Symbol("API_CONFIG");

export type ApiConfig = {
  host: string;
  port: number;
  webOrigin: string;
  apiPublicOrigin: string;
  // Origin embedded in viewer and share links. Embeds reuse this same value.
  publicBaseUrl: string;
  authSecret: string;
  authCookieDomain: string | null;
  trustedProxies: readonly string[];
  // HKDF input for share-token encryption. Null derives the key from authSecret.
  shareTokenKey: string | null;
  emailTransport: EmailTransport;
  emailFromAddress: string;
  emailFromName: string;
  // Absolute http(s) logo for the invite. Null uses the text wordmark.
  emailLogoUrl: string | null;
  // True only outside production, and only when EMAIL_LOG_LINKS=full.
  // The log transport otherwise redacts query strings, including reset tokens.
  emailLogFullLinks: boolean;
  // Set only when emailTransport is brevo. Other transports leave this null.
  brevoApiKey: string | null;
  // Set only when emailTransport is smtp. Other transports leave this null.
  smtp: SmtpConfig | null;
};

export type EmailTransport = "log" | "smtp" | "brevo";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  // False allows a plaintext session. The default is true when secure is false.
  requireTls: boolean;
  user: string | null;
  password: string | null;
};

// Used only when EMAIL_TRANSPORT is log and EMAIL_FROM_ADDRESS is unset.
// smtp and brevo require EMAIL_FROM_ADDRESS. The log value is never delivered.
export const LOG_EMAIL_FROM_ADDRESS = "no-reply@localhost";
export const DEFAULT_EMAIL_FROM_NAME = "Factrove";
export const EMAIL_TRANSPORTS = ["log", "smtp", "brevo"] as const;

const DEFAULT_WEB_ORIGIN = "http://localhost:3000";
const DEFAULT_API_ORIGIN = "http://localhost:3001";
const MIN_AUTH_SECRET_LENGTH = 32;

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const webOrigin = readOrigin(env.WEB_ORIGIN, DEFAULT_WEB_ORIGIN, "WEB_ORIGIN");
  const apiPublicOrigin = readOrigin(env.API_PUBLIC_ORIGIN, DEFAULT_API_ORIGIN, "API_PUBLIC_ORIGIN");
  const publicBaseUrl = readPublicBaseUrl(env.PUBLIC_BASE_URL, webOrigin);
  return {
    host: readHost(env.HOST),
    port: readPort(env.PORT),
    webOrigin,
    apiPublicOrigin,
    publicBaseUrl,
    authSecret: readAuthSecret(env.BETTER_AUTH_SECRET),
    authCookieDomain: readCookieDomain(env.AUTH_COOKIE_DOMAIN, webOrigin, apiPublicOrigin, publicBaseUrl),
    trustedProxies: readTrustedProxies(env.TRUSTED_PROXIES),
    shareTokenKey: readShareTokenKey(env.SHARE_TOKEN_KEY),
    ...readEmailConfig(env),
  };
}

function readPublicBaseUrl(value: string | undefined, webOrigin: string): string {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return webOrigin;
  }
  return readOrigin(raw, webOrigin, "PUBLIC_BASE_URL");
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

function readEmailConfig(env: NodeJS.ProcessEnv): Pick<ApiConfig, "emailTransport" | "emailFromAddress" | "emailFromName" | "emailLogoUrl" | "emailLogFullLinks" | "brevoApiKey" | "smtp"> {
  const emailTransport = readEmailTransport(env.EMAIL_TRANSPORT);
  const emailFromName = readEmailFromName(env.EMAIL_FROM_NAME);
  const emailLogoUrl = readEmailLogoUrl(env.EMAIL_LOGO_URL);
  const emailLogFullLinks = readEmailLogFullLinks(env);
  if (emailTransport === "brevo") {
    const brevoApiKey = readRequiredBrevoApiKey(env.BREVO_API_KEY);
    return {
      emailTransport,
      emailFromAddress: readEmailFromAddress(env.EMAIL_FROM_ADDRESS, emailTransport),
      emailFromName,
      emailLogoUrl,
      emailLogFullLinks,
      brevoApiKey,
      smtp: null,
    };
  }
  if (emailTransport === "smtp") {
    const smtp = readSmtpConfig(env);
    return {
      emailTransport,
      emailFromAddress: readEmailFromAddress(env.EMAIL_FROM_ADDRESS, emailTransport),
      emailFromName,
      emailLogoUrl,
      emailLogFullLinks,
      brevoApiKey: null,
      smtp,
    };
  }
  return {
    emailTransport,
    emailFromAddress: readEmailFromAddress(env.EMAIL_FROM_ADDRESS, "log"),
    emailFromName,
    emailLogoUrl,
    emailLogFullLinks,
    brevoApiKey: null,
    smtp: null,
  };
}

function readEmailLogFullLinks(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.EMAIL_LOG_LINKS ?? "").trim().toLowerCase();
  if (raw.length === 0 || raw === "redacted") {
    return false;
  }
  if (raw !== "full") {
    throw new Error("EMAIL_LOG_LINKS must be redacted or full.");
  }
  if ((env.NODE_ENV ?? "").trim() === "production") {
    throw new Error("EMAIL_LOG_LINKS=full is only allowed when NODE_ENV is not production.");
  }
  return true;
}

function readEmailLogoUrl(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("EMAIL_LOGO_URL must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("EMAIL_LOGO_URL must be an absolute HTTP(S) URL.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("EMAIL_LOGO_URL must not include credentials.");
  }
  return raw;
}

function readEmailTransport(value: string | undefined): EmailTransport {
  const transport = value?.trim().toLowerCase() ?? "";
  if (transport.length === 0 || transport === "log") {
    return "log";
  }
  if (transport === "smtp" || transport === "brevo") {
    return transport;
  }
  throw new Error("EMAIL_TRANSPORT must be log, smtp, or brevo.");
}

function readEmailFromAddress(value: string | undefined, transport: EmailTransport): string {
  const email = value?.trim() ?? "";
  if (email.length === 0) {
    if (transport === "log") {
      return LOG_EMAIL_FROM_ADDRESS;
    }
    throw new Error(`Set EMAIL_FROM_ADDRESS when EMAIL_TRANSPORT is ${transport}.`);
  }
  if (!isEmailAddress(email)) {
    throw new Error("EMAIL_FROM_ADDRESS must be an email address.");
  }
  return email;
}

function readEmailFromName(value: string | undefined): string {
  const name = value?.trim() ?? "";
  if (name.length === 0) {
    return DEFAULT_EMAIL_FROM_NAME;
  }
  if (name.length > 70 || /[\r\n]/.test(name)) {
    throw new Error("EMAIL_FROM_NAME must be one line of 1 to 70 characters.");
  }
  return name;
}

function readRequiredBrevoApiKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (key.length === 0) {
    throw new Error("BREVO_API_KEY is required when EMAIL_TRANSPORT is brevo.");
  }
  return key;
}

function readSmtpConfig(env: NodeJS.ProcessEnv): SmtpConfig {
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE"].filter((name) => {
    const value = env[name]?.trim() ?? "";
    return value.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`Set ${missing.join(", ")} when EMAIL_TRANSPORT is smtp.`);
  }
  const host = env.SMTP_HOST?.trim() ?? "";
  if (/[\s/]/.test(host)) {
    throw new Error("SMTP_HOST must be a hostname or IP address.");
  }
  const user = env.SMTP_USER?.trim() ?? "";
  const password = env.SMTP_PASSWORD ?? "";
  const passwordPresent = password.trim().length > 0;
  if ((user.length === 0) !== !passwordPresent) {
    throw new Error("Set SMTP_USER and SMTP_PASSWORD together when EMAIL_TRANSPORT is smtp.");
  }
  const secure = readSmtpSecure(env.SMTP_SECURE);
  return {
    host,
    port: readRequiredPort(env.SMTP_PORT, "SMTP_PORT"),
    secure,
    requireTls: readSmtpRequireTls(env.SMTP_REQUIRE_TLS, secure),
    user: user.length > 0 ? user : null,
    password: passwordPresent ? password : null,
  };
}

function readSmtpRequireTls(value: string | undefined, secure: boolean): boolean {
  const raw = value?.trim().toLowerCase() ?? "";
  if (raw.length === 0) {
    return !secure;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error("SMTP_REQUIRE_TLS must be true or false.");
}

function readSmtpSecure(value: string | undefined): boolean {
  const raw = value?.trim().toLowerCase() ?? "";
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error("SMTP_SECURE must be true or false.");
}

function readRequiredPort(value: string | undefined, name: string): number {
  const raw = value?.trim() ?? "";
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be an integer from 1 to 65535.`);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535.`);
  }
  return port;
}

function isEmailAddress(value: string): boolean {
  // Plus-addresses (name+tag@host) are valid. The local part is everything before @.
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readShareTokenKey(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return null;
  }
  if (raw.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error("SHARE_TOKEN_KEY must be at least 32 characters.");
  }
  return raw;
}

function readCookieDomain(
  value: string | undefined,
  webOrigin: string,
  apiPublicOrigin: string,
  publicBaseUrl: string,
): string | null {
  const raw = value?.trim() ?? "";
  const webHost = new URL(webOrigin).hostname;
  const publicHost = new URL(publicBaseUrl).hostname;
  if (raw.length === 0) {
    if (webHost.toLowerCase() !== publicHost.toLowerCase()) {
      if (cookieDomainCannotCover(webHost) || cookieDomainCannotCover(publicHost)) {
        throw new Error(
          "Use the same host for WEB_ORIGIN and PUBLIC_BASE_URL. A cookie domain cannot cover localhost or an IP address.",
        );
      }
      throw new Error(
        "Set AUTH_COOKIE_DOMAIN to a parent of WEB_ORIGIN and PUBLIC_BASE_URL when those hosts differ.",
      );
    }
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
  const apiHost = new URL(apiPublicOrigin).hostname;
  if (!hostIsAtOrUnder(webHost, domain) || !hostIsAtOrUnder(apiHost, domain) || !hostIsAtOrUnder(publicHost, domain)) {
    throw new Error("AUTH_COOKIE_DOMAIN must cover WEB_ORIGIN, API_PUBLIC_ORIGIN, and PUBLIC_BASE_URL");
  }
  return domain;
}

function cookieDomainCannotCover(host: string): boolean {
  return host.toLowerCase() === "localhost" || isIP(host) !== 0;
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
