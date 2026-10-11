import { createFactroveClient, type FactroveClient } from "@factrove/api-client";

export interface WebClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createWebClient(options: WebClientOptions = {}): FactroveClient {
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const requestFetch = options.fetch ?? fetch;
  return createFactroveClient({
    baseUrl,
    fetch: (input, init) => requestFetch(input, { ...init, cache: "no-store" })
  });
}
