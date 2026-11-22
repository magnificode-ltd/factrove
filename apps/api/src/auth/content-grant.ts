import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_SECONDS = 60;
export const CONTENT_GRANT_TTL_SECONDS = 5 * 60;
const GRANT_DOMAIN = "factrove:content-grant:v2";
const GRANT_VERSION = "v2";
const MAX_GRANT_LENGTH = 2048;
const MAX_ID_LENGTH = 256;

export type ContentGrantIssuer = {
  userId: string;
  sessionId: string;
};

export type ContentGrantClaims = ContentGrantIssuer & {
  artifactId: string;
  contentRevision: number;
};

export function mintContentGrant(claims: ContentGrantClaims, secret: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS + CONTENT_GRANT_TTL_SECONDS;
  const body = encodeBody({
    exp,
    userId: claims.userId,
    sessionId: claims.sessionId,
    contentRevision: claims.contentRevision,
  });
  const signature = signGrant(claims.artifactId, body, secret);
  return `${GRANT_VERSION}.${body}.${signature}`;
}

// Returns the issuing user and session when the signature, expiry, artifact,
// and content revision all match. The caller still has to check that the
// session row is live and that the user can still read the artifact.
export function contentGrantAllows(
  token: string,
  artifactId: string,
  contentRevision: number,
  secret: string,
  nowMs = Date.now(),
): ContentGrantIssuer | null {
  if (token.length === 0 || token.length > MAX_GRANT_LENGTH) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== GRANT_VERSION) {
    return null;
  }
  const body = parts[1] ?? "";
  const given = parts[2] ?? "";
  if (body.length === 0 || given.length === 0) {
    return null;
  }
  const expected = signGrant(artifactId, body, secret);
  const expectedBytes = Buffer.from(expected);
  const givenBytes = Buffer.from(given);
  if (expectedBytes.length === 0 || expectedBytes.length !== givenBytes.length) {
    return null;
  }
  if (!timingSafeEqual(expectedBytes, givenBytes)) {
    return null;
  }
  const parsed = parseBody(body);
  if (!parsed || parsed.contentRevision !== contentRevision) {
    return null;
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (parsed.exp > nowSeconds + CONTENT_GRANT_TTL_SECONDS + WINDOW_SECONDS) {
    return null;
  }
  if (parsed.exp <= nowSeconds) {
    return null;
  }
  return { userId: parsed.userId, sessionId: parsed.sessionId };
}

export function artifactContentUrl(origin: string, artifactId: string): string {
  return `${origin}/api/v1/artifacts/${artifactId}/content`;
}

export function grantedContentUrl(
  origin: string,
  claims: ContentGrantClaims,
  secret: string,
  nowMs = Date.now(),
): string {
  const token = mintContentGrant(claims, secret, nowMs);
  return `${artifactContentUrl(origin, claims.artifactId)}?access=${encodeURIComponent(token)}`;
}

function signGrant(artifactId: string, body: string, secret: string): string {
  return createHmac("sha256", grantKey(secret)).update(`${artifactId}.${body}`).digest("base64url");
}

function grantKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(GRANT_DOMAIN).digest();
}

type GrantBody = {
  exp: number;
  userId: string;
  sessionId: string;
  contentRevision: number;
};

function encodeBody(body: GrantBody): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function parseBody(body: string): GrantBody | null {
  let text: string;
  try {
    text = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as { exp?: unknown; userId?: unknown; sessionId?: unknown; contentRevision?: unknown };
  if (typeof record.exp !== "number" || !Number.isSafeInteger(record.exp)) {
    return null;
  }
  if (!isGrantId(record.userId) || !isGrantId(record.sessionId)) {
    return null;
  }
  if (typeof record.contentRevision !== "number" || !Number.isSafeInteger(record.contentRevision) || record.contentRevision < 0) {
    return null;
  }
  return {
    exp: record.exp,
    userId: record.userId,
    sessionId: record.sessionId,
    contentRevision: record.contentRevision,
  };
}

function isGrantId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}
