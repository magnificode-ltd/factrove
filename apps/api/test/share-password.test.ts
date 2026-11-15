import { createShareRequestSchema, sharePasswordSchema, SHARE_PASSWORD_MIN_UNIQUE } from "@factrove/contracts";
import { describe, expect, it } from "vitest";
import { Argon2VerifyGate } from "../src/sharing/argon2-gate.js";
import {
  PasswordAttemptLimiter,
  PASSWORD_ATTEMPT_WINDOW_MS,
  PASSWORD_ATTEMPTS_PER_SHARE,
  SHARE_DELAY_MAX_MS,
  VERIFY_ATTEMPTS_PER_MINUTE,
} from "../src/sharing/password-attempt-limit.js";
import { RateWindow } from "../src/sharing/rate-window.js";
import { PublicViewLimiter } from "../src/sharing/public-view-limit.js";
import { ARGON2_UNAVAILABLE_MESSAGE, assertSharePasswordSupport } from "../src/sharing/share-password.js";
import {
  deriveShareGrantKey,
  mintShareGrant,
  mintShareTicket,
  readShareTicket,
  SHARE_GRANT_TTL_SECONDS,
  SHARE_TICKET_MAX_USES,
  SHARE_TICKET_TTL_SECONDS,
  shareGrantAllows,
  ShareTicketLedger,
  type ShareGrantScope,
} from "../src/sharing/share-grant.js";
import { ticketedContentUrl } from "../src/sharing/share-link.js";
import {
  hashSharePassword,
  isArgon2idHash,
  SHARE_PASSWORD_ARGON2,
  sharePasswordFingerprint,
  verifySharePassword,
} from "../src/sharing/share-password.js";

const artifactId = "123e4567-e89b-42d3-a456-426614174000";
const otherArtifactId = "123e4567-e89b-42d3-a456-426614174001";

describe("share password KDF", () => {
  it("stores an Argon2id PHC string with a fresh salt and never the plaintext", async () => {
    const password = "correct horse battery";
    const first = await hashSharePassword(password);
    const second = await hashSharePassword(password);
    const { memoryKiB, passes, parallelism } = SHARE_PASSWORD_ARGON2;
    expect(first).toMatch(new RegExp(`^\\$argon2id\\$v=19\\$m=${memoryKiB},t=${passes},p=${parallelism}\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$`));
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(first).not.toContain(Buffer.from(password).toString("base64").replace(/=+$/, ""));
    expect(isArgon2idHash(first)).toBe(true);
    expect(memoryKiB).toBeGreaterThanOrEqual(19_456);
    expect(passes).toBeGreaterThanOrEqual(2);
  });

  it("verifies only the exact password", async () => {
    const stored = await hashSharePassword("correct horse battery");
    await expect(verifySharePassword("correct horse battery", stored)).resolves.toBe(true);
    await expect(verifySharePassword("correct horse batter", stored)).resolves.toBe(false);
    await expect(verifySharePassword("Correct horse battery", stored)).resolves.toBe(false);
    await expect(verifySharePassword("correct horse battery ", stored)).resolves.toBe(false);
    await expect(verifySharePassword("", stored)).resolves.toBe(false);
  });

  it("handles non-ASCII passwords", async () => {
    const stored = await hashSharePassword("pässwörd-🔐-ключ");
    await expect(verifySharePassword("pässwörd-🔐-ключ", stored)).resolves.toBe(true);
    await expect(verifySharePassword("passwörd-🔐-ключ", stored)).resolves.toBe(false);
  });

  it("normalises passwords to NFC before hashing so macOS and Windows agree", async () => {
    const nfc = "café-gate".normalize("NFC");
    const nfd = "café-gate".normalize("NFD");
    expect(nfc).not.toBe(nfd);
    const stored = await hashSharePassword(nfd);
    await expect(verifySharePassword(nfc, stored)).resolves.toBe(true);
    await expect(verifySharePassword(nfd, stored)).resolves.toBe(true);
  });

  it("fails at boot with a readable message when Argon2 is missing", () => {
    expect(() => assertSharePasswordSupport({ argon2: undefined })).toThrow(ARGON2_UNAVAILABLE_MESSAGE);
    expect(() => assertSharePasswordSupport()).not.toThrow();
  });

  it("refuses unreadable or out-of-range stored values instead of running them", async () => {
    const stored = await hashSharePassword("correct horse battery");
    const parts = stored.split("$");
    const variants = [
      "",
      "plaintext",
      stored.replace("argon2id", "argon2i"),
      stored.replace("v=19", "v=16"),
      [...parts.slice(0, 3), "m=999999999,t=2,p=1", ...parts.slice(4)].join("$"),
      [...parts.slice(0, 3), "m=19456,t=99,p=1", ...parts.slice(4)].join("$"),
      [...parts.slice(0, 3), "m=19456,t=2,p=9", ...parts.slice(4)].join("$"),
      [...parts.slice(0, 5), "short"].join("$"),
      [...parts.slice(0, 5), "!!!!"].join("$"),
    ];
    for (const variant of variants) {
      expect(isArgon2idHash(variant)).toBe(false);
      await expect(verifySharePassword("correct horse battery", variant)).resolves.toBe(false);
    }
  });

  it("detects a tampered tag of the same length", async () => {
    const stored = await hashSharePassword("correct horse battery");
    const tag = stored.slice(stored.lastIndexOf("$") + 1);
    const flipped = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    const tampered = `${stored.slice(0, stored.lastIndexOf("$") + 1)}${flipped}`;
    await expect(verifySharePassword("correct horse battery", tampered)).resolves.toBe(false);
  });

  it("fingerprints each stored hash, so the same password set again gets a new fingerprint", async () => {
    const first = await hashSharePassword("correct horse battery");
    const second = await hashSharePassword("correct horse battery");
    expect(sharePasswordFingerprint(first)).toBe(sharePasswordFingerprint(first));
    expect(sharePasswordFingerprint(first)).not.toBe(sharePasswordFingerprint(second));
    expect(sharePasswordFingerprint(first)).not.toContain("correct");
  });
});

