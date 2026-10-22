import { createFactroveClient, type FactroveClient } from "@factrove/api-client";
import { browserApiUrl } from "@/public-config";

export interface WebClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  cookie?: string;
}

export function createWebClient(options: WebClientOptions = {}): FactroveClient {
  const baseUrl = options.baseUrl ?? browserApiUrl();
  const requestFetch = options.fetch ?? fetch;
  return createFactroveClient({
    baseUrl,
    cookie: options.cookie,
    fetch: (input, init) => requestFetch(input, { ...init, cache: "no-store", credentials: "include" })
  });
}

// Anonymous public reads. credentials omit keeps the browser from attaching a session cookie,
// and the API sees the visitor's address rather than the Next.js server.
export function createPublicBrowserClient(fetchImpl: typeof fetch = fetch): FactroveClient {
  const baseUrl = browserApiUrl();
  return createFactroveClient({
    baseUrl,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.delete("cookie");
      return fetchImpl(input, { ...init, headers, cache: "no-store", credentials: "omit" });
    }
  });
}
