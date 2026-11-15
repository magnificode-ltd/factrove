import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const TEST_AUTH_SECRET = "factrove-test-auth-secret-32chars-min";

export type SignedUpUser = {
  userId: string;
  email: string;
  name: string;
  cookie: string;
};

export type ApiKeyUser = SignedUpUser & {
  apiKey: string;
  prefix: string;
  keyId: string;
};

export type SignedInUser = ApiKeyUser & {
  organizationId: string;
};

export async function signUp(
  baseUrl: string,
  input: { email: string; password: string; name: string },
): Promise<SignedUpUser> {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      name: input.name,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`sign-up failed ${response.status}: ${text}`);
  }
  const body = JSON.parse(text) as { user?: { id?: string } };
  const userId = body.user?.id;
  if (!userId) {
    throw new Error(`sign-up did not return a user: ${text}`);
  }
  return {
    userId,
    email: input.email,
    name: input.name,
    cookie: cookieHeader(response),
  };
}

export async function createSessionApiKey(
  baseUrl: string,
  cookie: string,
  keyName: string,
): Promise<{ apiKey: string; prefix: string; keyId: string }> {
  const keyResponse = await fetch(`${baseUrl}/api/auth/api-key/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ name: keyName }),
  });
  const keyText = await keyResponse.text();
  if (!keyResponse.ok) {
    throw new Error(`api key create failed ${keyResponse.status}: ${keyText}`);
  }
  const created = JSON.parse(keyText) as { id?: string; key?: string; start?: string | null };
  if (!created.id || !created.key) {
    throw new Error(`api key create did not return a key: ${keyText}`);
  }
  return {
    apiKey: created.key,
    prefix: created.start ?? created.key.slice(0, 12),
    keyId: created.id,
  };
}

export async function createFirstOrganization(
  baseUrl: string,
  cookie: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const response = await fetch(`${baseUrl}/api/v1/onboarding/organization`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ name }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`organization create failed ${response.status}: ${text}`);
  }
  const body = JSON.parse(text) as { organization?: { id?: string; name?: string } };
  const id = body.organization?.id;
  const organizationName = body.organization?.name;
  if (!id || !organizationName) {
    throw new Error(`organization create did not return an organization: ${text}`);
  }
  return { id, name: organizationName };
}

export async function signUpWithApiKey(
  baseUrl: string,
  input: { email: string; password: string; name: string; keyName: string },
): Promise<SignedInUser> {
  const session = await signUp(baseUrl, input);
  const organization = await createFirstOrganization(baseUrl, session.cookie, `${input.name}'s organization`);
  const key = await createSessionApiKey(baseUrl, session.cookie, input.keyName);
  return { ...session, ...key, organizationId: organization.id };
}

export async function signUpInOrganization(
  baseUrl: string,
  prisma: PrismaClient,
  input: { email: string; password: string; name: string; keyName: string },
  organizationId: string,
): Promise<SignedInUser> {
  const session = await signUp(baseUrl, input);
  await addMembership(prisma, session.userId, organizationId);
  const key = await createSessionApiKey(baseUrl, session.cookie, input.keyName);
  return { ...session, ...key, organizationId };
}

export async function createUserWithApiKey(
  prisma: PrismaClient,
  input: { email: string; name: string; keyName: string },
): Promise<ApiKeyUser> {
  const userId = randomUUID();
  const now = new Date();
  await prisma.user.create({
    data: {
      id: userId,
      name: input.name,
      email: input.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  const apiKey = `ftrv_${randomBytes(32).toString("base64url")}`;
  const keyId = randomUUID();
  await prisma.apikey.create({
    data: {
      id: keyId,
      name: input.keyName,
      start: apiKey.slice(0, 12),
      prefix: "ftrv_",
      referenceId: userId,
      key: createHash("sha256").update(apiKey).digest("base64url"),
      enabled: true,
      rateLimitEnabled: false,
      createdAt: now,
      updatedAt: now,
    },
  });
  return {
    userId,
    email: input.email,
    name: input.name,
    cookie: "",
    apiKey,
    prefix: apiKey.slice(0, 12),
    keyId,
  };
}

export async function addOwnedOrganization(prisma: PrismaClient, userId: string, slug: string): Promise<string> {
  await prisma.organization.create({
    data: { id: slug, name: slug, slug, createdAt: new Date() },
  });
  await addMembership(prisma, userId, slug);
  return slug;
}

export async function addMembership(prisma: PrismaClient, userId: string, organizationId: string): Promise<void> {
  await prisma.member.create({
    data: {
      id: randomUUID(),
      organizationId,
      userId,
      role: "member",
      createdAt: new Date(),
    },
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