describe("password attempt throttling", () => {
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);

  it("limits each client address and keeps clients apart, including by IPv6 /64", () => {
    let now = 0;
    const limiter = new PasswordAttemptLimiter(3, 100, 60_000, () => now);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.reserveClient("198.51.100.1")).toBeTruthy();
    }
    expect(limiter.reserveClient("198.51.100.1")).toBeNull();
    expect(limiter.reserveClient("198.51.100.2")).toBeTruthy();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(limiter.reserveClient(`2001:db8:1:2::${attempt + 1}`)).toBeTruthy();
    }
    expect(limiter.reserveClient("2001:db8:1:2:ffff::9")).toBeNull();
    expect(limiter.reserveClient("2001:db8:1:3::1")).toBeTruthy();
    now = 120_001;
    expect(limiter.reserveClient("198.51.100.1")).toBeTruthy();
  });

  it("refunds a client slot so a later reserve can succeed", () => {
    const now = 0;
    const limiter = new PasswordAttemptLimiter(1, 100, 60_000, () => now);
    const charge = limiter.reserveClient("198.51.100.9");
    expect(charge).toBeTruthy();
    expect(limiter.reserveClient("198.51.100.9")).toBeNull();
    limiter.refundClient(charge!);
    expect(limiter.reserveClient("198.51.100.9")).toBeTruthy();
  });

  it("records confirmed share failures atomically and keeps shares apart", () => {
    let now = 0;
    const limiter = new PasswordAttemptLimiter(100, 4, 60_000, () => now);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(limiter.reserveClient(`203.0.113.${attempt}`)).toBeTruthy();
      expect(limiter.shareHasRoom(firstHash)).toBe(true);
      expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
      limiter.confirmShareFailure(firstHash);
    }
    expect(limiter.reserveClient("203.0.113.200")).toBeTruthy();
    expect(limiter.shareHasRoom(firstHash)).toBe(false);
    expect(limiter.beginShareCheck(firstHash)).toBe("locked");
    expect(limiter.shareHasRoom(secondHash)).toBe(true);
    expect(limiter.beginShareCheck(secondHash)).toBe("admitted");
    limiter.confirmShareFailure(secondHash);
    now = 30_000;
    expect(limiter.shareHasRoom(firstHash)).toBe(false);
    now = 120_001;
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
  });

  it("releases an in-flight check so a correct unlock does not spend the cap", () => {
    const limiter = new PasswordAttemptLimiter(100, 1, 60_000, () => 0);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    expect(limiter.beginShareCheck(firstHash)).toBe("busy");
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
    limiter.releaseShareCheck(firstHash);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    limiter.confirmShareFailure(firstHash);
    expect(limiter.shareHasRoom(firstHash)).toBe(false);
    expect(limiter.beginShareCheck(firstHash)).toBe("locked");
  });

  it("keeps pending checks out of delay, lockout, and Retry-After", () => {
    const limiter = new PasswordAttemptLimiter(100, PASSWORD_ATTEMPTS_PER_SHARE, 60_000, () => 0, 10_000, SHARE_DELAY_MAX_MS);
    const admissions = Array.from({ length: 40 }, () => limiter.beginShareCheck(firstHash));
    expect(admissions.filter((status) => status === "admitted")).toHaveLength(PASSWORD_ATTEMPTS_PER_SHARE);
    expect(admissions.filter((status) => status === "busy")).toHaveLength(10);
    expect(admissions).not.toContain("locked");
    expect(limiter.sharePending(firstHash)).toBe(PASSWORD_ATTEMPTS_PER_SHARE);
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
    expect(limiter.shareDelayMs(firstHash)).toBe(0);
    expect(limiter.shareRetryAfterSeconds(firstHash)).toBe(0);
    limiter.releaseShareCheck(firstHash);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    expect(limiter.sharePending(firstHash)).toBe(PASSWORD_ATTEMPTS_PER_SHARE);
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
  });

  it("admits one more check after twenty-nine failures and treats extra in-flight as busy", () => {
    const limiter = new PasswordAttemptLimiter();
    for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_SHARE - 1; attempt += 1) {
      expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
      limiter.confirmShareFailure(firstHash);
    }
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    expect(limiter.sharePending(firstHash)).toBe(1);
    for (let extra = 0; extra < 15; extra += 1) {
      expect(limiter.beginShareCheck(firstHash)).toBe("busy");
    }
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
    expect(limiter.shareDelayMs(firstHash)).toBeGreaterThan(0);
    limiter.releaseShareCheck(firstHash);
    expect(limiter.sharePending(firstHash)).toBe(0);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    limiter.confirmShareFailure(firstHash);
    expect(limiter.shareHasRoom(firstHash)).toBe(false);
    expect(limiter.beginShareCheck(firstHash)).toBe("locked");
  });

  it("converts a pending check to a confirmed failure only after a wrong guess", () => {
    const limiter = new PasswordAttemptLimiter(100, 2, 60_000, () => 0, 10_000, SHARE_DELAY_MAX_MS);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    limiter.confirmShareFailure(firstHash);
    expect(limiter.sharePending(firstHash)).toBe(0);
    expect(limiter.shareDelayMs(firstHash)).toBeGreaterThan(0);
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    expect(limiter.beginShareCheck(firstHash)).toBe("busy");
    limiter.confirmShareFailure(firstHash);
    expect(limiter.shareHasRoom(firstHash)).toBe(false);
    expect(limiter.beginShareCheck(firstHash)).toBe("locked");
    expect(limiter.shareRetryAfterSeconds(firstHash)).toBeGreaterThanOrEqual(1);
  });

  it("delays a share from confirmed failures without rejecting, and the delay decays", () => {
    let now = 0;
    const limiter = new PasswordAttemptLimiter(100, PASSWORD_ATTEMPTS_PER_SHARE, 60_000, () => now, 10_000, SHARE_DELAY_MAX_MS);
    expect(limiter.shareDelayMs(firstHash)).toBe(0);
    expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
    limiter.confirmShareFailure(firstHash);
    expect(limiter.shareDelayMs(firstHash)).toBeGreaterThan(0);
    expect(limiter.shareDelayMs(firstHash)).toBeLessThanOrEqual(SHARE_DELAY_MAX_MS);
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
    for (let attempt = 1; attempt < PASSWORD_ATTEMPTS_PER_SHARE; attempt += 1) {
      expect(limiter.beginShareCheck(firstHash)).toBe("admitted");
      limiter.confirmShareFailure(firstHash);
    }
    expect(limiter.shareDelayMs(firstHash)).toBe(SHARE_DELAY_MAX_MS);
    expect(limiter.shareHasRoom(firstHash)).toBe(false);
    expect(limiter.shareDelayMs(secondHash)).toBe(0);
    now = 120_001;
    expect(limiter.shareHasRoom(firstHash)).toBe(true);
    expect(limiter.shareDelayMs(firstHash)).toBe(0);
  });

  it("counts every verify on the per-IP budget and does not refund it", () => {
    let now = 0;
    const limiter = new PasswordAttemptLimiter(100, 100, 60_000, () => now, 10_000, 0, 3, 60_000, 5, 600_000);
    expect(limiter.reserveVerify("198.51.100.1")).toBe(true);
    expect(limiter.reserveVerify("198.51.100.1")).toBe(true);
    expect(limiter.reserveVerify("198.51.100.1")).toBe(true);
    expect(limiter.reserveVerify("198.51.100.1")).toBe(false);
    expect(limiter.verifyRetryAfterSeconds("198.51.100.1")).toBeGreaterThanOrEqual(1);
    expect(limiter.reserveVerify("198.51.100.2")).toBe(true);
    now = 60_001;
    expect(limiter.reserveVerify("198.51.100.1")).toBe(true);
  });

  it("allows only one concurrent verify per IP", () => {
    const limiter = new PasswordAttemptLimiter();
    expect(limiter.tryBeginVerify("198.51.100.1")).toBe(true);
    expect(limiter.tryBeginVerify("198.51.100.1")).toBe(false);
    expect(limiter.tryBeginVerify("198.51.100.2")).toBe(true);
    limiter.endVerify("198.51.100.1");
    expect(limiter.tryBeginVerify("198.51.100.1")).toBe(true);
  });

  it("uses the default verify minute budget", () => {
    expect(VERIFY_ATTEMPTS_PER_MINUTE).toBe(20);
  });

  it("uses a ten minute window by default", () => {
    expect(PASSWORD_ATTEMPT_WINDOW_MS).toBe(600_000);
    let now = 0;
    const limiter = new PasswordAttemptLimiter(undefined, undefined, undefined, () => now);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.reserveClient("192.0.2.10")).toBeTruthy();
    }
    expect(limiter.reserveClient("192.0.2.10")).toBeNull();
    now = 600_000 * 2 + 1;
    expect(limiter.reserveClient("192.0.2.10")).toBeTruthy();
  });

  it("does not share buckets with the public view limit", () => {
    const now = () => 0;
    const views = new PublicViewLimiter(2, 60_000, now);
    const attempts = new PasswordAttemptLimiter(2, 2, 60_000, now);
    expect(attempts.reserveClient("192.0.2.1")).toBeTruthy();
    expect(attempts.reserveClient("192.0.2.1")).toBeTruthy();
    expect(attempts.reserveClient("192.0.2.1")).toBeNull();
    expect(views.allow("192.0.2.1")).toBe(true);
    expect(views.allow("192.0.2.1")).toBe(true);
    expect(views.allow("192.0.2.1")).toBe(false);
    expect(attempts.beginShareCheck(firstHash)).toBe("admitted");
    attempts.confirmShareFailure(firstHash);
  });
});

