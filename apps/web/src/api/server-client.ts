import { cookies } from "next/headers";
import { createFactroveClient, type FactroveClient } from "@factrove/api-client";
import { createWebClient } from "@/api/client";
import { serverApiUrl } from "@/public-config";

export async function createRequestClient(): Promise<FactroveClient> {
  const cookieStore = await cookies();
  return createWebClient({ baseUrl: serverApiUrl(), cookie: cookieStore.toString() });
}

// Invitation preview does not need a session. Omitting the cookie keeps this
// server-side check outside the cookie-origin guard.
export function createAnonymousServerClient(): FactroveClient {
  return createFactroveClient({
    baseUrl: serverApiUrl(),
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.delete("cookie");
      headers.delete("authorization");
      return fetch(input, {
        ...init,
        headers,
        cache: "no-store",
        credentials: "omit",
        signal: init?.signal ?? AbortSignal.timeout(5_000),
      });
    },
  });
}
