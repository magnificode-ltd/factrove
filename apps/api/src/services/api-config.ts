export const API_CONFIG = Symbol("API_CONFIG");

export type ApiConfig = {
  host: string;
  port: number;
  webOrigin: string;
  apiPublicOrigin: string;
  localUserId: string;
  localOrganizationId: string | null;
};

const DEFAULT_WEB_ORIGIN = "http://localhost:3000";
const DEFAULT_API_ORIGIN = "http://localhost:3001";
const DEFAULT_LOCAL_USER_ID = "local-user";

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: readHost(env.HOST),
    port: readPort(env.PORT),
    webOrigin: readOrigin(env.WEB_ORIGIN, DEFAULT_WEB_ORIGIN, "WEB_ORIGIN"),
    apiPublicOrigin: readOrigin(env.API_PUBLIC_ORIGIN, DEFAULT_API_ORIGIN, "API_PUBLIC_ORIGIN"),
    localUserId: readLocalUserId(env.LOCAL_USER_ID),
    localOrganizationId: readOptionalId(env.LOCAL_ORGANIZATION_ID),
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

function readLocalUserId(value: string | undefined): string {
  const userId = value?.trim() ?? "";
  return userId.length > 0 ? userId : DEFAULT_LOCAL_USER_ID;
}

function readOptionalId(value: string | undefined): string | null {
  const id = value?.trim() ?? "";
  return id.length > 0 ? id : null;
}
