import { CliError } from "./cli-error.js";

export type FactroveScope = "mine" | "org";

export type FactroveUri = {
  scope: FactroveScope;
  key: string | undefined;
};

// Same shape as the API UUID check: RFC 4122 versions 1-8, plus the nil and max UUIDs.
const ARTIFACT_ID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

const HTML_SUFFIX = /\.html$/i;

export function isArtifactId(value: string): boolean {
  return ARTIFACT_ID.test(value);
}

export function artifactIdFromKey(key: string): string | undefined {
  const bare = HTML_SUFFIX.test(key) ? key.slice(0, -".html".length) : key;
  return isArtifactId(bare) ? bare : undefined;
}

export function factroveUri(scope: FactroveScope, id?: string): string {
  return id === undefined ? `factrove://${scope}/` : `factrove://${scope}/${id}`;
}

export function isFactroveUri(value: string): boolean {
  return value.toLowerCase().startsWith("factrove://");
}

export function parseFactroveUri(value: string): FactroveUri {
  if (!value.toLowerCase().startsWith("factrove://")) {
    throw new CliError("INVALID_INPUT", `Expected a factrove:// URI. Received '${value}'.`);
  }
  const rest = value.slice("factrove://".length);
  if (rest.includes("?") || rest.includes("#")) {
    throw new CliError("INVALID_INPUT", "A factrove URI does not take a query or hash.");
  }
  if (rest.includes("@")) {
    throw new CliError("INVALID_INPUT", "A factrove URI does not take a username or password.");
  }
  const slash = rest.indexOf("/");
  const scopeRaw = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash + 1);
  const scope = scopeRaw.toLowerCase();
  if (scope !== "mine" && scope !== "org") {
    throw new CliError("INVALID_INPUT", `The scope must be mine or org. Received '${scopeRaw || "(empty)"}'.`);
  }
  if (path.endsWith("/")) {
    throw new CliError("INVALID_INPUT", "A factrove key cannot end with '/'. Factrove has no prefixes.");
  }
  if (path.includes("/")) {
    throw new CliError("INVALID_INPUT", "An artifact key cannot contain '/'. Address an artifact by its id.");
  }
  if (path.length === 0) {
    return { scope, key: undefined };
  }
  let key: string;
  try {
    key = decodeURIComponent(path);
  } catch {
    throw new CliError("INVALID_INPUT", "The artifact key is not valid percent-encoding.");
  }
  if (key.length === 0 || key.includes("/") || key.includes("\\")) {
    throw new CliError("INVALID_INPUT", "An artifact key cannot contain '/'.");
  }
  return { scope, key };
}
