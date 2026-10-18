# Shared MVP contract

This contract translates [the agreed MVP end state](../docs/MVP_END_STATE.md) into shared API, package, and runtime interfaces. The end-state document is authoritative for product behavior and modeling; this file defines implementation details. Contract changes are coordinated across affected task owners.

## Runtime and local identity

- Web origin: `http://localhost:3000`.
- API origin: `http://localhost:3001`; product endpoints start with `/api/v1`.
- API binds to `127.0.0.1` by default. The local PostgreSQL host port also binds to loopback.
- One PostgreSQL database and one dedicated S3 bucket per installation.
- NestJS API owns database and S3 credentials. Web/CLI only know HTTP origins.
- `BETTER_AUTH_SECRET` is required and must be at least 32 characters. It signs session cookies and content grants. The committed example is a placeholder, not a credential to reuse outside local development.
- Explicit, idempotent local seed creates user `local-user` (Local User, `local@example.invalid`) and organization `local-org` (Local Organization, slug `local`) in the Better Auth-generated identity tables. That user has no password and cannot sign in. Seed does not create a membership.
- The API does not impersonate a configured local user. Collection routes require a session or an API key. `GET /api/v1/health` stays public.
- Requests do not accept creator IDs or organization IDs. The API derives them from the signed-in user or the API-key owner.
- Better Auth core + organization-plugin schema, including required supporting tables, is generated from `auth-schema.config.ts`. Runtime auth is a separate email/password configuration. It does not mount organization-plugin HTTP routes. Membership is enforced by reading the `member` table. There is no one-org uniqueness rule.
- Email/password sign-in does not require email verification. There is no SSO. API keys use the Better Auth API key plugin `@better-auth/api-key` 1.7.7. The secret is shown once, and the plugin stores its SHA-256 digest as unpadded base64url.

## Model reference

