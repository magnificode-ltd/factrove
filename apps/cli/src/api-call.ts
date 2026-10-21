import { FactroveApiError } from "@factrove/api-client";
import { CliError } from "./cli-error.js";
import { safeApiOrigin } from "./parse-args.js";

export async function callApi<T>(apiUrl: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof FactroveApiError && error.code === "NETWORK_ERROR") {
      throw new CliError("NETWORK_ERROR", `Could not reach the Factrove API at ${safeApiOrigin(apiUrl)}.`);
    }
    throw error;
  }
}
