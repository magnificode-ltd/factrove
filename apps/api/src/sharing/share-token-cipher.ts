import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = "v1.";
const HKDF_SALT = "factrove-share-token-v1";
const HKDF_INFO = "factrove share token";

// SHARE_TOKEN_KEY when set, otherwise BETTER_AUTH_SECRET. Rotating the chosen input
// revokes stored links: public lookup decrypts with the current key. Share again afterward.
export function deriveShareTokenKey(material: string): Buffer {
  return Buffer.from(hkdfSync("sha256", material, HKDF_SALT, HKDF_INFO, KEY_BYTES));
}

export function encryptShareToken(token: string, key: Buffer, artifactId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(artifactId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, ciphertext, tag]).toString("base64url")}`;
}

export function decryptShareToken(stored: string, key: Buffer, artifactId: string): string | null {
  if (!stored.startsWith(PREFIX)) {
    return null;
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(stored.slice(PREFIX.length), "base64url");
  } catch {
    return null;
  }
  if (bytes.length <= IV_BYTES + TAG_BYTES) {
    return null;
  }
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(bytes.length - TAG_BYTES);
  const ciphertext = bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(artifactId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
