import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const TEST_AUTH_SECRET = "factrove-test-auth-secret-32chars-min";

export type SignedInUser = {
  userId: string;
  email: string;
  name: string;
  cookie: string;
  apiKey: string;
  prefix: string;
  keyId: string;
};

export async function signUpWithApiKey(
  baseUrl: string,
  input: { email: string; password: string; name: string; keyName: string },
): Promise<SignedInUser> {
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
  const cookie = cookieHeader(response);
  const keyResponse = await fetch(`${baseUrl}/api/auth/api-key/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ name: input.keyName }),
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
    userId,
    email: input.email,
    name: input.name,
    cookie,
    apiKey: created.key,
    prefix: created.start ?? created.key.slice(0, 12),
    keyId: created.id,
  };
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
