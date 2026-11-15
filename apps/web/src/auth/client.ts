"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/react";
import { browserApiUrl } from "@/public-config";

type AuthError = { message?: string; status?: number; code?: string } | null;

type AuthCall = {
  error: AuthError;
};

export type FactroveAuthClient = {
  signIn: {
    email: (input: { email: string; password: string }) => Promise<AuthCall>;
  };
  signUp: {
    email: (input: { name: string; email: string; password: string }) => Promise<AuthCall>;
  };
  signOut: () => Promise<unknown>;
  requestPasswordReset: (input: { email: string }) => Promise<AuthCall>;
  resetPassword: (input: { newPassword: string; token: string }) => Promise<AuthCall>;
  sendVerificationEmail: (input: { email: string; callbackURL?: string }) => Promise<AuthCall>;
  verifyEmail: (input: { query: { token: string } }) => Promise<AuthCall>;
  getSession: () => Promise<{
    data: { user: { id: string; email: string; name: string; emailVerified: boolean } } | null;
    error: AuthError;
  }>;
  apiKey: {
    list: () => Promise<{
      data: { apiKeys: Array<{ id: string; name: string | null; start: string | null }> } | null;
      error: AuthError;
    }>;
    create: (input: { name: string }) => Promise<{
      data: { key: string } | null;
      error: AuthError;
    }>;
    delete: (input: { keyId: string }) => Promise<{
      data: { success: boolean } | null;
      error: AuthError;
    }>;
  };
};

let cached: FactroveAuthClient | undefined;

function client(): FactroveAuthClient {
  cached ??= createAuthClient({
    baseURL: browserApiUrl(),
    plugins: [apiKeyClient()],
    fetchOptions: {
      credentials: "include",
    },
  }) as unknown as FactroveAuthClient;
  return cached;
}

export const authClient: FactroveAuthClient = {
  signIn: {
    email: (input) => client().signIn.email(input),
  },
  signUp: {
    email: (input) => client().signUp.email(input),
  },
  signOut: () => client().signOut(),
  requestPasswordReset: (input) => client().requestPasswordReset(input),
  resetPassword: (input) => client().resetPassword(input),
  sendVerificationEmail: (input) => client().sendVerificationEmail(input),
  verifyEmail: (input) => client().verifyEmail(input),
  getSession: () => client().getSession(),
  apiKey: {
    list: () => client().apiKey.list(),
    create: (input) => client().apiKey.create(input),
    delete: (input) => client().apiKey.delete(input),
  },
};