describe("share password contract", () => {
  it("normalises to NFC before the length check", () => {
    const shortAfterNfc = "é".normalize("NFD").repeat(9);
    expect(shortAfterNfc.length).toBeGreaterThan(10);
    expect(sharePasswordSchema.safeParse(shortAfterNfc).success).toBe(false);
    expect(sharePasswordSchema.safeParse(shortAfterNfc).error?.issues[0]?.message).toBe("Use at least 10 characters.");
    expect(sharePasswordSchema.safeParse("café-gate1".normalize("NFD")).success).toBe(true);
  });

  it("rejects all-whitespace and too few distinct characters", () => {
    expect(sharePasswordSchema.safeParse("          ").error?.issues[0]?.message).toBe(
      "Choose a password with letters or numbers.",
    );
    expect(sharePasswordSchema.safeParse("ababababab").error?.issues[0]?.message).toBe(
      `Use at least ${SHARE_PASSWORD_MIN_UNIQUE} different characters.`,
    );
    expect(sharePasswordSchema.safeParse("password123").error?.issues[0]?.message).toBe("Choose a less common password.");
  });

  it("accepts an omitted password on the owner share body", () => {
    expect(createShareRequestSchema.safeParse({}).success).toBe(true);
    expect(createShareRequestSchema.safeParse({ password: "open sesame 42" }).success).toBe(true);
  });
});

