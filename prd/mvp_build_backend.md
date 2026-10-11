# Task 04 — NestJS upload, list, and content API

## Goal

Implement the unauthenticated HTTP API connecting PostgreSQL metadata and S3 bytes.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md) and [mvp_contract.md](mvp_contract.md). Status: not started. Depends on 01; can start against 02/03 interfaces, but needs both implementations to finish.

## Owns

API bootstrap/app.module, src/controllers/**, src/services/**, src/rendering/**, HTTP error mapping, and backend endpoint tests. Do not edit Prisma migrations or storage provider internals without their owners.

## Deliverables

- Follow the [README backend directory structure](../README.md#backend-directory-structure) for controllers, services, module wiring, and HTML policy. Consume repositories through the database module's exports.
- Implement the health/context/upload/list/detail/content endpoints exactly as specified.
- Wire the global DatabaseModule once, StorageModule, ServicesModule, and ApiModule.
- Resolve the configured seeded user/org in a small LocalActorService. This is configuration, not auth. Ignore/reject client attempts to select creator/org; no auth guards or placeholder credentials.
- Create private artifacts by default; capture configured organization_id, require it for org_shared.
- Validate bounded multipart input, filenames/extensions, UTF-8, size, and accessType. Preserve uploaded source bytes.
- Generate UUID and flat UUID.html key, create pending metadata, write S3, then finalize uploaded_at. Return success only after both storage and metadata succeed.
- Keep S3 I/O outside database transactions. Attempt cleanup on failure; keep failures non-viewable. Document residual crash/orphan limitations without adding new tables/workers.
- Map internal records to the shared DTO; construct URLs from configured origins.
- Implement exact mine/org filters via repositories, and 404 for unknown/pending IDs.
- Stream original HTML through the content endpoint using the fixed CSP/headers. No generic renderer registry, transformation, or server-side execution.
- Configure loopback binding and exact web-origin CORS. Do not accept the sandboxed document's opaque null origin.

## Acceptance

- Endpoint tests cover defaults, access filters, malformed requests, file limits/types, missing IDs, and common error envelopes.
- A real local PostgreSQL/S3 run uploads fixture HTML and retrieves identical bytes through content.
- Simulated storage/finalization failures never return successful upload metadata or make pending rows listable.
- HTML response headers enforce the shared sandbox policy, including direct navigation to content.
- A private artifact can be fetched by ID without credentials in this deliberately unauthenticated build; document that rather than implying privacy enforcement.
- Hand working base URL/configuration and verified responses to tasks 05/06/07.

## Exclusions

No Better Auth, API keys, user/org CRUD, membership, individual sharing, UI upload endpoint variants, replacement/delete/rename, pagination/search, queues, or quota tracking.
