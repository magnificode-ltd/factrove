# Shared MVP contract

This contract translates [the agreed MVP end state](../docs/MVP_END_STATE.md) into shared API, package, and runtime interfaces. The end-state document is authoritative for product behavior and modeling; this file defines implementation details. Contract changes are coordinated across affected task owners.

## Runtime and local identity

- Web origin: `http://localhost:3000`.
- API origin: `http://localhost:3001`; product endpoints start with `/api/v1`.
- API binds to `127.0.0.1` by default. The local PostgreSQL host port also binds to loopback.
- One PostgreSQL database and one dedicated S3 bucket per installation.
- NestJS API owns database and S3 credentials. Web/CLI only know HTTP origins.
- `BETTER_AUTH_SECRET` is required and must be at least 32 characters. It signs session cookies. Content grants use a separate HMAC subkey, `HMAC-SHA256(BETTER_AUTH_SECRET, "factrove:content-grant:v1")`. The committed example is a placeholder, not a credential to reuse outside local development.
- Explicit, idempotent local seed creates user `local-user` (Local User, `local@example.invalid`) and organization `local-org` (Local Organization, slug `local`) in the Better Auth-generated identity tables. That user has no password and cannot sign in. Seed does not create a membership.
- `pnpm db:claim-local-artifacts -- --email you@example.com` reassigns artifacts whose creator is `local-user` to an account that can already sign in. The account must have a credential row with a password. Artifact ids stay the same. It adds a membership for each organization those artifacts reference when the account is not already a member. It refuses `local-user`, an account with no password, and an unknown or ambiguous email. It does nothing on a second run and does not print secrets.
- The API does not impersonate a configured local user. Collection routes require a session or an API key. `GET /api/v1/health` stays public.
- Requests do not accept creator IDs or organization IDs. The API derives them from the signed-in user or the API-key owner.
- Better Auth core + organization-plugin schema, including required supporting tables, is generated from `auth-schema.config.ts`. Runtime auth is a separate email/password configuration. It does not mount organization-plugin HTTP routes. Membership is enforced by reading the `member` table. There is no one-org uniqueness rule.
- Email/password sign-in does not require email verification. There is no SSO. Sign-in and sign-up are rate limited in every environment, including when `NODE_ENV` is not `production`: `/sign-in/email` and `/sign-up/email` allow 10 requests per 60 seconds. Before the `/api/auth` handler runs, the API deletes any incoming `x-factrove-client-ip` and sets that header from the socket address. Better Auth reads only that header. When the peer matches `TRUSTED_PROXIES` (comma-separated IP addresses or CIDR ranges), the header is the right-most untrusted hop of `X-Forwarded-For`. Any other peer is the client, and `X-Forwarded-For` is ignored. Leave `TRUSTED_PROXIES` unset when clients connect directly. A spoofed forwarding header does not open a new rate-limit bucket. API keys use the Better Auth API key plugin `@better-auth/api-key` 1.7.7. The secret is shown once, and the plugin stores its SHA-256 digest as unpadded base64url. The API key plugin's own per-key rate limit stays off so a CLI session is not capped at ten requests per day.
- The session cookie is host-only unless `AUTH_COOKIE_DOMAIN` is set. The browser sends that cookie to every subdomain of the value, so use the narrowest parent that covers both hosts. For `app.factrove.example.com` and `api.factrove.example.com`, set `factrove.example.com`, not `example.com`. Startup rejects an IP address, a public suffix such as `co.uk`, and a domain that is not the host of both `WEB_ORIGIN` and `API_PUBLIC_ORIGIN` or a parent of both. Leave it unset on localhost, where a cookie already ignores the port. `localhost` and `127.0.0.1` are different hosts, and a cookie domain cannot cover either, so `WEB_ORIGIN` and `PUBLIC_BASE_URL` must use the same one. The web server forwards the browser `Cookie` header to the API.

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
  viewerUrl: string;  // PUBLIC_BASE_URL + /artifacts/{id}. PUBLIC_BASE_URL defaults to WEB_ORIGIN.
  contentUrl: string; // API_PUBLIC_ORIGIN + /api/v1/artifacts/{id}/content. Session detail appends ?access=<grant>
  shared: boolean;    // True when the owner has an active public link. The token is not included.
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
| GET /api/v1/artifacts/{id}/share | Owner session or API key | 200 `{ share: { shared, shareUrl } }` |
| POST /api/v1/artifacts/{id}/share | Owner session or API key | 200 `{ share: { shared: true, shareUrl } }`. Repeating it returns the same link. |
| DELETE /api/v1/artifacts/{id}/share | Owner session or API key | 200 `{ share: { shared: false, shareUrl: null } }` |
| GET /api/v1/public/artifacts/{id}/{token} | No credentials | 200 `{ artifact: { id, filename, mimeType, sizeBytes, uploadedAt, contentUrl } }` |
| GET /api/v1/public/artifacts/{id}/{token}/content | No credentials | 200 HTML bytes |
| POST /api/auth/api-key/create | Browser session, JSON `{ name }` | 200 API key, including `key` once |
| GET /api/auth/api-key/list | Browser session | 200 `{ apiKeys, total }` without `key` |
| POST /api/auth/api-key/delete | Browser session, JSON `{ keyId }` | 200 `{ success: true }` |