describe("rate window refunds", () => {
  it("returns a taken slot in the current window", () => {
    const window = new RateWindow(1, 60_000, 10, 0);
    const charge = window.take("one", 0);
    expect(charge).toEqual({ key: "one", windowStart: 0 });
    expect(window.take("one", 0)).toBeNull();
    window.refund(charge!, 0);
    expect(window.take("one", 0)).toBeTruthy();
  });

  it("refunds the window that recorded the charge, not a newer one", () => {
    const window = new RateWindow(1, 60_000, 10, 0);
    const previous = window.take("one", 0);
    expect(previous).toBeTruthy();
    const current = window.take("one", 90_000);
    expect(current).toBeTruthy();
    expect(window.take("one", 90_000)).toBeNull();
    window.refund(previous!, 90_000);
    expect(window.take("one", 90_000)).toBeNull();
  });

  it("reports retry-after while the sliding window is full", () => {
    const window = new RateWindow(1, 60_000, 10, 0);
    expect(window.retryAfterSeconds("one", 0)).toBe(0);
    expect(window.take("one", 0)).toBeTruthy();
    expect(window.retryAfterSeconds("one", 0)).toBeGreaterThanOrEqual(1);
    expect(window.used("one", 0)).toBe(1);
  });
});

describe("Argon2 verify gate", () => {
  it("fails fast when saturated and releases a slot", () => {
    const gate = new Argon2VerifyGate(2);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.used).toBe(2);
  });
});

