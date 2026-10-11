import { FactroveApiError } from "@factrove/api-client";

const UNAVAILABLE = "The Factrove API is unavailable. Start the backend and refresh.";

export function unavailableMessage(error: unknown): string {
  if (error instanceof FactroveApiError) {
    if (error.status === null || error.code === "NETWORK_ERROR") return UNAVAILABLE;
    const message = error.message.trim();
    if (message) return message;
  }
  return UNAVAILABLE;
}
