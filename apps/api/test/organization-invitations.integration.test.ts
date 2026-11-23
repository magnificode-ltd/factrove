import "reflect-metadata";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Logger, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { createInvitationToken, hashInvitationToken } from "../src/auth/invitation-token.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { INVITE_QUEUE_LIMIT, InviteMailer } from "../src/mail/invite-mailer.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, type BlobStore } from "../src/storage/blob-store.js";
import { createSessionApiKey, TEST_AUTH_SECRET } from "./auth-session.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

const config: ApiConfig = {
  host: "127.0.0.1",
  port: 3001,
  webOrigin: "http://localhost:3000",
  apiPublicOrigin: "http://localhost:3001",
  publicBaseUrl: "http://localhost:3000",
  authSecret: TEST_AUTH_SECRET,
  authCookieDomain: null,
  trustedProxies: ["127.0.0.1"],
  shareTokenKey: null,
  emailTransport: "log",
  emailFromAddress: "library@example.com",
  emailFromName: "Factrove",
  emailLogoUrl: null,
  brevoApiKey: null,
  smtp: null,
  emailLogFullLinks: false,
};

describe("organization invitations", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolated: IsolatedDatabase | undefined;
  let prisma: PrismaClient;
  let app: INestApplication;
  let baseUrl = "";
  let sequence = 0;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase();
    process.env.DATABASE_URL = isolated.databaseUrl;
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: isolated.databaseUrl },
    });
    prisma = new PrismaClient({ datasources: { db: { url: isolated.databaseUrl } } });
    await prisma.$connect();
    app = await createApp(config);
    await seedLocalIdentities(app.get(PrismaService));
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (address === null || typeof address === "string") {
      throw new Error("The test server did not bind a port.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    if (isolated) {
      await dropIsolatedDatabase(isolated);
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it("lists members for any member and pending invitations for an owner", async () => {
    const ada = await owner("roster");
    const bea = await register({ email: nextEmail("roster-member"), password: "password-123", name: "Bea Member" });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: ada.organizationId,
        userId: bea.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    const invited = nextEmail("roster-invite");
    const created = await postJson("/organization/invitations", ada.cookie, { email: invited });
    expect(created.response.status).toBe(201);
    const stale = await postJson("/organization/invitations", ada.cookie, { email: nextEmail("roster-stale") });
    expect(stale.response.status).toBe(201);
    await prisma.$executeRaw`
      UPDATE invitation
      SET "expiresAt" = CURRENT_TIMESTAMP - interval '1 minute'
      WHERE id = ${stale.body.invitation.id}
    `;

    const ownerPage = await getJson("/organization/members", ada.cookie);
    expect(ownerPage.response.status).toBe(200);
    expect(ownerPage.body.caller?.role).toBe("owner");
    expect(ownerPage.body.members?.map((member) => member.email).sort()).toEqual([ada.email, bea.email].sort());
    expect(ownerPage.body.members?.find((member) => member.email === ada.email)).toMatchObject({ name: "Ada Owner", role: "owner" });
    expect(ownerPage.body.members?.find((member) => member.email === bea.email)).toMatchObject({ name: "Bea Member", role: "member" });
    expect(ownerPage.body.invitations?.map((invitation) => invitation.email)).toEqual([invited]);
    expect(ownerPage.body.invitations?.[0]?.status).toBe("pending");
    expect(JSON.stringify(ownerPage.body)).not.toContain("tokenHash");

    const memberPage = await getJson("/organization/members", bea.cookie);
    expect(memberPage.response.status).toBe(200);
    expect(memberPage.body.caller?.role).toBe("member");
    expect(memberPage.body.members).toHaveLength(2);
    expect(memberPage.body.invitations).toEqual([]);

    const key = await createSessionApiKey(baseUrl, ada.cookie, "roster");
    const byKey = await fetch(`${baseUrl}/api/v1/organization/members`, {
      headers: { authorization: `Bearer ${key.apiKey}` },
    });
    expect(byKey.status).toBe(401);
    expect((await byKey.json()).error.code).toBe("UNAUTHENTICATED");

    const first = await getJson("/organization/members?limit=1", ada.cookie);
    expect(first.response.status).toBe(200);
    expect(first.body.members).toHaveLength(1);
    expect(first.body.nextCursor).toBe(first.body.members?.[0]?.id);
    const second = await getJson(`/organization/members?limit=1&cursor=${first.body.nextCursor}`, ada.cookie);
    expect(second.response.status).toBe(200);
    expect(second.body.members).toHaveLength(1);
    expect(second.body.members?.[0]?.id).not.toBe(first.body.members?.[0]?.id);
    expect(second.body.nextCursor).toBeNull();

    const badCursor = await getJson("/organization/members?cursor=missing-member", ada.cookie);
    expect(badCursor.response.status).toBe(400);
    expect(badCursor.body.error?.code).toBe("INVALID_REQUEST");
  });

  it("creates, lists, resends, and revokes without returning a secret", async () => {
    const ada = await owner("ada");
    const logs: string[] = [];
    const log = Logger.prototype.log;
    Logger.prototype.log = function (message: unknown) {
      logs.push(String(message));
      return this;
    };
    try {
      const created = await postJson("/organization/invitations", ada.cookie, { email: "Guest+Lab@Example.com" });
      expect(created.response.status).toBe(201);
      expect(created.body).toMatchObject({
        delivery: "queued",
        invitation: {
          email: "guest+lab@example.com",
          role: "member",
          status: "pending",
          lastSentAt: expect.any(String),
        },
      });
      expect(created.body.invitation).not.toHaveProperty("token");
      expect(created.body.invitation).not.toHaveProperty("tokenHash");
      expect(JSON.stringify(created.body)).not.toContain("delivered");
      await waitFor(() => logs.some((line) => line.includes("Organization invitation was not sent.")));
      const logged = logs.join("\n");
      expect(logged).toContain("http://localhost:3000/invites/accept?[redacted]");
      expect(logged).not.toContain("token=");
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.invitation.id } });
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

      const page = await getJson("/organization/invitations?limit=20", ada.cookie);
      expect(page.response.status).toBe(200);
      expect(page.body.invitations.map((item: { id: string }) => item.id)).toContain(created.body.invitation.id);
      expect(JSON.stringify(page.body)).not.toContain(row.tokenHash);

      await prisma.$executeRaw`UPDATE invitation SET "lastSentAt" = CURRENT_TIMESTAMP - interval '2 minutes' WHERE id = ${row.id}`;
      const resent = await postJson(`/organization/invitations/${row.id}/resend`, ada.cookie, undefined);
      expect(resent.response.status).toBe(200);
      expect(resent.body.delivery).toBe("queued");
      const rotated = await prisma.invitation.findUniqueOrThrow({ where: { id: row.id } });
      expect(rotated.tokenHash).not.toBe(row.tokenHash);
      expect(rotated.status).toBe("pending");

      const revoked = await send("DELETE", `/organization/invitations/${row.id}`, ada.cookie);
      expect(revoked.status).toBe(204);
      expect(await revoked.text()).toBe("");
      const canceled = await prisma.invitation.findUniqueOrThrow({ where: { id: row.id } });
      expect(canceled.status).toBe("canceled");
      expect(canceled.tokenHash).toBeNull();
      const again = await send("DELETE", `/organization/invitations/${row.id}`, ada.cookie);
      expect(again.status).toBe(204);
      const closed = await postJson(`/organization/invitations/${row.id}/resend`, ada.cookie, undefined);
      expect(closed.response.status).toBe(409);
      expect(closed.body.error.code).toBe("INVITATION_CLOSED");
    } finally {
      Logger.prototype.log = log;
    }
  });

  it("uses one response for an unknown address and an address in another organization", async () => {
    const ada = await owner("list");
    const bea = await owner("other");
    const unknown = await postJson("/organization/invitations", ada.cookie, { email: nextEmail("missing") });
    const elsewhere = await postJson("/organization/invitations", ada.cookie, { email: bea.email });
    expect(unknown.response.status).toBe(201);
    expect(elsewhere.response.status).toBe(201);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(elsewhere.body).sort());
    expect(Object.keys(unknown.body.invitation).sort()).toEqual(Object.keys(elsewhere.body.invitation).sort());
    expect(unknown.body.delivery).toBe("queued");
    expect(elsewhere.body.delivery).toBe("queued");
    expect(JSON.stringify(elsewhere.body)).not.toMatch(/userId|exists|account/i);

    const member = await postJson("/organization/invitations", ada.cookie, { email: ada.email });
    expect(member.response.status).toBe(409);
    expect(member.body).toEqual({
      error: { code: "ALREADY_MEMBER", message: "That person is already a member of this organization." },
    });
    expect(await prisma.invitation.count({ where: { organizationId: ada.organizationId, email: ada.email } })).toBe(0);

    const duplicate = await postJson("/organization/invitations", ada.cookie, { email: unknown.body.invitation.email });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.error.code).toBe("INVITATION_PENDING");
  });

  it("rejects API keys, a bad origin, a non-owner, and another organization's id", async () => {
    const ada = await owner("authz");
    const created = await postJson("/organization/invitations", ada.cookie, { email: nextEmail("authz") });
    expect(created.response.status).toBe(201);
    const key = await createSessionApiKey(baseUrl, ada.cookie, "authz");
    const byKey = await fetch(`${baseUrl}/api/v1/organization/invitations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: nextEmail("key") }),
    });
    expect(byKey.status).toBe(401);
    expect((await byKey.json()).error.code).toBe("UNAUTHENTICATED");
    const withCookie = await fetch(`${baseUrl}/api/v1/organization/invitations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        cookie: ada.cookie,
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: nextEmail("both") }),
    });
    expect(withCookie.status).toBe(401);

    const origin = await fetch(`${baseUrl}/api/v1/organization/invitations`, {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ email: nextEmail("origin") }),
    });
    expect(origin.status).toBe(403);
    expect(await origin.json()).toEqual({
      error: { code: "FORBIDDEN", message: "This request origin is not allowed." },
    });

    const invitee = await register({ email: nextEmail("member"), password: "password-123", name: "Bea Member" });
    await verify(invitee.userId);
    const memberInvite = await postJson("/organization/invitations", ada.cookie, { email: invitee.email });
    expect(memberInvite.response.status).toBe(201);
    const token = await replaceToken(memberInvite.body.invitation.id);
    const accepted = await postJson("/invitations/accept", invitee.cookie, { token });
    expect(accepted.response.status).toBe(200);
    const denied = await getJson("/organization/invitations", invitee.cookie);
    expect(denied.response.status).toBe(403);
    expect(denied.body.error).toEqual({ code: "FORBIDDEN", message: "Only an owner can manage invitations." });

    const outsider = await register( { email: nextEmail("none"), password: "password-123", name: "No Org" });
    const setup = await getJson("/organization/invitations", outsider.cookie);
    expect(setup.response.status).toBe(403);
    expect(setup.body.error.code).toBe("ORGANIZATION_SETUP_REQUIRED");

    const other = await owner("cross");
    const missing = await postJson("/organization/invitations/not-an-invitation/resend", other.cookie, undefined);
    const foreign = await postJson(`/organization/invitations/${created.body.invitation.id}/resend`, other.cookie, undefined);
    expect(missing.response.status).toBe(404);
    expect(foreign.response.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(foreign.body.error.code).toBe("INVITATION_NOT_FOUND");

    const plugin = await fetch(`${baseUrl}/api/auth/organization/invite-member`, {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: "plugin@example.com", role: "member" }),
    });
    expect(plugin.status).toBe(403);
    expect(await plugin.text()).toContain("This organization action is not available.");
    const active = await fetch(`${baseUrl}/api/auth/organization/set-active`, {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ organizationId: other.organizationId }),
    });
    expect(active.status).toBe(403);
  });

  it("previews a live invitation and uses one response for a dead token", async () => {
    const ada = await owner("preview");
    const created = await postJson("/organization/invitations", ada.cookie, { email: nextEmail("preview") });
    const token = await replaceToken(created.body.invitation.id);
    const live = await postJson("/invitations/preview", undefined, { token }, { forwardedFor: "198.51.100.20" });
    expect(live.response.status).toBe(200);
    expect(live.body).toEqual({
      organization: { name: "preview lab" },
      inviter: { name: "Ada Owner" },
      email: created.body.invitation.email,
      expiresAt: expect.any(String),
    });
    expect(live.body).not.toHaveProperty("userId");
    const before = await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.invitation.id } });
    await prisma.$executeRaw`UPDATE invitation SET "expiresAt" = CURRENT_TIMESTAMP - interval '1 minute' WHERE id = ${before.id}`;
    const expired = await postJson("/invitations/preview", undefined, { token }, { forwardedFor: "198.51.100.21" });
    const unknown = await postJson("/invitations/preview", undefined, { token: createInvitationToken() }, { forwardedFor: "198.51.100.22" });
    expect(expired.response.status).toBe(404);
    expect(unknown.response.status).toBe(404);
    expect(expired.body).toEqual(unknown.body);
    expect(expired.body.error.code).toBe("INVITATION_INVALID");
    const after = await prisma.invitation.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.status).toBe("pending");
    expect(after.tokenHash).toBe(before.tokenHash);

    const cookied = await fetch(`${baseUrl}/api/v1/invitations/preview`, {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ token }),
    });
    expect(cookied.status).toBe(403);
  });

  it("accepts a verified matching email and refuses a mismatch, an unverified email, and a replay", async () => {
    const ada = await owner("accept");
    const address = nextEmail("join");
    const created = await postJson("/organization/invitations", ada.cookie, { email: address });
    const token = await replaceToken(created.body.invitation.id);
    const unverified = await register( { email: address, password: "password-123", name: "Unverified" });
    const blocked = await postJson("/invitations/accept", unverified.cookie, { token });
    expect(blocked.response.status).toBe(403);
    expect(blocked.body.error.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.invitation.id } })).status).toBe("pending");

    const other = await register( { email: nextEmail("wrong"), password: "password-123", name: "Wrong" });
    await verify(other.userId);
    const mismatch = await postJson("/invitations/accept", other.cookie, { token });
    expect(mismatch.response.status).toBe(403);
    expect(mismatch.body.error.code).toBe("INVITATION_EMAIL_MISMATCH");
    expect(await prisma.member.count({ where: { userId: other.userId } })).toBe(0);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.invitation.id } })).tokenHash).not.toBeNull();

    await verify(unverified.userId);
    const byKey = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: "POST",
      headers: {
        authorization: "Bearer ftrv_not_a_session",
        cookie: unverified.cookie,
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ token }),
    });
    expect(byKey.status).toBe(401);
    const accepted = await postJson("/invitations/accept", unverified.cookie, { token });
    expect(accepted.response.status).toBe(200);
    expect(accepted.body.organization).toEqual({ id: ada.organizationId, name: "accept lab" });
    const membership = await prisma.member.findFirstOrThrow({ where: { userId: unverified.userId } });
    expect(membership).toMatchObject({ organizationId: ada.organizationId, role: "member" });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: created.body.invitation.id } });
    expect(invitation.status).toBe("accepted");
    expect(invitation.tokenHash).toBeNull();
    const session = await prisma.session.findFirstOrThrow({ where: { userId: unverified.userId } });
    expect(session.activeOrganizationId).toBe(ada.organizationId);
    const replay = await postJson("/invitations/accept", unverified.cookie, { token });
    expect(replay.response.status).toBe(404);
    expect(replay.body.error.code).toBe("INVITATION_INVALID");
    expect(await prisma.member.count({ where: { userId: unverified.userId } })).toBe(1);

    const occupied = await owner("occupied");
    const second = await postJson("/organization/invitations", ada.cookie, { email: occupied.email });
    const secondToken = await replaceToken(second.body.invitation.id);
    const exists = await postJson("/invitations/accept", occupied.cookie, { token: secondToken });
    expect(exists.response.status).toBe(409);
    expect(exists.body.error.code).toBe("ORGANIZATION_EXISTS");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: second.body.invitation.id } })).status).toBe("pending");
    expect(await prisma.member.count({ where: { userId: occupied.userId } })).toBe(1);
  });

  it("keeps accept, resend, revoke, and onboarding from writing a partial membership", async () => {
    const ada = await owner("race");
    const resendAddress = nextEmail("resend-race");
    const resendInvite = await postJson("/organization/invitations", ada.cookie, { email: resendAddress });
    await prisma.$executeRaw`UPDATE invitation SET "lastSentAt" = CURRENT_TIMESTAMP - interval '2 minutes' WHERE id = ${resendInvite.body.invitation.id}`;
    const resendToken = await replaceToken(resendInvite.body.invitation.id);
    const previousHash = (await prisma.invitation.findUniqueOrThrow({ where: { id: resendInvite.body.invitation.id } })).tokenHash;
    const resendUser = await register( { email: resendAddress, password: "password-123", name: "Resend Race" });
    await verify(resendUser.userId);
    const heldResend = await holdInvitation(resendInvite.body.invitation.id);
    const acceptDuringResend = postJson("/invitations/accept", resendUser.cookie, { token: resendToken });
    const resendDuringAccept = postJson(`/organization/invitations/${resendInvite.body.invitation.id}/resend`, ada.cookie, undefined);
    await delay(400);
    await heldResend.release();
    const [acceptedDuringResend, resentDuringAccept] = await Promise.all([acceptDuringResend, resendDuringAccept]);
    const resendMemberships = await prisma.member.count({ where: { userId: resendUser.userId } });
    const resendRow = await prisma.invitation.findUniqueOrThrow({ where: { id: resendInvite.body.invitation.id } });
    expect(resendMemberships).toBeLessThanOrEqual(1);
    if (resendMemberships === 1) {
      expect(acceptedDuringResend.response.status).toBe(200);
      expect(resentDuringAccept.response.status).toBe(409);
      expect(resendRow.status).toBe("accepted");
      expect(resendRow.tokenHash).toBeNull();
    } else {
      expect(acceptedDuringResend.response.status).toBe(404);
      expect(resentDuringAccept.response.status).toBe(200);
      expect(resendRow.status).toBe("pending");
      expect(resendRow.tokenHash).not.toBe(previousHash);
    }

    const revokeAddress = nextEmail("revoke-race");
    const revokeInvite = await postJson("/organization/invitations", ada.cookie, { email: revokeAddress });
    const revokeToken = await replaceToken(revokeInvite.body.invitation.id);
    const revokeUser = await register( { email: revokeAddress, password: "password-123", name: "Revoke Race" });
    await verify(revokeUser.userId);
    const held = await holdInvitation(revokeInvite.body.invitation.id);
    const acceptPromise = postJson("/invitations/accept", revokeUser.cookie, { token: revokeToken });
    const revokePromise = send("DELETE", `/organization/invitations/${revokeInvite.body.invitation.id}`, ada.cookie);
    await delay(400);
    await held.release();
    const [accepted, revoked] = await Promise.all([acceptPromise, revokePromise]);
    const memberships = await prisma.member.count({ where: { userId: revokeUser.userId } });
    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: revokeInvite.body.invitation.id } });
    expect(memberships === 1 ? accepted.response.status : revoked.status).toBe(memberships === 1 ? 200 : 204);
    expect(memberships).toBeLessThanOrEqual(1);
    if (memberships === 1) {
      expect(row.status).toBe("accepted");
      expect(row.tokenHash).toBeNull();
      expect(revoked.status).toBe(404);
    } else {
      expect(accepted.response.status).toBe(404);
      expect(row.status).toBe("canceled");
      expect(row.tokenHash).toBeNull();
    }

    const onboardAddress = nextEmail("onboard-race");
    const onboardInvite = await postJson("/organization/invitations", ada.cookie, { email: onboardAddress });
    const onboardToken = await replaceToken(onboardInvite.body.invitation.id);
    const onboardUser = await register( { email: onboardAddress, password: "password-123", name: "Onboard Race" });
    await verify(onboardUser.userId);
    const [joined, createdOrg] = await Promise.all([
      postJson("/invitations/accept", onboardUser.cookie, { token: onboardToken }),
      postJson("/onboarding/organization", onboardUser.cookie, { name: "Race Lab" }),
    ]);
    const rows = await prisma.member.findMany({ where: { userId: onboardUser.userId } });
    expect(rows).toHaveLength(1);
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { id: onboardInvite.body.invitation.id } });
    const successes = [joined.response.status, createdOrg.response.status].filter((status) => status === 200 || status === 201);
    expect(successes).toHaveLength(1);
    if (joined.response.status === 200) {
      expect(rows[0]).toMatchObject({ organizationId: ada.organizationId, role: "member" });
      expect(invitation.status).toBe("accepted");
      expect(invitation.tokenHash).toBeNull();
      expect(createdOrg.response.status).toBe(409);
    } else {
      expect(rows[0]?.role).toBe("owner");
      expect(rows[0]?.organizationId).not.toBe(ada.organizationId);
      expect(invitation.status).toBe("pending");
      expect(invitation.tokenHash).not.toBeNull();
      expect(joined.response.status).toBe(409);
    }
  });

  it("limits sends, previews, and accepts", async () => {
    const ada = await owner("limits");
    for (let index = 0; index < 10; index += 1) {
      const created = await postJson("/organization/invitations", ada.cookie, { email: nextEmail("burst") });
      expect(created.response.status).toBe(201);
    }
    const limited = await postJson("/organization/invitations", ada.cookie, { email: nextEmail("burst") });
    expect(limited.response.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(Number(limited.response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    const cooled = await owner("cool");
    const first = await postJson("/organization/invitations", cooled.cookie, { email: nextEmail("cool") });
    expect(first.response.status).toBe(201);
    const tooSoon = await postJson(`/organization/invitations/${first.body.invitation.id}/resend`, cooled.cookie, undefined);
    expect(tooSoon.response.status).toBe(429);
    expect(Number(tooSoon.response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(Number(tooSoon.response.headers.get("retry-after"))).toBeLessThanOrEqual(60);

    const hourly = await owner("hour");
    const hourInvite = await postJson("/organization/invitations", hourly.cookie, { email: nextEmail("hour") });
    expect(hourInvite.response.status).toBe(201);
    for (let index = 0; index < 2; index += 1) {
      await prisma.$executeRaw`UPDATE invitation SET "lastSentAt" = CURRENT_TIMESTAMP - interval '2 minutes' WHERE id = ${hourInvite.body.invitation.id}`;
      const resent = await postJson(`/organization/invitations/${hourInvite.body.invitation.id}/resend`, hourly.cookie, undefined);
      expect(resent.response.status).toBe(200);
    }
    await prisma.$executeRaw`UPDATE invitation SET "lastSentAt" = CURRENT_TIMESTAMP - interval '2 minutes' WHERE id = ${hourInvite.body.invitation.id}`;
    const fourth = await postJson(`/organization/invitations/${hourInvite.body.invitation.id}/resend`, hourly.cookie, undefined);
    expect(fourth.response.status).toBe(429);
    expect(fourth.response.headers.get("retry-after")).toBeTruthy();

    let previewStatus = 0;
    for (let index = 0; index < 31; index += 1) {
      const preview = await postJson("/invitations/preview", undefined, { token: createInvitationToken() }, { forwardedFor: "198.51.100.31" });
      previewStatus = preview.response.status;
    }
    expect(previewStatus).toBe(429);

    const accepter = await register( { email: nextEmail("accept-limit"), password: "password-123", name: "Limit" });
    await verify(accepter.userId);
    let acceptStatus = 0;
    for (let index = 0; index < 11; index += 1) {
      const attempt = await postJson(
        "/invitations/accept",
        accepter.cookie,
        { token: createInvitationToken() },
        { forwardedFor: "198.51.100.32" },
      );
      acceptStatus = attempt.response.status;
    }
    expect(acceptStatus).toBe(429);
  });

  it("does not let two owners both send inside the cooldown", async () => {
    const ada = await owner("cooldown-a");
    const bea = await register({ email: nextEmail("cooldown-b"), password: "password-123", name: "Bea Owner" });
    const clerk = await register({ email: nextEmail("cooldown-clerk"), password: "password-123", name: "Clerk" });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: ada.organizationId,
        userId: bea.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const address = nextEmail("cooldown-mail");
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set.");
    }
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let committed = false;
    let pending: Array<ReturnType<typeof postJson>> = [];
    try {
      await client.query("BEGIN");
      await client.query(`SELECT id FROM organization WHERE id = $1 FOR UPDATE`, [ada.organizationId]);
      pending = [
        postJson("/organization/invitations", ada.cookie, { email: address }),
        postJson("/organization/invitations", bea.cookie, { email: address }),
      ];
      await waitForOrganizationLockWaiters(2);
      expect(await prisma.invitation.count({ where: { organizationId: ada.organizationId, email: address } })).toBe(0);
      // The inviter is a user neither request has locked. The insert's user
      // foreign key would otherwise wait on an owner who is waiting for this row.
      await client.query(
        `INSERT INTO invitation (
          id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId", "tokenHash", "lastSentAt"
        ) VALUES (
          $1, $2, $3, 'member', 'canceled',
          CURRENT_TIMESTAMP + interval '7 days', CURRENT_TIMESTAMP, $4, NULL, CURRENT_TIMESTAMP
        )`,
        [randomUUID(), ada.organizationId, address, clerk.userId],
      );
      await client.query("COMMIT");
      committed = true;
      const [left, right] = await Promise.all(pending);
      expect(left.response.status).toBe(429);
      expect(right.response.status).toBe(429);
      expect(left.body.error?.code).toBe("RATE_LIMITED");
      expect(right.body.error?.code).toBe("RATE_LIMITED");
      expect(Number(left.response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(Number(left.response.headers.get("retry-after"))).toBeLessThanOrEqual(60);
      expect(Number(right.response.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      const rows = await prisma.invitation.findMany({ where: { organizationId: ada.organizationId, email: address } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("canceled");
    } finally {
      if (!committed) {
        await client.query("ROLLBACK").catch(() => undefined);
        await Promise.allSettled(pending);
      }
      await client.end();
    }
  });

  it("expires a stale pending invitation before resend checks that email", async () => {
    const ada = await owner("stale");
    const address = nextEmail("stale-mail");
    const older = await postJson("/organization/invitations", ada.cookie, { email: address });
    expect(older.response.status).toBe(201);
    const olderId = older.body.invitation.id;
    await prisma.$executeRaw`
      UPDATE invitation
      SET status = 'expired',
          "tokenHash" = NULL,
          "expiresAt" = CURRENT_TIMESTAMP - interval '2 days',
          "lastSentAt" = CURRENT_TIMESTAMP - interval '2 minutes'
      WHERE id = ${olderId}
    `;
    const newer = await postJson("/organization/invitations", ada.cookie, { email: address });
    expect(newer.response.status).toBe(201);
    const newerId = newer.body.invitation.id;
    await prisma.$executeRaw`
      UPDATE invitation
      SET "expiresAt" = CURRENT_TIMESTAMP - interval '1 minute',
          "lastSentAt" = CURRENT_TIMESTAMP - interval '2 minutes'
      WHERE id = ${newerId}
    `;
    const resent = await postJson(`/organization/invitations/${olderId}/resend`, ada.cookie, undefined);
    expect(resent.response.status).toBe(200);
    expect(resent.body.invitation.id).toBe(olderId);
    const olderRow = await prisma.invitation.findUniqueOrThrow({ where: { id: olderId } });
    const newerRow = await prisma.invitation.findUniqueOrThrow({ where: { id: newerId } });
    expect(olderRow.status).toBe("pending");
    expect(olderRow.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(newerRow.status).toBe("expired");
    expect(newerRow.tokenHash).toBeNull();
  });

  it("keeps the invitation when the email queue is full and omits the token from the error", async () => {
    const ada = await owner("queue");
    const address = nextEmail("queued");
    const mailer = app.get(InviteMailer);
    const internal = mailer as unknown as { email: { send: (message: unknown) => Promise<void> } };
    const original = internal.email;
    const previousConcurrency = mailer.concurrency;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    internal.email = { send: () => gate };
    mailer.concurrency = 1;
    try {
      for (let index = 0; index < INVITE_QUEUE_LIMIT + 1; index += 1) {
        await mailer.sendInvite({ email: `held${index}@example.com`, name: "Held" });
      }
      const created = await postJson("/organization/invitations", ada.cookie, { email: address });
      expect(created.response.status).toBe(503);
      expect(created.response.headers.get("retry-after")).toBe("1");
      expect(created.body.error.code).toBe("EMAIL_UNAVAILABLE");
      expect(JSON.stringify(created.body)).not.toContain("token=");
      const stored = await prisma.invitation.findFirstOrThrow({
        where: { organizationId: ada.organizationId, email: address },
      });
      expect(stored.status).toBe("pending");
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      internal.email = original;
      mailer.concurrency = previousConcurrency;
      release();
    }
  });

  function nextEmail(label: string): string {
    sequence += 1;
    return `${label}${sequence}@example.com`;
  }

  async function owner(label: string): Promise<{ cookie: string; userId: string; organizationId: string; email: string }> {
    const address = nextEmail(label);
    const user = await register({ email: address, password: "password-123", name: "Ada Owner" });
    const organization = await createOrg(user.cookie, `${label} lab`);
    await verify(user.userId);
    return { cookie: user.cookie, userId: user.userId, organizationId: organization.id, email: address };
  }

  async function register(input: { email: string; password: string; name: string }): Promise<{ userId: string; email: string; name: string; cookie: string }> {
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": uniqueIp(),
      },
      body: JSON.stringify(input),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`sign-up failed ${response.status}: ${text}`);
    }
    const parsed = JSON.parse(text) as { user?: { id?: string } };
    const userId = parsed.user?.id;
    if (!userId) {
      throw new Error(`sign-up did not return a user: ${text}`);
    }
    const pairs = response.headers.getSetCookie?.() ?? [];
    const cookie = pairs.map((value) => value.split(";", 1)[0]?.trim()).filter((value): value is string => Boolean(value)).join("; ");
    if (cookie.length === 0) {
      throw new Error("sign-up did not set a session cookie");
    }
    return { userId, email: input.email, name: input.name, cookie };
  }

  async function createOrg(cookie: string, name: string): Promise<{ id: string; name: string }> {
    const response = await fetch(`${baseUrl}/api/v1/onboarding/organization`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://localhost:3000",
        "x-forwarded-for": uniqueIp(),
      },
      body: JSON.stringify({ name }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`organization failed ${response.status}: ${text}`);
    }
    const parsed = JSON.parse(text) as { organization: { id: string; name: string } };
    return parsed.organization;
  }

  function uniqueIp(): string {
    sequence += 1;
    return `203.0.${113 + Math.floor(sequence / 200)}.${(sequence % 200) + 1}`;
  }

  async function verify(userId: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  }

  async function replaceToken(id: string): Promise<string> {
    const token = createInvitationToken();
    await prisma.$executeRaw`UPDATE invitation SET "tokenHash" = ${hashInvitationToken(token)} WHERE id = ${id}`;
    return token;
  }

  async function postJson(
    path: string,
    cookie: string | undefined,
    body: unknown,
    options?: { forwardedFor?: string },
  ): Promise<{ response: Response; body: Payload }> {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method: "POST",
      headers: {
        ...(cookie ? { cookie } : {}),
        origin: "http://localhost:3000",
        "content-type": "application/json",
        ...(options?.forwardedFor ? { "x-forwarded-for": options.forwardedFor } : {}),
      },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
    const text = await response.text();
    return { response, body: text.length === 0 ? null : JSON.parse(text) };
  }

  async function getJson(path: string, cookie: string): Promise<{ response: Response; body: Payload }> {
    const response = await fetch(`${baseUrl}/api/v1${path}`, { headers: { cookie } });
    return { response, body: await response.json() };
  }

  function send(method: string, path: string, cookie: string): Promise<Response> {
    return fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { cookie, origin: "http://localhost:3000" },
    });
  }

  async function waitForOrganizationLockWaiters(minimum: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < 3_000) {
      const rows = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%FOR UPDATE%'
          AND query ILIKE '%organization%'
      `;
      if (Number(rows[0]?.count ?? 0) >= minimum) {
        return;
      }
      await delay(20);
    }
    const activity = await prisma.$queryRaw<Array<{ state: string | null; wait_event: string | null; query: string | null }>>`
      SELECT state, wait_event_type AS wait_event, LEFT(query, 240) AS query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
    `;
    throw new Error(`Timed out waiting for organization lock waiters: ${JSON.stringify(activity)}`);
  }
});

type Payload = {
  delivery?: string;
  invitation?: { id: string; email: string };
  invitations?: Array<{ id: string; email?: string; status?: string }>;
  caller?: { id: string; role: string };
  members?: Array<{ id: string; name: string; email: string; role: string }>;
  nextCursor?: string | null;
  organization?: { id: string; name: string };
  error?: { code: string; message: string };
};

async function holdInvitation(id: string): Promise<{ release: () => Promise<void> }> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("BEGIN");
  await client.query(`SELECT id FROM invitation WHERE id = $1 FOR UPDATE`, [id]);
  return {
    release: async () => {
      await client.query("ROLLBACK");
      await client.end();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(ready: () => boolean): Promise<void> {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 2_000) {
      throw new Error("Timed out waiting for the invitation log.");
    }
    await delay(20);
  }
}

async function createApp(appConfig: ApiConfig): Promise<INestApplication> {
  const store: BlobStore = {
    async put() {},
    async get() {
      throw new Error("unused");
    },
    async delete() {},
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(appConfig)
    .overrideProvider(BLOB_STORE)
    .useValue(store)
    .compile();
  const application = moduleRef.createNestApplication({ logger: false, bodyParser: false });
  configureHttpApp(application);
  await application.init();
  return application;
}
