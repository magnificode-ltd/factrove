# Shared MVP contract

This contract translates [the agreed MVP end state](../docs/MVP_END_STATE.md) into shared API, package, and runtime interfaces. The end-state document is authoritative for product behavior and modeling; this file defines implementation details. Contract changes are coordinated across affected task owners.

## Runtime and local identity

- Web origin: `http://localhost:3000`.
- API origin: `http://localhost:3001`; product endpoints start with `/api/v1`.
- API binds to `127.0.0.1` by default. Local database/storage host ports also bind to loopback.
- One PostgreSQL database and one dedicated S3 bucket per installation.
- NestJS API owns database and S3 credentials. Web/CLI only know HTTP origins.
- Local identity is configured in the API: `LOCAL_USER_ID=local-user`, `LOCAL_ORGANIZATION_ID=local-org`. The latter may be unset for a user without an organization.
- Explicit, idempotent local seed creates user `local-user` (Local User, `local@example.invalid`) and organization `local-org` (Local Organization, slug `local`) in the Better Auth-generated identity tables.
- The API verifies configured rows exist. Fail with a useful startup/configuration error when they do not; never silently impersonate another identity.
- Requests do not accept creator IDs or organization IDs. The API derives them from local configuration.
- Better Auth core + organization-plugin schema, including required supporting tables, is generated now. The live API uses no auth plugin routes, identity header, login, API key, browser session, or membership enforcement. There is no one-org uniqueness rule.
- This local context is not proof of identity. Direct artifact/content endpoints are unauthenticated; private/org_shared are display classifications only.

## Model reference

