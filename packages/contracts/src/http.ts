import { z } from "zod";
import {
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_NAME_MIN_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  SHARE_GRANT_HEADER,
  accessTypeSchema,
  artifactEnvelopeSchema,
  artifactListEnvelopeSchema,
  artifactViewSchema,
  contentFormatSchema,
  contextEnvelopeSchema,
  createShareRequestSchema,
  healthEnvelopeSchema,
  publicArtifactEnvelopeSchema,
  publicUnlockEnvelopeSchema,
  publicUnlockRequestSchema,
  shareEnvelopeSchema
} from "./index.js";

export const createApiKeyRequestSchema = z.object({
  name: z.string().min(API_KEY_NAME_MIN_LENGTH).max(API_KEY_NAME_MAX_LENGTH)
});

export const deleteApiKeyRequestSchema = z.object({
  keyId: z.string().min(1)
});

export const createApiKeyResponseSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    key: z.string(),
    start: z.string().nullable().optional()
  })
  .passthrough();

export const listApiKeysResponseSchema = z
  .object({
    apiKeys: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          start: z.string().nullable().optional()
        })
        .passthrough()
    ),
    total: z.number().int().nonnegative()
  })
  .passthrough();

export const deleteApiKeyResponseSchema = z.object({ success: z.literal(true) }).passthrough();

export const signUpEmailRequestSchema = z.object({
  name: z.string(),
  email: z.string(),
  password: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH)
});

export const signInEmailRequestSchema = z.object({
  email: z.string(),
  password: z.string().min(AUTH_PASSWORD_MIN_LENGTH).max(AUTH_PASSWORD_MAX_LENGTH)
});

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export type HttpSecurity = "none" | "sessionOrApiKey" | "sessionOrApiKeyOrContentGrant" | "owner" | "session";
export type ResponseContentType = "application/json" | "text/html" | "text/markdown";

export type HeaderParameter = {
  name: string;
  required: boolean;
  description: string;
  schemaName?: string;
};

export type QueryParameter = {
  name: string;
  required: boolean;
  description: string;
  schema: z.ZodType;
};

export type PathParameter = {
  name: string;
  description: string;
  schema: z.ZodType;
};

export type RequestBodySpec =
  | {
      contentType: "application/json";
      required: boolean;
      description: string;
      schema: z.ZodType;
      schemaName: string;
    }
  | {
      contentType: "multipart/form-data";
      required: boolean;
      description: string;
      schema: z.ZodType;
      schemaName: string;
    };

export type ResponseHeaderSpec = {
  name: string;
  description: string;
};

export type ResponseSpec = {
  description: string;
  schema?: z.ZodType;
  schemaName?: string;
  contentType?: ResponseContentType;
  contentTypes?: readonly ResponseContentType[];
  headers?: readonly ResponseHeaderSpec[];
};

export type HttpOperation = {
  operationId: string;
  method: HttpMethod;
  path: string;
  tags: readonly string[];
  summary: string;
  description: string;
  security: HttpSecurity;
  pathParameters?: readonly PathParameter[];
  queryParameters?: readonly QueryParameter[];
  headerParameters?: readonly HeaderParameter[];
  requestBody?: RequestBodySpec;
  responses: Record<string, ResponseSpec>;
};

const artifactIdParam: PathParameter = {
  name: "id",
  description: "Artifact UUID.",
  schema: z.string().uuid()
};

const shareTokenParam: PathParameter = {
  name: "token",
  description: "Public share token from the owner share URL. The stored column is a hash, not this value.",
  schema: z.string().min(1)
};

const retryAfterHeader: ResponseHeaderSpec = {
  name: "Retry-After",
  description: "Seconds to wait before retrying. Set when retryAfterSeconds is present on the thrown API error."
};

const uploadFormSchema = z.object({
  file: z.string().describe("One non-empty .html or .htm file, at most 10 MiB."),
  accessType: accessTypeSchema.optional()
});

const replaceFormSchema = z.object({
  file: z.string().describe("One non-empty .html or .htm file, at most 10 MiB. accessType is not accepted.")
});

const apiErrorResponse: ResponseSpec = {
  description: "JSON error envelope `{ error: { code, message } }`.",
  schemaName: "ApiError"
};

