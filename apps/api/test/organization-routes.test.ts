import type { PrismaClient } from "@prisma/client";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/create-auth.js";
import {
  ORGANIZATION_ACTION_UNAVAILABLE,
  rejectClosedOrganizationAction,
} from "../src/auth/organization-plugin.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

describe("closed organization routes", () => {
  it("rejects management writes and clearing the active organization", () => {
    expect(() => rejectClosedOrganizationAction("/organization/create")).toThrow(ORGANIZATION_ACTION_UNAVAILABLE);
    expect(() => rejectClosedOrganizationAction("organization/update-member-role")).toThrow(ORGANIZATION_ACTION_UNAVAILABLE);
    expect(() => rejectClosedOrganizationAction("/organization/set-active")).toThrow(ORGANIZATION_ACTION_UNAVAILABLE);
    expect(() => rejectClosedOrganizationAction("/organization/get-organization?organizationSlug=outsider")).toThrow(
      ORGANIZATION_ACTION_UNAVAILABLE,
    );
    expect(() => rejectClosedOrganizationAction("/organization/get-full-organization")).toThrow(ORGANIZATION_ACTION_UNAVAILABLE);
    expect(() => rejectClosedOrganizationAction("/organization/check-slug")).not.toThrow();
    expect(() => rejectClosedOrganizationAction("/organization/list")).not.toThrow();
    expect(() => rejectClosedOrganizationAction("/sign-up/email")).not.toThrow();
  });

  it("signs up without an organization and rejects the mounted management routes", async () => {
    const auth = createAuth({
      prisma: {} as PrismaClient,
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        apikey: [],
        organization: [],
        member: [],
        invitation: [],
      }),
      baseURL: "http://localhost:3001",
      secret: TEST_AUTH_SECRET,
      trustedOrigins: ["http://localhost:3000"],
      cookieDomain: null,
      webOrigin: "http://localhost:3000",
      onUserCreated: async () => {},
      sendPasswordResetEmail: async () => {},
      sendVerificationEmail: async () => {},
    });

    const created = await auth.handler(signUpRequest("org-lock@example.invalid"));
    expect(created.status).toBe(200);
    const cookie = cookieHeader(created);

    const listed = await auth.handler(new Request("http://localhost:3001/api/auth/organization/list", {
      headers: { cookie, origin: "http://localhost:3000" },
    }));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([]);

    const closed: Array<{ path: string; body: unknown }> = [
      { path: "/organization/create", body: { name: "Ada Org", slug: "ada-org" } },
      { path: "/organization/update", body: { data: { name: "Renamed", slug: "renamed" } } },
      { path: "/organization/delete", body: { organizationId: "org-1" } },
      { path: "/organization/invite-member", body: { email: "member@example.invalid", role: "member" } },
      { path: "/organization/cancel-invitation", body: { invitationId: "invite-1" } },
      { path: "/organization/accept-invitation", body: { invitationId: "invite-1" } },
      { path: "/organization/reject-invitation", body: { invitationId: "invite-1" } },
      { path: "/organization/remove-member", body: { memberIdOrEmail: "member@example.invalid" } },
      { path: "/organization/update-member-role", body: { memberId: "member-1", role: "admin" } },
      { path: "/organization/leave", body: { organizationId: "org-1" } },
      { path: "/organization/set-active", body: { organizationId: null } },
      { path: "/organization/set-active", body: { organizationSlug: null } },
      { path: "/organization/set-active", body: { organizationId: "org-1" } },
      { path: "/organization/set-active", body: {} },
    ];
    for (const route of closed) {
      const response = await auth.handler(jsonRequest(route.path, cookie, route.body));
      const text = await response.text();
      expect(response.status, `${route.path} ${text}`).toBe(403);
      expect(text).toContain(ORGANIZATION_ACTION_UNAVAILABLE);
    }

    const slug = await auth.handler(jsonRequest("/organization/check-slug", cookie, { slug: "ada-org" }));
    expect(slug.status).not.toBe(403);
    const stillEmpty = await auth.handler(new Request("http://localhost:3001/api/auth/organization/list", {
      headers: { cookie, origin: "http://localhost:3000" },
    }));
    expect(await stillEmpty.json()).toEqual([]);
  });

  it("leaves the stored active organization unchanged when set-active and organization reads are rejected", async () => {
    const db: Record<string, Array<Record<string, unknown>>> = {
      user: [],
      session: [],
      account: [],
      verification: [],
      apikey: [],
      organization: [],
      member: [],
      invitation: [],
    };
    const auth = createAuth({
      prisma: {} as PrismaClient,
      database: memoryAdapter(db),
      baseURL: "http://localhost:3001",
      secret: TEST_AUTH_SECRET,
      trustedOrigins: ["http://localhost:3000"],
      cookieDomain: null,
      webOrigin: "http://localhost:3000",
      onUserCreated: async () => {},
      sendPasswordResetEmail: async () => {},
      sendVerificationEmail: async () => {},
    });
    const created = await auth.handler(signUpRequest("org-active@example.invalid"));
    expect(created.status).toBe(200);
    const cookie = cookieHeader(created);
    const session = db.session[0];
    expect(session?.userId).toEqual(expect.any(String));
    const userId = session?.userId;
    const now = new Date();
    db.organization.push(
      { id: "home-org", name: "Home", slug: "home", createdAt: now },
      { id: "other-org", name: "Other", slug: "other", createdAt: now },
      { id: "outsider-org", name: "Outsider", slug: "outsider", createdAt: now },
    );
    db.member.push(
      { id: "member-home", organizationId: "home-org", userId, role: "owner", createdAt: now },
      { id: "member-other", organizationId: "other-org", userId, role: "member", createdAt: now },
    );
    session.activeOrganizationId = "home-org";

    const posts: unknown[] = [
      { organizationId: "other-org" },
      { organizationSlug: "other" },
      {},
      { organizationId: "outsider-org" },
      { organizationSlug: "outsider" },
    ];
    for (const body of posts) {
      const response = await auth.handler(jsonRequest("/organization/set-active", cookie, body));
      const text = await response.text();
      expect(response.status, text).toBe(403);
      expect(text).toContain(ORGANIZATION_ACTION_UNAVAILABLE);
      expect(storedActiveOrganizationId(db, userId)).toBe("home-org");
    }

    const reads = [
      "/organization/get-organization?organizationId=outsider-org",
      "/organization/get-organization?organizationSlug=outsider",
      "/organization/get-full-organization?organizationId=outsider-org",
      "/organization/get-full-organization?organizationSlug=outsider",
      "/organization/get-organization",
      "/organization/get-full-organization",
    ];
    for (const path of reads) {
      const response = await auth.handler(new Request(`http://localhost:3001/api/auth${path}`, {
        headers: { cookie },
      }));
      const text = await response.text();
      expect(response.status, `${path} ${text}`).toBe(403);
      expect(text).toContain(ORGANIZATION_ACTION_UNAVAILABLE);
      expect(storedActiveOrganizationId(db, userId)).toBe("home-org");
    }
  });
});

function storedActiveOrganizationId(db: Record<string, Array<Record<string, unknown>>>, userId: unknown): unknown {
  return db.session.find((row) => row.userId === userId)?.activeOrganizationId;
}

function signUpRequest(email: string): Request {
  return jsonRequest("/sign-up/email", undefined, {
    name: "Org Lock",
    email,
    password: "local-invite-check-1",
  });
}

function jsonRequest(path: string, cookie: string | undefined, body: unknown): Request {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "http://localhost:3000",
  });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  return new Request(`http://localhost:3001/api/auth${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function cookieHeader(response: Response): string {
  const pairs = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const parts = pairs.map((value) => value.split(";", 1)[0]?.trim()).filter((value): value is string => Boolean(value));
  if (parts.length > 0) {
    return parts.join("; ");
  }
  const single = response.headers.get("set-cookie");
  const first = single?.split(";", 1)[0]?.trim();
  if (!first) {
    throw new Error("sign-up did not set a session cookie");
  }
  return first;
}