The complete, authoritative [three-model definition](../docs/MVP_END_STATE.md#three-models) lives in MVP_END_STATE.md: custom Artifact plus Better Auth's User and Organization. Better Auth's pinned core + organization configuration determines the identity schema and required supporting tables; three domain concepts does not mean exactly three SQL tables.

Preserve Better Auth adapter-compatible identity names/mappings. Map Artifact's fields consistently to the documented database column names and reference the generated identities directly. Index creator/time and organization/access/time for the list queries. The organization requirement for org_shared is a SQL check; it is not a one-organization-per-user restriction. All generated identity schema and custom Artifact changes enter the same committed Prisma migration history.

The backend-local Better Auth schema configuration uses `database: prismaAdapter(prisma, { provider: "postgresql" })` and `plugins: [organization(), factroveApiKey()]`. Use Better Auth's official Prisma adapter and schema generator, followed by Prisma Migrate for committed SQL migrations. Runtime sign-in is mounted at `/api/auth`. It includes the API key plugin and does not mount organization-plugin HTTP routes.

## Listing semantics

Return stored artifacts. A failed upload has no row.

- `view=mine`: creator_user_id equals the caller. Includes that caller's private and organization-shared artifacts.
- `view=org`: organization_id equals the caller's current organization AND access_type is org_shared. Includes artifacts by other creators. If the caller has no current organization, return an empty list.
- The current organization is the session's active organization when the user is a member of it. Otherwise it is the user's only membership. With more than one membership and no active organization, it is null. An API key has no active organization, so it uses the sole-membership rule.
- Sort by created_at descending, then id descending for ties.
- Return the entire list for this small local MVP. Pagination and search are deferred.
- A refresh fetches current data; no static generation/shared caching of lists.
- A private artifact may still record the creator's current organization. That association does not put it in the organization list.

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
  contentUrl: string; // API_PUBLIC_ORIGIN + /api/v1/artifacts/{id}/content?access=<grant>
};
type ApiError = {
  error: { code: string; message: string };
};
```

Do not expose database rows, object keys, bucket details, or filesystem paths in DTOs.

| Method/path | Request | Success |
| --- | --- | --- |
| GET /api/v1/health | None | 200 `{ status: "ok" }` once initialized |
| GET /api/v1/context | Session cookie or `Authorization: Bearer` | 200 `{ user: { id, name }, organization: { id, name } \| null }` |
| POST /api/v1/artifacts | multipart/form-data: one `file`, optional `accessType` | 201 `{ artifact: ArtifactDto }` |
| GET /api/v1/artifacts?view=mine\|org | Default mine | 200 `{ items: ArtifactDto[] }` |
| GET /api/v1/artifacts/{id} | Session cookie or `Authorization: Bearer` | 200 `{ artifact: ArtifactDto }` |
| GET /api/v1/artifacts/{id}/content | Optional `format=html\|markdown`. Omitted means `html`. Optional `access` grant. | 200 HTML bytes, or Markdown converted from those bytes |
| POST /api/auth/api-key/create | Browser session, JSON `{ name }` | 200 API key, including `key` once |
| GET /api/auth/api-key/list | Browser session | 200 `{ apiKeys, total }` without `key` |
| POST /api/auth/api-key/delete | Browser session, JSON `{ keyId }` | 200 `{ success: true }` |

`/api/auth/*` is Better Auth email/password sign-up, sign-in, sign-out, and API key management. It is outside the `/api/v1` prefix. Product routes accept `Authorization: Bearer <key>`. When that header is absent, they also accept `x-api-key`. The CLI sends `Authorization: Bearer`.

The API builds absolute URLs from configuration, never an untrusted Host header. An unknown id, an unauthenticated read, and a read by someone who is not allowed all return the same `404 ARTIFACT_NOT_FOUND` body. List, upload, and context without credentials return `401 UNAUTHENTICATED`. A present `Authorization` header that is not a valid active key does not fall back to a session cookie.

`private` is readable only by the creator. `org_shared` is readable by the creator and by members of `artifact.organizationId`. `org_shared` upload without a current organization is `400 ORGANIZATION_REQUIRED`.

`contentUrl` is the HTML content URL plus an `access` grant so the sandboxed iframe can load it without cookies or `allow-same-origin`. The grant is an HMAC bound to the artifact id. It is not an API key. It is honored only when the request has no `Authorization` header. Clients that want Markdown add `format=markdown`. An invalid `format` is `400 INVALID_REQUEST`. `Accept` is not used to choose the format: a request with no `format` returns the original HTML bytes and the existing HTML headers, including when the caller sends `Accept: text/markdown`.

API key creation returns the secret once in `key`. List responses include the name and starting characters, not the secret. Deleting a key makes it fail closed. Managing keys requires a browser session. A request that also sends `Authorization` receives `401` with message `API key management requires a browser session.` and does not use the session cookie. Another user's key id is `404`. Key-management errors use Better Auth's response body.

HTML responses are unchanged: `text/html; charset=utf-8`, `no-store`, `nosniff`, `no-referrer`, and the sandbox CSP. Markdown responses use `text/markdown; charset=utf-8`, `no-store`, `nosniff`, `no-referrer`, and a CSP with `sandbox` and no script or style sources. Markdown is produced from the stored HTML on a worker thread. It is not written to PostgreSQL or object storage. A conversion failure does not change the stored artifact.

The converter walks the parsed document once. Text keeps `&`, `<`, and `>` as `&amp;`, `&lt;`, and `&gt;`. Other Markdown punctuation in text is backslash-escaped: `\`, `` ` ``, `*`, `_`, `[`, `]`, `(`, `)`, `!`, `|`, and `~`. At the start of a line, `#`, `-`, `+`, `=`, and an ordered-list marker (`1.` or `1)`) are backslash-escaped, so literal text such as `# not a heading` stays text. Code is left unchanged. Code fences are longer than any backtick run in the code. Link and image destinations allow `http`, `https`, `mailto`, and relative URLs, written as `<destination>` with spaces, `<`, `>`, `\`, and control characters percent-encoded. `javascript:`, `vbscript:`, `data:`, and any other scheme are dropped. An `<img src="https://…">` stays a Markdown image, so a renderer that loads remote images will request that URL.

Conversion uses a small worker pool. `MARKDOWN_CONVERSION_CONCURRENCY` is how many workers run at once (default 2, clamped to 1–4). `MARKDOWN_CONVERSION_QUEUE` is how many further conversions may wait (default 2, clamped to 0–8). A full queue fails immediately with `503 CONVERSION_UNAVAILABLE` and message `Markdown conversion is busy. Try again.`

Input larger than the 10 MiB stored-HTML limit is `413 CONTENT_TOO_LARGE` with message `HTML exceeds the Markdown conversion limit.` Output larger than 16 MiB is `422 CONTENT_TOO_COMPLEX` with message `Markdown output exceeds the conversion limit.` A conversion that exceeds 5 seconds is `422 CONTENT_TOO_COMPLEX` with message `HTML took too long to convert to Markdown.` A worker that runs out of memory is `422 CONTENT_TOO_COMPLEX` with message `HTML used too much memory to convert to Markdown.` Nesting deeper than 100 levels is flattened. HTML that still cannot be converted within those limits is `422 CONTENT_TOO_COMPLEX` with message `HTML is too complex to convert to Markdown.` Invalid UTF-8 discovered while decoding stored HTML for Markdown is `400 INVALID_REQUEST`. An unexpected converter failure is `500 INTERNAL_ERROR`.

### Upload behavior

- Accept one non-empty `.html` or `.htm` file, case-insensitively; preserve its basename and normalize stored extension to `.html`.
- Treat accepted input as UTF-8 HTML. Reject malformed UTF-8 and unsupported extensions. Do not require a full document wrapper; HTML fragments are allowed.
- The backend assigns text/html; browser-supplied multipart MIME is not authoritative.
- Maximum file size: 10 MiB (10,485,760 bytes). Enforce during request parsing, not after accepting an unbounded body. Bounded buffering is acceptable for this MVP.
- accessType defaults to private; reject any other enum value. Reject org_shared when the caller has no current organization. The message is `Organization sharing requires membership in an organization.`
- Each request creates a new artifact. No idempotency or automatic upload retries; rerunning a successful request creates another artifact.
- Write the object, then insert the artifact row with `uploaded_at` set. Return the DTO only after both succeed.
- The upload is atomic. If the object write fails, do not insert an artifact row. A failed upload leaves no artifact in the database.
- This API does not watch/import files written to S3 outside Factrove.

### Errors

Return the common JSON envelope without stack traces or secrets:

| Status | Code | Example |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Missing/multiple files, invalid access/view/format/ID, invalid UTF-8 |
| 400 | ORGANIZATION_REQUIRED | org_shared without a current organization membership |
| 401 | UNAUTHENTICATED | Missing session or API key on a product route |
| 413 | FILE_TOO_LARGE | Above 10 MiB |
| 413 | CONTENT_TOO_LARGE | Stored HTML exceeds the Markdown conversion limit |
| 422 | CONTENT_TOO_COMPLEX | Markdown conversion exceeded its time, memory, or output limit |
| 415 | UNSUPPORTED_FILE_TYPE | Non-HTML extension |
| 404 | ARTIFACT_NOT_FOUND | Unknown artifact, or an artifact the caller cannot read |
| 503 | STORAGE_UNAVAILABLE | S3 failure, which also stores no artifact row |
| 503 | CONVERSION_UNAVAILABLE | Markdown conversion pool is saturated |
| 500 | INTERNAL_ERROR | Unexpected persistence/service failure |

A network failure has no API envelope; clients must report it separately.

## Shared HTTP client

`@factrove/api-client` depends on `@factrove/contracts`, not NestJS or Prisma. Proposed public surface:

```ts
createFactroveClient({ baseUrl, fetch?, apiKey?, cookie? })
client.getContext()
client.uploadArtifact({ file: Blob, filename, accessType? })
client.listArtifacts({ view: "mine" | "org" })
client.getArtifact(id)
client.getArtifactContent(id, { format?: "html" | "markdown" })
```

`getArtifactContent` returns `{ format, mediaType, content }`. `format` defaults to `html`. `mediaType` is `text/html` or `text/markdown`. `content` is the response body as text, including a leading UTF-8 BOM when the stored HTML has one. HTML requests omit the format query. Markdown requests use `?format=markdown`. The HTTP success body stays raw text; this object is the client result, not a second JSON envelope from the API.

baseUrl is the API origin, without /api/v1. The client appends route paths, uses multipart FormData, maps the documented envelopes, and exposes errors with status/code/message. Do not manually set a multipart boundary. Allow fetch injection for contract tests. `apiKey` is sent as `Authorization: Bearer`. `cookie` is sent as the `Cookie` header for a server-rendered session. The client does not print either value.

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

No S3 SDK types escape the implementation. Flat object keys are generated by the API, not supplied by clients. The implementation reads `S3_BUCKET`, `S3_REGION`, and the standard AWS credential chain. Optional `S3_ENDPOINT` selects an S3-compatible origin. When it is set, `S3_FORCE_PATH_STYLE` defaults to `true` and may be set to `false`. Plain `http://` is accepted only for `localhost`, `127.0.0.1`, and `::1`; any other host requires `https://`. When `S3_ENDPOINT` is unset, the client calls AWS S3 in `S3_REGION` with virtual-hosted addressing, and `AWS_ENDPOINT_URL`, `AWS_ENDPOINT_URL_S3`, and a profile `endpoint_url` are ignored. Static `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are optional and must be set together; otherwise the SDK default chain, including `AWS_PROFILE`, is used. The API does not create the bucket. `pnpm infra:up` starts Garage, which creates the local `factrove` bucket.

The caller needs `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on the object ARN, and `s3:ListBucket` on the bucket ARN. Without `s3:ListBucket`, S3 returns `AccessDenied` for a missing key.

`get` throws `BlobNotFoundError` with `code` `BLOB_NOT_FOUND` for S3 `NoSuchKey`. Configuration failures, storage outages, and any other error, including a generic HTTP 404, throw `BlobStoreUnavailableError` with `code` `BLOB_STORE_UNAVAILABLE`. A failed `put` uses that same unavailable error. `delete` resolves when the object is already gone. These error messages omit bucket and credential values. `cause` on `BlobStoreUnavailableError` is for server logs only and must not be sent to clients.

## HTML viewer and delivery

Next.js `/artifacts/[id]` fetches metadata, shows filename/context, and uses the returned contentUrl in an iframe. Do not use dangerouslySetInnerHTML or inline uploaded markup in the application DOM.

Set iframe sandbox to `allow-scripts` without allow-same-origin, and referrer policy to no-referrer. HTML content responses set text/html; charset=utf-8, no-store, nosniff, no-referrer, and a CSP that:

- includes `sandbox allow-scripts`;
- allows inline scripts/styles and embedded data/blob images, plus embedded fonts as needed;
- blocks network connections, external scripts/resources, forms, objects, nested frames, base-URL changes, and top-level navigation;
- permits framing only by configured WEB_ORIGIN.

Keep the policy fixed and tested. API CORS allows only WEB_ORIGIN, not wildcard or the opaque null origin of sandboxed HTML. Error responses remain non-executable JSON. Content lives on the API origin (port 3001), separate from the Next.js origin (port 3000). The iframe stays `sandbox="allow-scripts"` without `allow-same-origin`, and the viewer preflight omits credentials. `contentUrl` carries a short-lived HMAC grant so that request can still be authorized.

Self-contained HTML is the stored artifact. Documents relying on CDNs/network resources are not supported. Previews, screenshots, and headless rendering are out of scope. Markdown exists only as an on-request conversion of the stored HTML. Uploads remain HTML, and neither the database nor object storage gains a Markdown copy.

## CLI

Planned repository command:

```sh
pnpm factrove configure
pnpm factrove configure --profile dev --api-url http://localhost:3001
pnpm factrove upload ./report.html
pnpm factrove upload ./report.html --access org_shared --json
pnpm factrove upload ./report.html --api-url http://localhost:3001 --profile dev --json
pnpm factrove get <artifact-id>
pnpm factrove get <artifact-id> --format markdown --json
pnpm factrove get <artifact-id> --api-url http://localhost:3001
```

- When in doubt, follow aws s3 conventions; existing upload/get/--json kept for now, cp/--output json are follow-ups. `get` writes to stdout the way `aws s3 cp s3://bucket/key -` streams an object to stdout.
- API origin precedence: --api-url, FACTROVE_API_URL, the selected profile's `api_url`, then http://localhost:3001. `upload` and `get` share it.
- API key precedence: FACTROVE_API_KEY, then `factrove_api_key` in the selected profile. The profile is `--profile`, then `FACTROVE_PROFILE`, then `default`.
- `configure` writes `~/.factrove/credentials` and `~/.factrove/config` with mode 0600. `FACTROVE_CONFIG_DIR`, `FACTROVE_SHARED_CREDENTIALS_FILE`, and `FACTROVE_CONFIG_FILE` override those paths. The command does not print the key.
- Access defaults to private. `--access` is only valid for `upload`.
- `--format html|markdown` is only valid for `get` and defaults to `html`.
- Plain upload success prints only viewerUrl plus newline to stdout.
- JSON upload success prints the API's `{ artifact: ArtifactDto }` envelope on one line.
- Plain get success prints the content bytes and does not add a newline of its own.
- JSON get success prints one line: `{ format, mediaType, content }`, with `mediaType` of `text/html` or `text/markdown`.
- Errors go to stderr and exit nonzero. In --json mode, use the common error envelope on stderr; reserve local codes FILE_NOT_FOUND, INVALID_INPUT, NETWORK_ERROR.
- No progress/framework startup logs on stdout. Close the Nest application context so the process exits.
- `configure` is the credentials command. There is no login, list, or share command in the CLI, no background process, and no separate CLI server.
- Do not add automatic retries for uploads. `get` calls the content endpoint once.

## Configuration and planned root commands

Task 01 establishes script names; 07 makes them runnable and verifies documentation:

| Command | Purpose |
| --- | --- |
| pnpm infra:up | Start local PostgreSQL and the Garage S3 stand-in |
| pnpm db:migrate | Apply committed migrations |
| pnpm db:seed | Create/update local fixture rows idempotently |
| pnpm dev | Run FE and BE together |
| pnpm factrove configure | Save an API key and API URL for a profile |
| pnpm factrove upload ... | Run Nest CLI upload |
| pnpm factrove get ... | Print artifact content as HTML or Markdown |
| pnpm build / pnpm typecheck / pnpm test | Workspace verification |
| pnpm infra:down | Stop services without removing data volumes |
| pnpm e2e | Run the local upload, viewer, restart, and S3 integration checks against Compose project factrove-e2e |

Backend env: DATABASE_URL, HOST (127.0.0.1), PORT (3001), WEB_ORIGIN, API_PUBLIC_ORIGIN, BETTER_AUTH_SECRET, S3_BUCKET, S3_REGION, optional S3_ENDPOINT and S3_FORCE_PATH_STYLE, and the standard AWS credential chain (`AWS_PROFILE`, or `AWS_ACCESS_KEY_ID` with `AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN`). `S3_INTEGRATION=1` runs the storage integration tests against local Garage. Those tests set the Garage endpoint and credentials, remove `AWS_*` and `S3_*` overrides, and require a loopback HTTP endpoint before opening a client. With `S3_ENDPOINT` unset, the API does not use a custom S3 endpoint. `MARKDOWN_CONVERSION_CONCURRENCY` (default 2) and `MARKDOWN_CONVERSION_QUEUE` (default 2) bound on-request Markdown conversion.

Web env: NEXT_PUBLIC_API_URL, default http://localhost:3001. CLI env: FACTROVE_API_URL, FACTROVE_API_KEY, FACTROVE_PROFILE, and the optional config-path overrides. Client packages must never receive database, storage, or auth-secret credentials.

Local setup uses Garage from `pnpm infra:up`, which creates the bucket. An operator can use an existing AWS bucket by setting `S3_BUCKET` and `S3_REGION` and leaving `S3_ENDPOINT` unset. The API does not create that AWS bucket.