describe("share unlock grants", () => {
  const key = deriveShareGrantKey("share-grant-test-material-at-least-32");
  const scope: ShareGrantScope = {
    artifactId,
    shareTokenHash: "a".repeat(64),
    passwordFingerprint: "fingerprint-one",
  };
  const nowMs = Date.UTC(2026, 9, 21, 9, 0, 0);

  it("lasts fifteen minutes for the same share and password", () => {
    const grant = mintShareGrant(scope, key, nowMs);
    expect(grant.token).toMatch(/^g1\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(grant.expiresAt.getTime()).toBe(nowMs + SHARE_GRANT_TTL_SECONDS * 1000);
    expect(shareGrantAllows(grant.token, scope, key, nowMs)).toBe(true);
    expect(shareGrantAllows(grant.token, { ...scope, artifactId: artifactId.toUpperCase() }, key, nowMs)).toBe(true);
    expect(shareGrantAllows(grant.token, scope, key, nowMs + (SHARE_GRANT_TTL_SECONDS - 1) * 1000)).toBe(true);
    expect(shareGrantAllows(grant.token, scope, key, nowMs + SHARE_GRANT_TTL_SECONDS * 1000)).toBe(false);
  });

  it("is scoped to one artifact, one share token, and one stored password", () => {
    const grant = mintShareGrant(scope, key, nowMs).token;
    expect(shareGrantAllows(grant, { ...scope, artifactId: otherArtifactId }, key, nowMs)).toBe(false);
    expect(shareGrantAllows(grant, { ...scope, shareTokenHash: "b".repeat(64) }, key, nowMs)).toBe(false);
    expect(shareGrantAllows(grant, { ...scope, passwordFingerprint: "fingerprint-two" }, key, nowMs)).toBe(false);
    expect(shareGrantAllows(grant, scope, deriveShareGrantKey("rotated-share-grant-material-32-chars"), nowMs)).toBe(false);
  });

  it("rejects tampered, far-future, and non-string grants", () => {
    const grant = mintShareGrant(scope, key, nowMs).token;
    const [prefix, exp, signature] = grant.split(".");
    const later = (Number.parseInt(exp ?? "", 36) + 60).toString(36);
    expect(shareGrantAllows(`${prefix}.${later}.${signature}`, scope, key, nowMs)).toBe(false);
    expect(shareGrantAllows(`${grant}x`, scope, key, nowMs)).toBe(false);
    expect(shareGrantAllows(grant.replace(/.$/, grant.endsWith("A") ? "B" : "A"), scope, key, nowMs)).toBe(false);
    expect(shareGrantAllows(mintShareGrant(scope, key, nowMs + 3_600_000).token, scope, key, nowMs)).toBe(false);
    expect(shareGrantAllows(undefined, scope, key, nowMs)).toBe(false);
    expect(shareGrantAllows([grant], scope, key, nowMs)).toBe(false);
    expect(shareGrantAllows("", scope, key, nowMs)).toBe(false);
  });

  it("keeps grants and content tickets apart", () => {
    const grant = mintShareGrant(scope, key, nowMs).token;
    const ticket = mintShareTicket(scope, key, nowMs);
    expect(ticket).toMatch(/^t1\.[0-9a-z]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(ticket).not.toContain(grant.split(".")[2]);
    expect(readShareTicket(grant, scope, key, nowMs)).toBeNull();
    expect(shareGrantAllows(ticket, scope, key, nowMs)).toBe(false);
    const forged = `t1.${grant.split(".")[1]}.${"A".repeat(22)}.${grant.split(".")[2]}`;
    expect(readShareTicket(forged, scope, key, nowMs)).toBeNull();
  });

  it("issues sixty second tickets scoped like the grant", () => {
    const ticket = mintShareTicket(scope, key, nowMs);
    const read = readShareTicket(ticket, scope, key, nowMs);
    expect(read?.expiresAtMs).toBe(nowMs + SHARE_TICKET_TTL_SECONDS * 1000);
    expect(readShareTicket(ticket, scope, key, nowMs + SHARE_TICKET_TTL_SECONDS * 1000)).toBeNull();
    expect(readShareTicket(ticket, { ...scope, passwordFingerprint: "fingerprint-two" }, key, nowMs)).toBeNull();
    expect(readShareTicket(ticket, { ...scope, shareTokenHash: "b".repeat(64) }, key, nowMs)).toBeNull();
    expect(readShareTicket(ticket, { ...scope, artifactId: otherArtifactId }, key, nowMs)).toBeNull();
    expect(mintShareTicket(scope, key, nowMs)).not.toBe(ticket);
    const url = ticketedContentUrl("https://api.example.com", artifactId, "t".repeat(43), ticket);
    expect(url).toBe(`https://api.example.com/api/v1/public/artifacts/${artifactId}/${"t".repeat(43)}/content?ticket=${ticket}`);
  });

  it("honors a ticket a few times, then refuses it until it expires and leaves the ledger", () => {
    let now = nowMs;
    const ledger = new ShareTicketLedger(SHARE_TICKET_MAX_USES, 100, () => now);
    const read = readShareTicket(mintShareTicket(scope, key, nowMs), scope, key, nowMs);
    if (!read) {
      throw new Error("ticket did not read");
    }
    for (let use = 0; use < SHARE_TICKET_MAX_USES; use += 1) {
      expect(ledger.redeem(read.nonce, read.expiresAtMs)).toBe(true);
    }
    expect(ledger.redeem(read.nonce, read.expiresAtMs)).toBe(false);
    expect(ledger.redeem("another-nonce-value-22", read.expiresAtMs)).toBe(true);
    now = read.expiresAtMs + 1;
    expect(ledger.redeem("third-nonce-value-0022", now + 60_000)).toBe(true);
    expect(ledger.size).toBe(1);
  });

  it("bounds the ledger by dropping the oldest entry", () => {
    const ledger = new ShareTicketLedger(1, 2, () => nowMs);
    const until = nowMs + 60_000;
    expect(ledger.redeem("a", until)).toBe(true);
    expect(ledger.redeem("b", until)).toBe(true);
    expect(ledger.redeem("c", until)).toBe(true);
    expect(ledger.size).toBe(2);
    expect(ledger.redeem("b", until)).toBe(false);
    expect(ledger.redeem("c", until)).toBe(false);
  });
});
