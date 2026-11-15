export const apiErrorCatalog = [
  {
    status: [400, 404],
    code: "INVALID_REQUEST",
    description:
      "The request is missing a required field, has the wrong shape, or failed validation. Typical causes are a missing file, an invalid access type, view, format, or artifact id, or invalid UTF-8. Unmatched non-public product routes also return 404 INVALID_REQUEST with message Not found."
  },
  {
    status: 400,
    code: "ORGANIZATION_REQUIRED",
    description:
      "The caller asked to share with an organization but has no current organization membership. Upload with accessType org_shared and PATCH /api/v1/artifacts/{id} for a private artifact both use this code."
  },
  {
    status: 403,
    code: "ORGANIZATION_SETUP_REQUIRED",
    description:
      "The caller is authenticated and has no organization membership. Product routes and API key create, list, and delete return this until POST /api/v1/onboarding/organization creates the first organization. Health, public shares, get-session, and sign-out do not."
  },
  {
    status: 409,
    code: "ORGANIZATION_SELECTION_REQUIRED",
    description:
      "The caller is authenticated, has more than one organization membership, and the session has no active organization that matches one of them. An API key has no active organization and uses the same rule."
  },
  {
    status: 409,
    code: "ORGANIZATION_EXISTS",
    description:
      "POST /api/v1/onboarding/organization found that the signed-in user already has a membership. No second organization is created."
  },
  {
    status: 409,
    code: "ORGANIZATION_CHANGED",
    description:
      "PATCH /api/v1/artifacts/{id} for a private artifact named an organizationId that is not the caller's current membership when the conditional UPDATE reads, or a deadlock, serialization failure, or lock timeout persisted after one retry. The artifact is not written. That UPDATE is the linearization point: an authorization change that commits after its snapshot can land before commit and does not cancel the share. About 16 seconds is the budget for the two attempts, not an endpoint deadline. An artifact that is already org_shared returns 200 instead."
  },
  {
    status: 401,
    code: "UNAUTHENTICATED",
    description:
      "The product route needs a session cookie or Authorization: Bearer API key, and neither was accepted. PATCH /api/v1/artifacts/{id} also returns this when the session was revoked or expired before the conditional update read it, and does not write. A revocation that commits after that snapshot does not cancel the share."
  },
  {
    status: 401,
    code: "PASSWORD_REQUIRED",
    description: "The public share is password protected and the request did not present a valid unlock grant or content ticket."
  },
  {
    status: 401,
    code: "PASSWORD_INCORRECT",
    description: "The password sent to the public unlock route did not match."
  },
  {
    status: 403,
    code: "FORBIDDEN",
    description: "A cookie-authenticated write used an Origin or Referer that is not WEB_ORIGIN or PUBLIC_BASE_URL."
  },
  {
    status: 404,
    code: "ARTIFACT_NOT_FOUND",
    description:
      "The artifact id is unknown, the caller cannot read it, or the public share token is not active. Rename and delete also use this body when the caller is not the creator, including an organization admin or another member who can read an org_shared artifact. Those cases share this body."
  },
  {
    status: 409,
    code: "CONTENT_CONFLICT",
    description:
      "Another replace of the same artifact revision finished first. Upload again to replace the current content. Delete returns this code when concurrent replaces prevent deletion after eight attempts. Retry DELETE."
  },
  {
    status: 413,
    code: "FILE_TOO_LARGE",
    description:
      "The upload is larger than the 10 MiB HTML limit. A JSON body larger than 102,400 bytes uses the same code with message The request is too large."
  },
  {
    status: 413,
    code: "CONTENT_TOO_LARGE",
    description: "Stored HTML is larger than the Markdown conversion input limit."
  },
  {
    status: 415,
    code: "UNSUPPORTED_FILE_TYPE",
    description: "The upload is not a .html or .htm file."
  },
  {
    status: 422,
    code: "CONTENT_TOO_COMPLEX",
    description: "Markdown conversion exceeded its time, memory, nesting, or output limit."
  },
  {
    status: 429,
    code: "RATE_LIMITED",
    description: "Too many public views from one client address, or too many password attempts. Password-attempt 429 responses include Retry-After. Public-view 429 responses do not."
  },
  {
    status: 500,
    code: "INTERNAL_ERROR",
    description: "An unexpected persistence or service failure."
  },
  {
    status: 503,
    code: "STORAGE_UNAVAILABLE",
    description:
      "Object storage failed. A failed upload leaves no artifact row. A failed artifact delete keeps the row. The object may already be gone, so retry DELETE."
  },
  {
    status: 503,
    code: "CONVERSION_UNAVAILABLE",
    description: "The Markdown conversion worker pool is full. This response does not include Retry-After."
  },
  {
    status: 503,
    code: "UNLOCK_UNAVAILABLE",
    description: "Password verification is busy because the process-wide Argon2 gate is saturated or every remaining share check slot is in flight. Includes Retry-After."
  }
] as const;

export type ApiErrorCode = (typeof apiErrorCatalog)[number]["code"];
