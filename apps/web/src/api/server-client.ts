import { cookies } from "next/headers";
import { createWebClient } from "@/api/client";
import { serverApiUrl } from "@/public-config";
import type { FactroveClient } from "@factrove/api-client";

export async function createRequestClient(): Promise<FactroveClient> {
  const cookieStore = await cookies();
  return createWebClient({ baseUrl: serverApiUrl(), cookie: cookieStore.toString() });
}