`/api/auth/*` is Better Auth email/password sign-up, sign-in, sign-out, and API key management. It is outside the `/api/v1` prefix and is mounted once. Product routes accept `Authorization: Bearer <key>`. They do not accept `x-api-key` as a credential. A present `Authorization` or `x-api-key` header disables the content grant. The CLI sends `Authorization: Bearer`.

The API builds absolute URLs from configuration, never an untrusted Host header. `PUBLIC_BASE_URL` is that origin for viewer URLs and public share links. An unset or blank value uses `WEB_ORIGIN`. It must be an absolute `http` or `https` origin with no credentials, path, query, or hash. A trailing slash is dropped, and the host is lowercased. `http://localhost:3000` keeps links on localhost. `https://factrove.app` uses that domain plus the artifact id. Embeds use the same setting. Setting it does not start a server or publish the app. When its host differs from `WEB_ORIGIN` and both are domain names, startup requires `AUTH_COOKIE_DOMAIN` to cover `WEB_ORIGIN`, `API_PUBLIC_ORIGIN`, and `PUBLIC_BASE_URL`. When the mismatch is localhost or an IP address, including `127.0.0.1`, startup says to use the same host for both. A cookie domain cannot cover those names. Better Auth `trustedOrigins` includes both browser origins and the API origin.

An unknown id, an unauthenticated read, and a read by someone who is not allowed all return the same `404 ARTIFACT_NOT_FOUND` body. List, upload, and context without credentials return `401 UNAUTHENTICATED`. A present `Authorization` header that is not a valid active key does not fall back to a session cookie.

Artifacts stay private until the owner shares them. `POST /api/v1/artifacts/{id}/share` stores a new 32-byte base64url token as AES-256-GCM ciphertext and stores its SHA-256 hash. The key comes from `SHARE_TOKEN_KEY` when that value is set, and otherwise from HKDF over `BETTER_AUTH_SECRET`. Rotating the chosen input revokes existing public links. The old detail and content URLs return the same `404` as a missing artifact, and `shared` is false on the owner list and detail. The raw token is returned only on the owner share routes, as `shareUrl` = `PUBLIC_BASE_URL/share/{id}/{token}`. The stored column is never equal to the token. The ciphertext uses the artifact id as additional authenticated data. The owner routes show a link only when the decrypted token is a share token and its SHA-256 hash equals the stored hash. When the token cannot be read, `GET /api/v1/artifacts/{id}/share` returns `{ shared: false, shareUrl: null }`, and the next `POST` clears that row and mints a new token. The artifact id is already visible in private viewer URLs, so the public path adds the token. A later `POST` returns the same token while it can still be read. `DELETE` clears both columns. A database check requires the ciphertext and the hash to be both null or both set. Sharing again mints a new token, and the previous URL stays `404`. Only the creator can read or change the share. Another member who can read an `org_shared` artifact receives the same `404` as a missing id. A share request with no credentials is `401 UNAUTHENTICATED` before the artifact is loaded. `shared` on `ArtifactDto` is true only when the stored token decrypts with the current key and its hash matches. List and detail JSON do not include the token.

