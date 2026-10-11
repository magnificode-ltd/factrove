# Task 04 — NestJS upload, list, and content API

## Goal

Implement the unauthenticated HTTP API connecting PostgreSQL metadata and S3 bytes.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md) and [mvp_contract.md](mvp_contract.md). Status: not started. Depends on 01; can start against 02/03 interfaces, but needs both implementations to finish.

## Owns

API bootstrap/app.module, src/controllers/**, src/services/**, src/rendering/**, HTTP error mapping, and backend endpoint tests. Do not edit Prisma migrations or storage provider internals without their owners.

## Deliverables

- Follow the [README backend directory structure](../README.md#backend-directory-structure) for controllers, services, module wiring, and HTML policy. Consume repositories through the database module's exports.
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