The complete, authoritative [three-model definition](../docs/MVP_END_STATE.md#three-models) lives in MVP_END_STATE.md: custom Artifact plus Better Auth's User and Organization. Better Auth's pinned core + organization configuration determines the identity schema and required supporting tables; three domain concepts does not mean exactly three SQL tables.

Preserve Better Auth adapter-compatible identity names/mappings. Map Artifact's fields consistently to the documented database column names and reference the generated identities directly. Index creator/time and organization/access/time for the list queries. The organization requirement for org_shared is a SQL check; it is not a one-organization-per-user restriction. All generated identity schema and custom Artifact changes enter the same committed Prisma migration history.

The backend-local Better Auth schema configuration uses `database: prismaAdapter(prisma, { provider: "postgresql" })` and `plugins: [organization()]`. Use Better Auth's official Prisma adapter and schema generator, followed by Prisma Migrate for committed SQL migrations. Runtime auth endpoints remain deferred.

## Listing semantics

Return stored artifacts. A failed upload has no row.

- `view=mine`: creator_user_id equals the configured local user. Includes their private and organization-shared artifacts.
- `view=org`: organization_id equals the configured local organization AND access_type is org_shared. Includes artifacts by other creators. If there is no configured organization, return an empty list.
- Sort by created_at descending, then id descending for ties.
- Return the entire list for this small local MVP. Pagination and search are deferred.
- A refresh fetches current data; no static generation/shared caching of lists.
- Organization association persists even for private artifacts but does not put them in the organization list.

## HTTP API

All timestamps are UTC ISO 8601 strings. JSON fields use camelCase. Treat this as the source for shared schemas/types.

```ts
type ArtifactDto = {
  id: string;
  creatorUserId: string;
  organizationId: string | null;
  accessType: "private" | "org_shared";
  filename: string;
  mimeType: "text/html";
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string; // Set when the row is inserted after the object write succeeds.
  viewerUrl: string;  // WEB_ORIGIN + /artifacts/{id}
  contentUrl: string; // API_PUBLIC_ORIGIN + /api/v1/artifacts/{id}/content
};
type ApiError = {
  error: { code: string; message: string };
};
```

Do not expose database rows, object keys, bucket details, or filesystem paths in DTOs.

| Method/path | Request | Success |
| --- | --- | --- |
| GET /api/v1/health | None | 200 `{ status: "ok" }` once initialized |
| GET /api/v1/context | None | 200 `{ user: { id, name }, organization: { id, name } \| null }` |
| POST /api/v1/artifacts | multipart/form-data: one `file`, optional `accessType` | 201 `{ artifact: ArtifactDto }` |
| GET /api/v1/artifacts?view=mine\|org | Default mine | 200 `{ items: ArtifactDto[] }` |
| GET /api/v1/artifacts/{id} | None | 200 `{ artifact: ArtifactDto }` |
| GET /api/v1/artifacts/{id}/content | None | 200 original HTML bytes |

The API builds absolute URLs from configuration, never an untrusted Host header. Get-by-ID and content return 404 for an unknown id. They do not enforce private/org access in this no-auth build.

### Upload behavior

- Accept one non-empty `.html` or `.htm` file, case-insensitively; preserve its basename and normalize stored extension to `.html`.
- Treat accepted input as UTF-8 HTML. Reject malformed UTF-8 and unsupported extensions. Do not require a full document wrapper; HTML fragments are allowed.
- The backend assigns text/html; browser-supplied multipart MIME is not authoritative.
- Maximum file size: 10 MiB (10,485,760 bytes). Enforce during request parsing, not after accepting an unbounded body. Bounded buffering is acceptable for this MVP.
- accessType defaults to private; reject any other enum value. Reject org_shared without a configured organization.
- Each request creates a new artifact. No idempotency or automatic upload retries; rerunning a successful request creates another artifact.
- Write the object, then insert the artifact row with `uploaded_at` set. Return the DTO only after both succeed.
- The upload is atomic. If the object write fails, do not insert an artifact row. A failed upload leaves no artifact in the database.
- This API does not watch/import files written to S3 outside Factrove.

### Errors

Return the common JSON envelope without stack traces or secrets:

| Status | Code | Example |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Missing/multiple files, invalid access/view/ID, invalid UTF-8 |
| 400 | ORGANIZATION_REQUIRED | org_shared without local organization |
| 413 | FILE_TOO_LARGE | Above 10 MiB |
| 415 | UNSUPPORTED_FILE_TYPE | Non-HTML extension |
| 404 | ARTIFACT_NOT_FOUND | Unknown artifact |
| 503 | STORAGE_UNAVAILABLE | S3 failure, which also stores no artifact row |
| 500 | INTERNAL_ERROR | Unexpected persistence/service failure |

A network failure has no API envelope; clients must report it separately.

## Shared HTTP client

`@factrove/api-client` depends on `@factrove/contracts`, not NestJS or Prisma. Proposed public surface:

```ts
createFactroveClient({ baseUrl, fetch? })
client.getContext()
client.uploadArtifact({ file: Blob, filename, accessType? })
client.listArtifacts({ view: "mine" | "org" })
client.getArtifact(id)
```

baseUrl is the API origin, without /api/v1. The client appends route paths, uses multipart FormData, maps the documented envelopes, and exposes errors with status/code/message. Do not manually set a multipart boundary. Allow fetch injection for contract tests. No credentials or auth plugin are needed.

## Database repository handoff

File placement follows the [canonical README backend directory structure](../README.md#backend-directory-structure), including `src/database/repositories/` and the public `src/database/index.ts` exports.

Task 02 exports a global DatabaseModule and an injectable ArtifactsRepository. Other tasks can work against these methods:

- `create({ id, creatorUserId, organizationId, accessType, mimeType, sizeBytes, uploadedAt? })`
- `update(id, { organizationId?, accessType?, mimeType?, sizeBytes?, uploadedAt? })`
- `delete(id)`
- `findById(id)`
- `list({ view, userId, organizationId })`

Return backend-internal records; task 04 maps them to DTOs. PrismaService remains available for resolving the configured user/org. Concrete repositories are PostgreSQL implementations, not interchangeable adapters.

## Storage handoff

Task 03 exports StorageModule, a provider token BLOB_STORE, and this backend-only contract:

```ts
interface BlobStore {
  put(input: {
    objectKey: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  get(objectKey: string): Promise<{
    body: AsyncIterable<Uint8Array>;
  }>;
  delete(objectKey: string): Promise<void>;
}
```

No S3 SDK types escape the implementation. Flat object keys are generated by the API, not supplied by clients. The implementation reads `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, and the standard AWS credential chain. Leave the endpoint unset for real AWS. Set `S3_FORCE_PATH_STYLE=true` for a local path-style endpoint. Static `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are optional and must be set together; otherwise the SDK default chain, including `AWS_PROFILE`, is used. The API does not create the bucket.

`get` throws `BlobNotFoundError` with `code` `BLOB_NOT_FOUND` when the object is absent. Configuration failures and storage outages, including a failed `put`, throw `BlobStoreUnavailableError` with `code` `BLOB_STORE_UNAVAILABLE`. `delete` resolves when the object is already gone. These error messages omit bucket, endpoint, and credential values. `cause` on `BlobStoreUnavailableError` is for server logs only and must not be sent to clients.

## HTML viewer and delivery

Next.js `/artifacts/[id]` fetches metadata, shows filename/context, and uses the returned contentUrl in an iframe. Do not use dangerouslySetInnerHTML or inline uploaded markup in the application DOM.

Set iframe sandbox to `allow-scripts` without allow-same-origin, and referrer policy to no-referrer. API content responses set text/html; charset=utf-8, no-store, nosniff, no-referrer, and a CSP that:

- includes `sandbox allow-scripts`;
- allows inline scripts/styles and embedded data/blob images, plus embedded fonts as needed;
- blocks network connections, external scripts/resources, forms, objects, nested frames, base-URL changes, and top-level navigation;
- permits framing only by configured WEB_ORIGIN.

Keep the policy fixed and tested. API CORS allows only WEB_ORIGIN, not wildcard or the opaque null origin of sandboxed HTML. Error responses remain non-executable JSON. Content lives on the API origin (port 3001), separate from the Next.js origin (port 3000); this local arrangement must be revisited with authentication/public hosting.

Self-contained HTML is the MVP contract. Documents relying on CDNs/network resources are not supported. Markdown, previews, screenshots, and headless rendering are out of scope.

## CLI

Planned repository command:

```sh
pnpm factrove upload ./report.html
pnpm factrove upload ./report.html --access org_shared --json
pnpm factrove upload ./report.html --api-url http://localhost:3001 --json
```

- API origin precedence: --api-url, FACTROVE_API_URL, default http://localhost:3001.
- Access defaults to private.
- Plain success prints only viewerUrl plus newline to stdout.
- JSON success prints the API's `{ artifact: ArtifactDto }` envelope on one line.
- Errors go to stderr and exit nonzero. In --json mode, use the common error envelope on stderr; reserve local codes FILE_NOT_FOUND, INVALID_INPUT, NETWORK_ERROR.
- No progress/framework startup logs on stdout. Close the Nest application context so the process exits.
- No login/list/share/config commands, persisted credentials, background process, or separate CLI server.
- Do not add automatic retries for uploads.

## Configuration and planned root commands

Task 01 establishes script names; 07 makes them runnable and verifies documentation:

| Command | Purpose |
| --- | --- |
| pnpm infra:up | Start local PostgreSQL/storage and initialize dedicated bucket |
| pnpm db:migrate | Apply committed migrations |
| pnpm db:seed | Create/update local fixture rows idempotently |
| pnpm dev | Run FE and BE together |
| pnpm factrove upload ... | Run Nest CLI upload |
| pnpm build / pnpm typecheck / pnpm test | Workspace verification |
| pnpm infra:down | Stop services without removing data volumes |

Backend env: DATABASE_URL, HOST (127.0.0.1), PORT (3001), WEB_ORIGIN, API_PUBLIC_ORIGIN, LOCAL_USER_ID, LOCAL_ORGANIZATION_ID, S3_BUCKET, S3_REGION, optional S3_ENDPOINT, S3_FORCE_PATH_STYLE, and standard AWS credential variables for local S3 testing. Real AWS may use its normal credential chain.

Web env: NEXT_PUBLIC_API_URL, default http://localhost:3001. CLI env: FACTROVE_API_URL. Client packages must never receive database or storage credentials.

The local runtime agent selects and pins one macOS-compatible S3 development service, initializes its bucket, and provides matching endpoint credentials in .env.example. This is a development fixture using the S3 provider, not a filesystem storage adapter or a new production provider.