`GET /api/v1/public/artifacts/{id}/{token}` and its `/content` route need no session. The response is the filename, size, upload time, and a content URL. It omits the creator, organization, access type, and share URL. HTML uses the same sandboxed iframe policy as a signed-in viewer. Markdown is not offered on the public route. An invalid id, an invalid token, an unshared artifact, a revoked token, a missing upload time, and an unmatched path under `/api/v1/public` all return the same `404 ARTIFACT_NOT_FOUND` body. Those responses do not say whether the artifact exists. Public responses send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. Lookup uses the hash alone, compares the id, then decrypts the stored token with the current key and requires that plaintext hash to match. A token the current key cannot read returns the same 404. Public views are rate limited to 60 requests per 60 seconds, keyed by `x-factrove-client-ip` after the API replaces any caller-supplied value. The limit is in memory and per process. Counts live in the current window and the previous window. The window clock is monotonic, and those maps rotate when the window changes, so a request does not scan every visitor. When the current map reaches 10,000 keys, the oldest visitor is dropped and the new visitor is counted. Oldest means the first key inserted in that window. A caller with more than 10,000 addresses can cycle keys and exceed the per-address limit. The cap bounds memory. IPv6 clients share a bucket by their /64. A missing address shares one bucket. A page view counts as one request: the detail request is charged, and up to two content requests in the following 30 seconds are included in that view. A content request with no remaining grant is charged on its own. The limit counts lookups that will 404. The status is `429 RATE_LIMITED` with message `Too many requests. Try again later.` The share page loads this detail from the browser with credentials omitted, so each visitor has a separate bucket. Public path checks are case-insensitive, so a mixed-case `/api/v1/public` path keeps this policy. A `/share` URL whose id or token has the wrong shape is HTTP 404, because the library loading UI does not wrap `/share`. Application logs record a Prisma error code when a share cannot be stored. They do not record the token.

`private` is readable only by the creator. `org_shared` is readable by the creator and by members of `artifact.organizationId`. `org_shared` upload without a current organization is `400 ORGANIZATION_REQUIRED`.

`contentUrl` on list, upload, and API-key responses is the HTML content URL with no query. A session-authenticated `GET /api/v1/artifacts/{id}` appends `?access=<grant>` so the sandboxed iframe can load HTML without cookies or `allow-same-origin`. The grant is an HMAC-SHA256 of `artifactId.exp` under the content-grant subkey. It is not an API key. It lasts at most five minutes, and an expiry more than five minutes plus 60 seconds ahead of the server clock is rejected. It is honored only for HTML (`format` omitted or `format=html`), only for that artifact id, and only when the request has neither `Authorization` nor `x-api-key`. Markdown ignores it. An expired, missing, or ignored grant falls through to normal authentication and is `404 ARTIFACT_NOT_FOUND` when the caller cannot read the artifact. Clients that want Markdown add `format=markdown` and authenticate with a session or `Authorization: Bearer`. An invalid `format` is `400 INVALID_REQUEST`. `Accept` is not used to choose the format: a request with no `format` returns the original HTML bytes and the existing HTML headers, including when the caller sends `Accept: text/markdown`.

A write that authenticates with a session cookie (`POST`, `PUT`, `PATCH`, `DELETE`, and any other method that is not `GET`, `HEAD`, or `OPTIONS`) requires `Origin` to be `WEB_ORIGIN` or `PUBLIC_BASE_URL`. When `Origin` is absent, the `Referer` origin is used. A missing or different origin is `403 FORBIDDEN` with message `This request origin is not allowed.` A request that sends `Authorization` is not cookie-authenticated and skips this check. `x-api-key` does not authenticate and does not skip it. `/api/v1/public` uses a separate CORS policy: the same explicit origins, `credentials` omitted, and methods limited to GET, HEAD, and OPTIONS. Other routes still reflect those origins with credentials.

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
| 403 | FORBIDDEN | Cookie-authenticated write whose origin is not WEB_ORIGIN |
| 413 | FILE_TOO_LARGE | Above 10 MiB |
| 413 | CONTENT_TOO_LARGE | Stored HTML exceeds the Markdown conversion limit |
| 422 | CONTENT_TOO_COMPLEX | Markdown conversion exceeded its time, memory, or output limit |
| 415 | UNSUPPORTED_FILE_TYPE | Non-HTML extension |
| 404 | ARTIFACT_NOT_FOUND | Unknown artifact, an artifact the caller cannot read, or a public link that is not active |
| 429 | RATE_LIMITED | Too many public views from one client address |
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
client.getArtifactShare(id)
client.createArtifactShare(id)
client.revokeArtifactShare(id)
client.getPublicArtifact(id, token)
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
- `saveShare(id, shareToken, shareTokenHash)`
- `clearShare(id)`
- `findShared(id, shareTokenHash)` looks up an active public share by hash and does not select the raw token

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
- permits framing by `PUBLIC_BASE_URL`, and also by `WEB_ORIGIN` when that origin is different.

