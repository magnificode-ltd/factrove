import { createHash, randomBytes } from "node:crypto";

// 32 bytes, base64url, no padding. The artifact id is not a substitute for this secret.
export const SHARE_TOKEN_BYTES = 32;

export function createShareToken(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

export function isShareToken(value: string): boolean {
  return value.length === 43 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function artifactViewerUrl(publicBaseUrl: string, artifactId: string): string {
  return `${publicBaseUrl}/artifacts/${artifactId}`;
}

export function artifactShareUrl(publicBaseUrl: string, artifactId: string, token: string): string {
  return `${publicBaseUrl}/share/${artifactId}/${token}`;
}

export function publicContentUrl(apiPublicOrigin: string, artifactId: string, token: string): string {
  return `${apiPublicOrigin}/api/v1/public/artifacts/${artifactId}/${token}/content`;
}
