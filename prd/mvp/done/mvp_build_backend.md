# Task 04 — NestJS upload, list, and content API

## Goal

Implement the unauthenticated HTTP API connecting PostgreSQL metadata and S3 bytes.

Read [the MVP end state](../../MVP_END_STATE.md), [the project README](../../../README.md) and [the shared MVP contract](../../mvp_contract.md). **Status: done — October 11, 2026.** Depends on 01; finished against the 02 and 03 implementations.

## Owns

API bootstrap/app.module, src/controllers/**, src/services/**, src/rendering/**, HTTP error mapping, and backend endpoint tests. Do not edit Prisma migrations or storage provider internals without their owners.

## Deliverables

- Follow the [README backend directory structure](../../../README.md#backend-directory-structure) for controllers, services, module wiring, and HTML policy. Consume repositories through the database module's exports.
- Implement the health/context/upload/list/detail/content endpoints exactly as specified.
- Wire the global DatabaseModule once, StorageModule, ServicesModule, and ApiModule. Endpoint tests that boot the API must override `BLOB_STORE`. Constructing the real client requires `S3_BUCKET` and `S3_REGION`.
- Resolve the configured seeded user/org in a small LocalActorService. This is configuration, not auth. Ignore/reject client attempts to select creator/org; no auth guards or placeholder credentials.
- Create private artifacts by default; capture configured organization_id, require it for org_shared.
- Validate bounded multipart input, filenames/extensions, UTF-8, size, and accessType. Preserve uploaded source bytes.
- Generate UUID and flat UUID.html key. Write the object, then insert the artifact with uploaded_at set. Return success only after both succeed.
- Treat the upload as atomic. If the object write fails, do not insert an artifact row. A failed upload leaves no artifact in the database.
- Map internal records to the shared DTO; construct URLs from configured origins.
- Implement exact mine/org filters via repositories, and 404 for an unknown id.
- Map `BlobStoreUnavailableError` to 503 `STORAGE_UNAVAILABLE`. Map `BlobNotFoundError` while reading content for an existing artifact row to 404 `ARTIFACT_NOT_FOUND`. A failed `put` stays 503 and inserts no row.
- Stream original HTML through the content endpoint using the fixed CSP/headers. No generic renderer registry, transformation, or server-side execution.
- Configure loopback binding and exact web-origin CORS. Do not accept the sandboxed document's opaque null origin.

## Acceptance

- Endpoint tests cover defaults, access filters, malformed requests, file limits/types, missing IDs, and common error envelopes.
- A real local PostgreSQL and configured AWS S3 run uploads fixture HTML and retrieves identical bytes through content.
- Simulated storage failures never return successful upload metadata and never leave an artifact row.
- HTML response headers enforce the shared sandbox policy, including direct navigation to content.
- A private artifact can be fetched by ID without credentials in this deliberately unauthenticated build; document that rather than implying privacy enforcement.
- Hand working base URL/configuration and verified responses to tasks 05/06/07.

## Exclusions

No Better Auth, API keys, user/org CRUD, membership, individual sharing, UI upload endpoint variants, replacement/delete/rename, pagination/search, queues, or quota tracking.

## Completion and handoff

The API listens on `127.0.0.1:3001` by default. Product routes are under `http://127.0.0.1:3001/api/v1`. `pnpm --filter @factrove/api dev` loads `apps/api/.env` when that file exists, without overriding variables already set in the process.

`GET /api/v1/health` returns `{ status: "ok" }` after startup. `GET /api/v1/context` returns the seeded local user and, when configured, the local organization. `POST /api/v1/artifacts` accepts one multipart `file` and an optional `accessType` (`private` by default). `GET /api/v1/artifacts?view=mine|org` defaults to `mine`. `GET /api/v1/artifacts/{id}` and `GET /api/v1/artifacts/{id}/content` do not check credentials. `private` and `org_shared` classify lists only; they are not access control.

The original upload name is not stored. `ArtifactDto.filename` and the object key are `{id}.html`. Uploads still require a non-empty `.html` or `.htm` basename. Bytes are stored and streamed unchanged. Content responses use `text/html; charset=utf-8`, `no-store`, `nosniff`, `no-referrer`, and a CSP whose sandbox is `allow-scripts` and whose `frame-ancestors` is `WEB_ORIGIN`. CORS allows that origin only, not `*` or the opaque `null` origin.

Viewer URLs are `WEB_ORIGIN/artifacts/{id}`. Content URLs are `API_PUBLIC_ORIGIN/api/v1/artifacts/{id}/content`. Both come from configuration, not the request Host header. `LOCAL_ORGANIZATION_ID` must be `local-org` for organization sharing; leave it blank for a user with no organization. A missing configured user or organization row fails startup instead of selecting another identity.

`apps/api/test/http.integration.test.ts` overrides `BLOB_STORE` and covers the endpoint contract against PostgreSQL. `S3_INTEGRATION=1 pnpm --filter @factrove/api test` also runs `content.s3.integration.test.ts`, which uploaded `fixtures/hello.html` to the configured bucket and read the same bytes back. Tasks 05 and 06 can call this API with `@factrove/api-client`. Task 07 still owns the combined dev command and infrastructure scripts.