Keep the policy fixed and tested. API CORS allows those same browser origins, not wildcard or the opaque null origin of sandboxed HTML. Cookie-authenticated writes accept `WEB_ORIGIN` and `PUBLIC_BASE_URL`. Public routes omit credentials. Error responses remain non-executable JSON. Content lives on the API origin (port 3001), separate from the Next.js origin (port 3000). The iframe stays `sandbox="allow-scripts"` without `allow-same-origin`, and the viewer preflight omits credentials. `contentUrl` carries a short-lived HMAC grant so that request can still be authorized. Try again reloads the artifact page so the server mints a new grant. Fetching the previous `contentUrl` again would reuse an expired one. The public share page does not offer a link back to the library.

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
pnpm factrove share <artifact-id>
pnpm factrove share <artifact-id> --json
pnpm factrove share <artifact-id> --revoke
```

- When in doubt, follow aws s3 conventions; existing upload/get/--json kept for now, cp/--output json are follow-ups. `get` writes to stdout the way `aws s3 cp s3://bucket/key -` streams an object to stdout.
- API origin precedence: --api-url, FACTROVE_API_URL, the selected profile's `api_url`, then a URL from `apps/cli/.env` when the command is `pnpm factrove`, then http://localhost:3001. `upload` and `get` share it. `scripts/factrove.mjs` reads that file. `node apps/cli/dist/main.js` does not. The file may set `FACTROVE_API_URL` and `FACTROVE_PROFILE` when those variables are unset. A profile `api_url` wins over the file.
- API key precedence matches the AWS CLI. An explicit `--profile` uses that profile's `factrove_api_key` and ignores `FACTROVE_API_KEY`. Otherwise the key is `FACTROVE_API_KEY`, then `factrove_api_key` in the selected profile. The profile is `--profile`, then `FACTROVE_PROFILE`, then `default`. `pnpm factrove` can fill `FACTROVE_PROFILE` from `apps/cli/.env` when the variable is unset. The file does not supply an API key.
- `configure` writes `~/.factrove/credentials` and `~/.factrove/config` with mode 0600. It writes a mode 0600 temporary file in the same directory and renames it into place. When the path is a symlink, the rename updates the target and leaves the symlink in place. Directories Factrove creates for those files are mode 0700. An existing parent directory keeps its mode. `FACTROVE_CONFIG_DIR`, `FACTROVE_SHARED_CREDENTIALS_FILE`, and `FACTROVE_CONFIG_FILE` override those paths. The command does not print the key.
- Access defaults to private. `--access` is only valid for `upload`.
- `--format html|markdown` is only valid for `get` and defaults to `html`.
- `--revoke` is only valid for `share`.
- Plain upload success prints only viewerUrl plus newline to stdout. The viewer URL uses `PUBLIC_BASE_URL`.
- JSON upload success prints the API's `{ artifact: ArtifactDto }` envelope on one line.
- Plain get success prints the content bytes and does not add a newline of its own.
- JSON get success prints one line: `{ format, mediaType, content }`, with `mediaType` of `text/html` or `text/markdown`.
- Plain share success prints only the public URL plus newline. `--revoke` prints `Revoked the public link for {id}.` and does not print the token. JSON share success prints `{ share: { shared, shareUrl } }` on one line. `shareUrl` is null after revoke.
- Errors go to stderr and exit nonzero. In --json mode, use the common error envelope on stderr; reserve local codes FILE_NOT_FOUND, INVALID_INPUT, NETWORK_ERROR.
- No progress/framework startup logs on stdout. Close the Nest application context so the process exits.
- `configure` is the credentials command. There is no login or list command in the CLI, no background process, and no separate CLI server.
- Do not add automatic retries for uploads. `get` calls the content endpoint once.

