import * as nodeCrypto from "node:crypto";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ARGON2_UNAVAILABLE_MESSAGE =
  "Share-link passwords need Node.js 24.7.0 or later because they use crypto.argon2. This process is running an older Node.";

type CryptoWithArgon2 = { argon2?: unknown };

export function assertSharePasswordSupport(cryptoImpl: CryptoWithArgon2 = nodeCrypto): void {
  if (typeof cryptoImpl.argon2 !== "function") {
    throw new Error(ARGON2_UNAVAILABLE_MESSAGE);
  }
}

// Argon2id with the OWASP baseline: 19 MiB, two passes, one lane.
// The parameters are stored in the PHC string, so a later change still verifies old hashes.
export const SHARE_PASSWORD_ARGON2 = {
  memoryKiB: 19_456,
  passes: 2,
  parallelism: 1,
  saltBytes: 16,
  tagBytes: 32,
} as const;

const ARGON2_VERSION = 19;
// Stored parameters outside these bounds are treated as unreadable rather than run.
const MAX_MEMORY_KIB = 262_144;
const MAX_PASSES = 10;
const MAX_PARALLELISM = 4;

type Argon2Parameters = {
  memoryKiB: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
};

export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(SHARE_PASSWORD_ARGON2.saltBytes);
  const tag = await deriveTag(normalizeSharePassword(password), {
    memoryKiB: SHARE_PASSWORD_ARGON2.memoryKiB,
    passes: SHARE_PASSWORD_ARGON2.passes,
    parallelism: SHARE_PASSWORD_ARGON2.parallelism,
    salt,
    tagBytes: SHARE_PASSWORD_ARGON2.tagBytes,
  });
  return [
    "",
    "argon2id",
    `v=${ARGON2_VERSION}`,
    `m=${SHARE_PASSWORD_ARGON2.memoryKiB},t=${SHARE_PASSWORD_ARGON2.passes},p=${SHARE_PASSWORD_ARGON2.parallelism}`,
    salt.toString("base64").replace(/=+$/, ""),
    tag.toString("base64").replace(/=+$/, ""),
  ].join("$");
}

// Compares derived tags with timingSafeEqual. An unreadable stored value never matches.
export async function verifySharePassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return false;
  }
  const derived = await deriveTag(normalizeSharePassword(password), {
    memoryKiB: parsed.memoryKiB,
    passes: parsed.passes,
    parallelism: parsed.parallelism,
    salt: parsed.salt,
    tagBytes: parsed.tag.length,
  });
  return derived.length === parsed.tag.length && timingSafeEqual(derived, parsed.tag);
}

// Grants bind to this value. A new password, even the same text, has a new salt and a new fingerprint.
export function sharePasswordFingerprint(stored: string): string {
  return createHash("sha256").update(stored).digest("base64url");
}

export function isArgon2idHash(stored: string): boolean {
  return parseStoredHash(stored) !== null;
}

function normalizeSharePassword(password: string): string {
  return password.normalize("NFC");
}

function deriveTag(
  password: string,
  options: { memoryKiB: number; passes: number; parallelism: number; salt: Buffer; tagBytes: number },
): Promise<Buffer> {
  assertSharePasswordSupport();
  return new Promise((resolve, reject) => {
    nodeCrypto.argon2(
      "argon2id",
      {
        message: Buffer.from(password, "utf8"),
        nonce: options.salt,
        parallelism: options.parallelism,
        tagLength: options.tagBytes,
        memory: options.memoryKiB,
        passes: options.passes,
      },
      (error, derived) => {
        if (error) {
          reject(new Error("Could not derive the share password hash."));
          return;
        }
        resolve(derived);
      },
    );
  });
}

function parseStoredHash(stored: string): Argon2Parameters | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "" || parts[1] !== "argon2id" || parts[2] !== `v=${ARGON2_VERSION}`) {
    return null;
  }
  const params = /^m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})$/.exec(parts[3] ?? "");
  if (!params) {
    return null;
  }
  const memoryKiB = Number(params[1]);
  const passes = Number(params[2]);
  const parallelism = Number(params[3]);
  if (
    parallelism < 1
    || parallelism > MAX_PARALLELISM
    || passes < 1
    || passes > MAX_PASSES
    || memoryKiB < 8 * parallelism
    || memoryKiB > MAX_MEMORY_KIB
  ) {
    return null;
  }
  const salt = decodeBase64(parts[4] ?? "");
  const tag = decodeBase64(parts[5] ?? "");
  if (!salt || !tag || salt.length < 8 || tag.length < 16 || tag.length > 64) {
    return null;
  }
  return { memoryKiB, passes, parallelism, salt, tag };
}

function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+$/.test(value)) {
    return null;
  }
  return Buffer.from(value, "base64");
}
