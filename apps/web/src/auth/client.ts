"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { createAuthClient } from "better-auth/react";

type AuthError = { message?: string; status?: number } | null;

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

export const authClient: FactroveAuthClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001",
  plugins: [apiKeyClient()],
  fetchOptions: {
    credentials: "include",
  },
}) as unknown as FactroveAuthClient;