const ownerShareReadErrors = {
  "400": apiErrorResponse,
  "401": {
    description: "Missing session or API key. Code `UNAUTHENTICATED`.",
    schemaName: "ApiError"
  },
  "404": {
    description: "Unknown artifact, or the caller is not the owner. Code `ARTIFACT_NOT_FOUND`.",
    schemaName: "ApiError"
  },
  "500": apiErrorResponse
} as const;

const ownerShareWriteErrors = {
  ...ownerShareReadErrors,
  "403": {
    description: "Cookie-authenticated write from an origin that is not allowed. Code `FORBIDDEN`.",
    schemaName: "ApiError"
  }
} as const;

export const namedSchemas: Record<string, z.ZodType> = {
  AccessType: accessTypeSchema,
  ArtifactView: artifactViewSchema,
  ContentFormat: contentFormatSchema,
  ArtifactEnvelope: artifactEnvelopeSchema,
  ArtifactListEnvelope: artifactListEnvelopeSchema,
  ContextEnvelope: contextEnvelopeSchema,
  HealthEnvelope: healthEnvelopeSchema,
  ShareEnvelope: shareEnvelopeSchema,
  CreateShareRequest: createShareRequestSchema,
  PublicArtifactEnvelope: publicArtifactEnvelopeSchema,
  PublicUnlockRequest: publicUnlockRequestSchema,
  PublicUnlockEnvelope: publicUnlockEnvelopeSchema,
  UploadForm: uploadFormSchema,
  ReplaceForm: replaceFormSchema,
  CreateApiKeyRequest: createApiKeyRequestSchema,
  CreateApiKeyResponse: createApiKeyResponseSchema,
  ListApiKeysResponse: listApiKeysResponseSchema,
  DeleteApiKeyRequest: deleteApiKeyRequestSchema,
  DeleteApiKeyResponse: deleteApiKeyResponseSchema,
  SignUpEmailRequest: signUpEmailRequestSchema,
  SignInEmailRequest: signInEmailRequestSchema
};

