import { API_KEY_NAME_MAX_LENGTH, API_KEY_NAME_MIN_LENGTH } from "@factrove/contracts";
import { apiKey } from "@better-auth/api-key";
import type { BetterAuthPlugin } from "better-auth";

/**
 * Official Better Auth API key plugin. The secret is returned once at creation
 * and stored as a SHA-256 hash. Rate limiting is off so a CLI session is not
 * capped at the plugin's default of ten requests per day. Keys do not expire.
 */
export function factroveApiKey(): BetterAuthPlugin {
  return apiKey({
    defaultPrefix: "ftrv_",
    requireName: true,
    minimumNameLength: API_KEY_NAME_MIN_LENGTH,
    maximumNameLength: API_KEY_NAME_MAX_LENGTH,
    enableSessionForAPIKeys: false,
    rateLimit: { enabled: false },
    keyExpiration: {
      defaultExpiresIn: null,
      disableCustomExpiresTime: true,
    },
    startingCharactersConfig: {
      shouldStore: true,
      charactersLength: 12,
    },
  }) as BetterAuthPlugin;
}