## Configuration and planned root commands

Task 01 establishes script names; 07 makes them runnable and verifies documentation:

| Command | Purpose |
| --- | --- |
| pnpm infra:up | Start local PostgreSQL and the Garage S3 stand-in |
| pnpm db:migrate | Apply committed migrations |
| pnpm db:seed | Create/update local fixture rows idempotently |
| pnpm db:claim-local-artifacts -- --email … | Attach existing `local-user` artifacts to a signed-up account |
| pnpm dev | Run FE and BE together |
| pnpm factrove configure | Save an API key and API URL for a profile |
| pnpm factrove upload ... | Run Nest CLI upload |
| pnpm factrove get ... | Print artifact content as HTML or Markdown |
| pnpm factrove share ... | Create, print, or revoke a public link |
| pnpm build / pnpm typecheck / pnpm test | Workspace verification |
| pnpm infra:down | Stop services without removing data volumes |
| pnpm e2e | Run the local upload, viewer, restart, and S3 integration checks against Compose project factrove-e2e |

Application env (`apps/api/.env`, copied from `apps/api/.env.example`): DATABASE_URL, HOST (127.0.0.1), PORT (3001), WEB_ORIGIN, API_PUBLIC_ORIGIN, PUBLIC_BASE_URL, NEXT_PUBLIC_API_URL, BETTER_AUTH_SECRET, optional AUTH_COOKIE_DOMAIN, optional SHARE_TOKEN_KEY, optional TRUSTED_PROXIES, S3_BUCKET, S3_REGION, optional S3_ENDPOINT and S3_FORCE_PATH_STYLE, and the standard AWS credential chain (`AWS_PROFILE`, or `AWS_ACCESS_KEY_ID` with `AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN`). `PUBLIC_BASE_URL` defaults to `WEB_ORIGIN` when unset. It is an absolute http(s) origin and is the only source for viewer URLs and public share links. `SHARE_TOKEN_KEY` encrypts share tokens. When it is unset, the key is derived from `BETTER_AUTH_SECRET`. `TRUSTED_PROXIES` is required behind a proxy so the per-process public view limit sees the visitor. The API loads that file and keeps variables already set in the process. `pnpm dev` passes `NEXT_PUBLIC_API_URL` from the same file to the web app when the variable is unset. `pnpm build` and `next build` do the same, and Next.js fixes that origin in the client bundle. `next start` cannot change it. Only `NEXT_PUBLIC_API_URL` is copied. The default is http://localhost:3001. `S3_INTEGRATION=1` runs the storage integration tests against local Garage. Those tests set the Garage endpoint and credentials, remove `AWS_*` and `S3_*` overrides, and require a loopback HTTP endpoint before opening a client. With `S3_ENDPOINT` unset, the API does not use a custom S3 endpoint. `MARKDOWN_CONVERSION_CONCURRENCY` (default 2) and `MARKDOWN_CONVERSION_QUEUE` (default 2) bound on-request Markdown conversion.

CLI env (`apps/cli/.env`, copied from `apps/cli/.env.example`): `FACTROVE_API_URL` and `FACTROVE_PROFILE`. `pnpm factrove` reads that file. The built CLI does not. A URL from the file is used only when `FACTROVE_API_URL` is unset and the selected profile has no `api_url`. The file does not supply an API key or config-path overrides. The CLI reads `FACTROVE_API_KEY`, `FACTROVE_PROFILE`, and the config-path overrides from the process environment, and reads `api_url` and `factrove_api_key` from `~/.factrove/config` and `~/.factrove/credentials`. Precedence is flags, then process environment variables, then profile files, then the dev file URL. Client packages must never receive database, storage, or auth-secret credentials. The dev file is limited to `FACTROVE_API_URL` and `FACTROVE_PROFILE`.

Local setup uses Garage from `pnpm infra:up`, which creates the bucket. An operator can use an existing AWS bucket by setting `S3_BUCKET` and `S3_REGION` and leaving `S3_ENDPOINT` unset. The API does not create that AWS bucket.