export const httpOperations: HttpOperation[] = [
  {
    operationId: "getHealth",
    method: "get",
    path: "/api/v1/health",
    tags: ["Health"],
    summary: "Check that the API is initialized",
    description: "Returns `{ status: \"ok\" }` after the process has started. No credentials.",
    security: "none",
    responses: {
      "200": {
        description: "The API is initialized.",
        schema: healthEnvelopeSchema,
        schemaName: "HealthEnvelope"
      }
    }
  },
  {
    operationId: "getContext",
    method: "get",
    path: "/api/v1/context",
    tags: ["Auth"],
    summary: "Return the caller and current organization",
    description:
      "Reads the session cookie or `Authorization: Bearer` API key. An API key has no active organization, so the organization is the caller's only membership, or null when they have none or more than one. A present Authorization header that is not a valid key does not fall back to the session cookie. `x-api-key` does not authenticate.",
    security: "sessionOrApiKey",
    responses: {
      "200": {
        description: "The signed-in user and current organization.",
        schema: contextEnvelopeSchema,
        schemaName: "ContextEnvelope"
      },
      "401": {
        description: "Missing or invalid credentials. Code `UNAUTHENTICATED`.",
        schemaName: "ApiError"
      }
    }
  },
  {
    operationId: "signUpEmail",
    method: "post",
    path: "/api/auth/sign-up/email",
    tags: ["Auth"],
    summary: "Create an account with email and password",
    description:
      "Better Auth email/password sign-up. Email verification is off. Passwords are 8 to 128 characters, the same limits createAuth passes to Better Auth. This route is rate limited to 10 requests per 60 seconds per client address. The response body is Better Auth JSON, not the product `{ error: { code, message } }` envelope. A successful sign-up sets the session cookie and can return the user.",
    security: "none",
    requestBody: {
      contentType: "application/json",
      required: true,
      description: "Display name, email, and password (8 to 128 characters).",
      schema: signUpEmailRequestSchema,
      schemaName: "SignUpEmailRequest"
    },
    responses: {
      "200": { description: "Account created. Better Auth JSON that includes the user." },
      "400": {
        description:
          "Better Auth validation failure, such as `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, or `INVALID_EMAIL`."
      },
      "422": { description: "The email is already registered. Better Auth `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`." },
      "429": { description: "Too many sign-up attempts from this client address." }
    }
  },
  {
    operationId: "signInEmail",
    method: "post",
    path: "/api/auth/sign-in/email",
    tags: ["Auth"],
    summary: "Sign in with email and password",
    description:
      "Better Auth email/password sign-in. Passwords are 8 to 128 characters. Rate limited to 10 requests per 60 seconds per client address. Sets the session cookie. The response body is Better Auth JSON.",
    security: "none",
    requestBody: {
      contentType: "application/json",
      required: true,
      description: "Email and password (8 to 128 characters).",
      schema: signInEmailRequestSchema,
      schemaName: "SignInEmailRequest"
    },
    responses: {
      "200": { description: "Signed in. Better Auth JSON and a session cookie." },
      "400": { description: "Better Auth validation failure, such as `INVALID_EMAIL` or `PASSWORD_TOO_LONG`." },
      "401": { description: "Unknown user or wrong password. Better Auth `INVALID_EMAIL_OR_PASSWORD`." },
      "429": { description: "Too many sign-in attempts from this client address." }
    }
  },
  {
    operationId: "createApiKey",
    method: "post",
    path: "/api/auth/api-key/create",
    tags: ["Auth"],
    summary: "Create an API key",
    description:
      "Requires a browser session. Do not send `Authorization`. A request that also sends it is 401 with message `API key management requires a browser session.` Cookie writes need `Origin` or `Referer` to be `WEB_ORIGIN` or `PUBLIC_BASE_URL`. A missing or different origin is 403 `FORBIDDEN` before Better Auth runs. The secret is returned once in `key`. The plugin stores only a hash. Keys use the `ftrv_` prefix and do not expire. The plugin's own per-key rate limit is off.",
    security: "session",
    requestBody: {
      contentType: "application/json",
      required: true,
      description: `A name is required, ${API_KEY_NAME_MIN_LENGTH} to ${API_KEY_NAME_MAX_LENGTH} characters.`,
      schema: createApiKeyRequestSchema,
      schemaName: "CreateApiKeyRequest"
    },
    responses: {
      "200": {
        description: "The new key, including `key` once.",
        schema: createApiKeyResponseSchema,
        schemaName: "CreateApiKeyResponse"
      },
      "400": {
        description:
          "Empty or missing name is Better Auth `NAME_REQUIRED` (`API Key name is required.`). A name longer than 32 characters is `INVALID_NAME_LENGTH`."
      },
      "401": { description: "No browser session, or Authorization was also sent." },
      "403": {
        description:
          "Cookie write whose Origin or Referer is not WEB_ORIGIN or PUBLIC_BASE_URL. Code `FORBIDDEN`.",
        schemaName: "ApiError"
      }
    }
  },
  {
    operationId: "listApiKeys",
    method: "get",
    path: "/api/auth/api-key/list",
    tags: ["Auth"],
    summary: "List API keys for the session",
    description:
      "Requires a browser session. Returns names and starting characters, not the secret. Better Auth JSON `{ apiKeys, total }`.",
    security: "session",
    responses: {
      "200": {
        description: "Keys for the signed-in user, without `key`.",
        schema: listApiKeysResponseSchema,
        schemaName: "ListApiKeysResponse"
      },
      "401": { description: "No browser session, or Authorization was also sent." }
    }
  },
  {
    operationId: "deleteApiKey",
    method: "post",
    path: "/api/auth/api-key/delete",
    tags: ["Auth"],
    summary: "Revoke an API key",
    description:
      "Requires a browser session. Do not send `Authorization`. Cookie writes need `Origin` or `Referer` to be `WEB_ORIGIN` or `PUBLIC_BASE_URL`. A missing or different origin is 403 `FORBIDDEN`. Another user's key id is 404. After delete, that key fails closed on product routes.",
    security: "session",
    requestBody: {
      contentType: "application/json",
      required: true,
      description: "The key id to delete.",
      schema: deleteApiKeyRequestSchema,
      schemaName: "DeleteApiKeyRequest"
    },
    responses: {
      "200": {
        description: "The key was deleted.",
        schema: deleteApiKeyResponseSchema,
        schemaName: "DeleteApiKeyResponse"
      },
      "401": { description: "No browser session, or Authorization was also sent." },
      "403": {
        description:
          "Cookie write whose Origin or Referer is not WEB_ORIGIN or PUBLIC_BASE_URL. Code `FORBIDDEN`.",
        schemaName: "ApiError"
      },
      "404": { description: "The key id is unknown to this session." }
    }
  },
  {
    operationId: "uploadArtifact",
    method: "post",
    path: "/api/v1/artifacts",
    tags: ["Artifacts"],
    summary: "Upload an HTML file",
    description:
      "Accepts one non-empty `.html` or `.htm` file as multipart field `file`, optional `accessType` (`private` default, or `org_shared`). The backend assigns `text/html`. Maximum size is 10 MiB. Each request creates a new artifact. The object is written first, then the row. A storage failure leaves no row. Cookie-authenticated writes also require Origin or Referer to be WEB_ORIGIN or PUBLIC_BASE_URL.",
    security: "sessionOrApiKey",
    requestBody: {
      contentType: "multipart/form-data",
      required: true,
      description: "One file and an optional access type.",
      schema: uploadFormSchema,
      schemaName: "UploadForm"
    },
    responses: {
      "201": {
        description: "The new artifact.",
        schema: artifactEnvelopeSchema,
        schemaName: "ArtifactEnvelope"
      },
      "400": {
        description: "Invalid multipart body, access type, or UTF-8. Codes `INVALID_REQUEST` or `ORGANIZATION_REQUIRED`.",
        schemaName: "ApiError"
      },
      "401": { description: "Missing credentials. Code `UNAUTHENTICATED`.", schemaName: "ApiError" },
      "403": { description: "Cookie write from a disallowed origin. Code `FORBIDDEN`.", schemaName: "ApiError" },
      "413": { description: "The file is larger than 10 MiB. Code `FILE_TOO_LARGE`.", schemaName: "ApiError" },
      "415": { description: "The file is not HTML. Code `UNSUPPORTED_FILE_TYPE`.", schemaName: "ApiError" },
      "503": {
        description: "Object storage failed. Code `STORAGE_UNAVAILABLE`. No artifact row is stored.",
        schemaName: "ApiError"
      }
    }
  },
  {
    operationId: "replaceArtifactContent",
    method: "put",
    path: "/api/v1/artifacts/{id}/content",
    tags: ["Artifacts"],
    summary: "Replace an artifact's stored HTML",
    description:
      "Owner only. Multipart field `file` is the same HTML validation as create: one non-empty `.html` or `.htm` file, at most 10 MiB, UTF-8. `accessType` is rejected. The id, current access, and any share token stay the same. The new object is written first, then the row points at it. Another replace of the same revision is `409 CONTENT_CONFLICT`. A commit that throws after the object is written can still land; if the client sees 500 it should GET the artifact before retrying. Cookie-authenticated writes need an allowed Origin.",
    security: "owner",
    pathParameters: [artifactIdParam],
    requestBody: {
      contentType: "multipart/form-data",
      required: true,
      description: "One HTML file. Do not send accessType.",
      schema: replaceFormSchema,
      schemaName: "ReplaceForm"
    },
    responses: {
      "200": {
        description: "The same artifact id with the new size and upload time.",
        schema: artifactEnvelopeSchema,
        schemaName: "ArtifactEnvelope"
      },
      "400": {
        description: "Invalid multipart body, accessType on replace, or UTF-8. Code `INVALID_REQUEST`.",
        schemaName: "ApiError"
      },
      "401": { description: "Missing credentials. Code `UNAUTHENTICATED`.", schemaName: "ApiError" },
      "403": { description: "Cookie write from a disallowed origin. Code `FORBIDDEN`.", schemaName: "ApiError" },
      "404": {
        description: "Unknown artifact, or the caller is not the owner. Code `ARTIFACT_NOT_FOUND`.",
        schemaName: "ApiError"
      },
      "409": {
        description: "Another replace finished first. Code `CONTENT_CONFLICT`.",
        schemaName: "ApiError"
      },
      "413": { description: "The file is larger than 10 MiB. Code `FILE_TOO_LARGE`.", schemaName: "ApiError" },
      "415": { description: "The file is not HTML. Code `UNSUPPORTED_FILE_TYPE`.", schemaName: "ApiError" },
      "500": {
        description:
          "The replace commit threw after the object was written. The new bytes may already be live. GET the artifact before retrying. Code `INTERNAL_ERROR`.",
        schemaName: "ApiError"
      },
      "503": {
        description: "Object storage failed before the row was updated. Code `STORAGE_UNAVAILABLE`.",
        schemaName: "ApiError"
      }
    }
  },
  {
    operationId: "listArtifacts",
    method: "get",
    path: "/api/v1/artifacts",
    tags: ["Artifacts"],
    summary: "List artifacts for the caller",
    description:
      "`view=mine` (default) is artifacts the caller created. `view=org` is org_shared artifacts in the caller's current organization, including other creators. With no current organization, `view=org` is an empty list. Sorted by createdAt descending, then id descending. The whole list is returned.",
    security: "sessionOrApiKey",
    queryParameters: [
      {
        name: "view",
        required: false,
        description: "`mine` or `org`. Defaults to `mine`.",
        schema: artifactViewSchema
      }
    ],
    responses: {
      "200": {
        description: "Matching artifacts.",
        schema: artifactListEnvelopeSchema,
        schemaName: "ArtifactListEnvelope"
      },
      "400": { description: "Invalid view. Code `INVALID_REQUEST`.", schemaName: "ApiError" },
      "401": { description: "Missing credentials. Code `UNAUTHENTICATED`.", schemaName: "ApiError" }
    }
  },
  {
    operationId: "getArtifact",
    method: "get",
    path: "/api/v1/artifacts/{id}",
    tags: ["Artifacts"],
    summary: "Get artifact metadata",
    description:
      "Owner and, for org_shared artifacts, organization members can read this. Missing credentials, an invalid key, and anyone who cannot read the artifact get the same 404 as an unknown id. This route does not return 401. A session-authenticated response may append `?access=` on `contentUrl` so the sandboxed iframe can load HTML without cookies. API-key responses omit that grant.",
    security: "sessionOrApiKey",
    pathParameters: [artifactIdParam],
    responses: {
      "200": {
        description: "Artifact metadata, including whether a public share is active.",
        schema: artifactEnvelopeSchema,
        schemaName: "ArtifactEnvelope"
      },
      "400": { description: "The id is not a UUID. Code `INVALID_REQUEST`.", schemaName: "ApiError" },
      "404": {
        description: "Unknown or unreadable artifact, including missing or invalid credentials. Code `ARTIFACT_NOT_FOUND`.",
        schemaName: "ApiError"
      }
    }
  },
  {
    operationId: "getArtifactContent",
    method: "get",
    path: "/api/v1/artifacts/{id}/content",
    tags: ["Artifacts"],
    summary: "Download artifact HTML or converted Markdown",
    description:
      "Default format is HTML, the stored bytes, `Content-Type: text/html`. `format=markdown` converts that HTML on a worker and returns `text/markdown`. Markdown is not stored. `Accept` does not choose the format. Optional `access` is a short-lived HMAC grant for HTML in the viewer iframe and authenticates the request by itself when no Authorization or x-api-key header is present. A present credential header disables the grant. Markdown ignores it. Missing credentials without a valid grant are the same 404 as an unknown id.",
    security: "sessionOrApiKeyOrContentGrant",
    pathParameters: [artifactIdParam],
    queryParameters: [
      {
        name: "format",
        required: false,
        description: "`html` or `markdown`. Omitted means `html`.",
        schema: contentFormatSchema
      },
      {
        name: "access",
        required: false,
        description: "Viewer content grant. HTML only, at most five minutes, ignored when a credential header is present. A valid grant returns 200 with no cookie or bearer key.",
        schema: z.string().min(1)
      }
    ],
    responses: {
      "200": {
        description: "HTML (`text/html`) or Markdown (`text/markdown`) bytes with charset=utf-8.",
        contentTypes: ["text/html", "text/markdown"]
      },
      "400": { description: "Invalid format or UTF-8. Code `INVALID_REQUEST`.", schemaName: "ApiError" },
      "404": {
        description: "Unknown or unreadable artifact, including missing credentials without a valid `access` grant. Code `ARTIFACT_NOT_FOUND`.",
        schemaName: "ApiError"
      },
      "413": {
        description: "Stored HTML exceeds the Markdown input limit. Code `CONTENT_TOO_LARGE`.",
        schemaName: "ApiError"
      },
      "422": { description: "Conversion limits exceeded. Code `CONTENT_TOO_COMPLEX`.", schemaName: "ApiError" },
      "503": {
        description:
          "Object storage failed (`STORAGE_UNAVAILABLE`) or the Markdown conversion pool is full (`CONVERSION_UNAVAILABLE`). Neither sets Retry-After.",
        schemaName: "ApiError"
      }
    }
  },
  {
    operationId: "getArtifactShare",
    method: "get",
    path: "/api/v1/artifacts/{id}/share",
    tags: ["Shares"],
    summary: "Read the owner share state",
    description:
      "Only the creator can read the share. Other members who can read an org_shared artifact get the same 404 as a missing id. When the stored token cannot be decrypted with the current key, the response is `{ shared: false, shareUrl: null }`.",
    security: "owner",
    pathParameters: [artifactIdParam],
    responses: {
      "200": {
        description: "Whether the artifact is shared, the public URL when it is, and password state.",
        schema: shareEnvelopeSchema,
        schemaName: "ShareEnvelope"
      },
      ...ownerShareReadErrors
    }
  },
  {
    operationId: "createArtifactShare",
    method: "post",
    path: "/api/v1/artifacts/{id}/share",
    tags: ["Shares"],
    summary: "Create or update a public share",
    description:
      "Creates a public link, or returns the existing one while the current key can still read the token. An optional JSON body `{ password }` sets or replaces the link password. Omitting the password keeps the current one. Passwords are 10 to 128 NFC characters, at least four distinct characters, not all whitespace, and not on the bundled common-password list. Repeating the request without a password returns the same link. Cookie writes require an allowed Origin.",
    security: "owner",
    pathParameters: [artifactIdParam],
    requestBody: {
      contentType: "application/json",
      required: false,
      description: "Optional `{ password }`. No body keeps the current password.",
      schema: createShareRequestSchema,
      schemaName: "CreateShareRequest"
    },
    responses: {
      "200": {
        description: "The public link and whether it is password protected.",
        schema: shareEnvelopeSchema,
        schemaName: "ShareEnvelope"
      },
      ...ownerShareWriteErrors
    }
  },
  {
    operationId: "revokeArtifactShare",
    method: "delete",
    path: "/api/v1/artifacts/{id}/share",
    tags: ["Shares"],
    summary: "Revoke the public share",
    description: "Clears the share token and the password. The previous URL becomes the same 404 as a missing artifact.",
    security: "owner",
    pathParameters: [artifactIdParam],
    responses: {
      "200": {
        description: "`shared` is false and `shareUrl` is null.",
        schema: shareEnvelopeSchema,
        schemaName: "ShareEnvelope"
      },
      ...ownerShareWriteErrors
    }
  },
  {
    operationId: "removeArtifactSharePassword",
    method: "delete",
    path: "/api/v1/artifacts/{id}/share/password",
    tags: ["Shares"],
    summary: "Remove the password from a shared link",
    description:
      "When the artifact is shared, the share URL stays the same, `passwordProtected` becomes false, and existing unlock grants become invalid. When the artifact is not shared, the response is `{ shared: false, shareUrl: null, passwordProtected: false }`.",
    security: "owner",
    pathParameters: [artifactIdParam],
    responses: {
      "200": {
        description:
          "The current share state. A shared artifact stays shared without a password. An unshared artifact stays unshared.",
        schema: shareEnvelopeSchema,
        schemaName: "ShareEnvelope"
      },
      ...ownerShareWriteErrors
    }
  },
  {
    operationId: "getPublicArtifact",
    method: "get",
    path: "/api/v1/public/artifacts/{id}/{token}",
    tags: ["Public"],
    summary: "Read a public share",
    description:
      "No session. The response omits creator, organization, access type, and the share URL. An inactive, unknown, or revoked token is `404 ARTIFACT_NOT_FOUND` and does not say whether the artifact exists. A password-protected share without a valid `X-Factrove-Share-Grant` is `401 PASSWORD_REQUIRED`. Each accepted detail counts as one view unit and grants two companion content loads for 30 seconds that do not consume another view unit. View units are limited to 60 per 60 seconds per client address, in memory on each API process. A content request without a remaining companion charges another view unit. That 429 does not include Retry-After. Responses send Referrer-Policy: no-referrer and X-Robots-Tag: noindex.",
    security: "none",
    pathParameters: [artifactIdParam, shareTokenParam],
    headerParameters: [
      {
        name: SHARE_GRANT_HEADER,
        required: false,
        description:
          "Unlock grant from POST /unlock. Never a cookie and never part of a URL. The HTTP header is `X-Factrove-Share-Grant`."
      }
    ],
    responses: {
      "200": {
        description: "Public artifact metadata. `contentUrl` may include a short-lived `ticket` query after a grant.",
        schema: publicArtifactEnvelopeSchema,
        schemaName: "PublicArtifactEnvelope"
      },
      "401": {
        description: "The link needs a password and the grant is missing or invalid. Code `PASSWORD_REQUIRED`.",
        schemaName: "ApiError"
      },
      "404": { description: "The link is not active. Code `ARTIFACT_NOT_FOUND`.", schemaName: "ApiError" },
      "429": {
        description:
          "Too many public view units from this client address. Code `RATE_LIMITED`. No Retry-After. Companion content loads after a successful detail do not consume a view unit.",
        schemaName: "ApiError"
      }
    }
  },
  {
    operationId: "unlockPublicArtifact",
    method: "post",
    path: "/api/v1/public/artifacts/{id}/{token}/unlock",
    tags: ["Public"],
    summary: "Unlock a password-protected share",
    description:
      "No session. JSON `{ password }`. A matching password returns `{ grant: { token, expiresAt } }` valid for 15 minutes. A link with no password returns `{ grant: null }`. A wrong password is `401 PASSWORD_INCORRECT`. An inactive link is `404 ARTIFACT_NOT_FOUND`. A missing or non-JSON body is `400 INVALID_REQUEST` before any password throttle is charged. Client failures allow 10 per 10 minutes. Share failures allow 30 per 10 minutes, charged only after a wrong password. An exhausted share is `429 RATE_LIMITED` with `Retry-After` and no hash verification. A saturated Argon2 gate, or a share whose remaining slots are all in flight, is `503 UNLOCK_UNAVAILABLE` with `Retry-After`. This route ignores a leftover session cookie and does not apply the cookie origin guard.",
    security: "none",
    pathParameters: [artifactIdParam, shareTokenParam],
    requestBody: {
      contentType: "application/json",
      required: true,
      description: "The link password.",
      schema: publicUnlockRequestSchema,
      schemaName: "PublicUnlockRequest"
    },
    responses: {
      "200": {
        description: "A grant for a protected link, or null when the link has no password.",
        schema: publicUnlockEnvelopeSchema,
        schemaName: "PublicUnlockEnvelope"
      },
      "400": { description: "Missing or non-JSON body. Code `INVALID_REQUEST`.", schemaName: "ApiError" },
      "401": {
        description: "Wrong password. Code `PASSWORD_INCORRECT`.",
        schemaName: "ApiError"
      },
      "404": { description: "The link is not active. Code `ARTIFACT_NOT_FOUND`.", schemaName: "ApiError" },
      "429": {
        description:
          "Too many password attempts for this client or this share. Code `RATE_LIMITED`. Includes Retry-After for share lockout.",
        schemaName: "ApiError",
        headers: [retryAfterHeader]
      },
      "503": {
        description: "Password verification is busy. Code `UNLOCK_UNAVAILABLE`. Includes Retry-After.",
        schemaName: "ApiError",
        headers: [retryAfterHeader]
      }
    }
  },
  {
    operationId: "getPublicArtifactContent",
    method: "get",
    path: "/api/v1/public/artifacts/{id}/{token}/content",
    tags: ["Public"],
    summary: "Download public share HTML",
    description:
      "No session. Markdown is not offered. A password-protected link needs a `ticket` query minted on a granted detail response. The ticket lasts 60 seconds and is honored at most 3 times per API process. Content on a protected link without a valid ticket is `401 PASSWORD_REQUIRED`. Reverse proxies should not log `?ticket=`.",
    security: "none",
    pathParameters: [artifactIdParam, shareTokenParam],
    queryParameters: [
      {
        name: "ticket",
        required: false,
        description: "Short-lived content ticket for a password-protected link. Not used on an open link.",
        schema: z.string().min(1)
      }
    ],
    responses: {
      "200": {
        description: "HTML bytes with the same sandbox CSP as a signed-in viewer.",
        contentType: "text/html"
      },
      "401": {
        description: "Protected content without a valid ticket. Code `PASSWORD_REQUIRED`.",
        schemaName: "ApiError"
      },
      "404": { description: "The link is not active. Code `ARTIFACT_NOT_FOUND`.", schemaName: "ApiError" },
      "429": {
        description:
          "Too many public view units from this client address. Code `RATE_LIMITED`. No Retry-After. A content request that still has a companion grant from a recent detail does not charge this limiter.",
        schemaName: "ApiError"
      },
      "503": {
        description: "Object storage failed while reading HTML. Code `STORAGE_UNAVAILABLE`. No Retry-After.",
        schemaName: "ApiError"
      }
    }
  }
];
