import { cookies } from "next/headers";
import { createWebClient } from "@/api/client";
import type { FactroveClient } from "@factrove/api-client";

export async function createRequestClient(): Promise<FactroveClient> {
  const cookieStore = await cookies();
  return createWebClient({ cookie: cookieStore.toString() });
}
