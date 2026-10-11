# Factrove local MVP — task index

## Outcome

Run Factrove on the owner's Mac. An agent uploads an HTML file through the Nest CLI. Refreshing the Next.js library shows it, and clicking it displays the HTML. PostgreSQL and object storage persist the result. No authentication, API keys, or cloud service are required.

The agreed product target and models are in [../docs/MVP_END_STATE.md](../docs/MVP_END_STATE.md). The [shared contract](mvp_contract.md) defines implementation interfaces; this index tracks execution and progress. Task 01 is complete; the remaining briefs are implementation assignments. Completed briefs are archived under `prd/mvp/done/`.

## Tasks and ownership

| ID | Brief | Status | Owns | Prerequisites |
| --- | --- | --- | --- | --- |
| 01 | [Workspace and shared client](mvp/done/mvp_build_workspace.md) | Done | Root workspace/config, initial app scaffolds, packages/contracts, packages/api-client, fixture HTML | Shared contract |
| 02 | [Database](mvp_build_database.md) | Not started | API Prisma schema/migrations/seed and src/database | 01 baseline |
| 03 | [Storage](mvp_build_storage.md) | Not started | API src/storage and storage-focused tests | 01 baseline |
| 04 | [Backend](mvp_build_backend.md) | Not started | API bootstrap, controllers, services, rendering | 01; 02/03 interfaces, implementations for final verification |
| 05 | [Frontend](mvp_build_frontend.md) | Not started | apps/web after scaffold handoff | 01; may use contract fixtures before 04 is ready |
| 06 | [CLI](mvp_build_cli.md) | Not started | apps/cli after scaffold handoff | 01; may use an HTTP stub before 04 is ready |
| 07 | [Local runtime and integration](mvp_integrate_local.md) | Not started | compose.yaml, .env.example, setup docs/scripts, integration checks, shared lockfile reconciliation | 01 to start; 02–06 to finish |

## Parallel execution

1. Complete 01 and hand off a buildable baseline with agreed dependency versions, exports, API client, and app skeletons. It is a small integration prerequisite, not the entire application.
2. Start 02, 03, 05, and 06 independently. Task 04 can implement against the repository/storage contracts while 02/03 are in progress.
3. Task 07 can prepare local PostgreSQL/storage services and setup instructions alongside those tasks.
4. Integrate 02/03 into 04, then verify web and CLI against the real backend. Complete 07's end-to-end acceptance.

With fewer agents, schedule these streams in waves. With shared checkouts, respect the disjoint ownership above; isolated branches/worktrees can also be used. Do not overwrite another task's in-progress work.

Task 01 owns app entrypoints only until its baseline handoff. Afterward, 04 owns API entrypoints, 05 owns web, and 06 owns CLI. Only 02 owns the Prisma migration history. API owners coordinate additions to the API package manifest; 07 reconciles the root lockfile and setup scripts. App owners report needed shared dependency changes rather than independently changing version policy.

Stub implementations are development aids, not final deliverables. Mark all mocked acceptance checks as such. No task is complete solely because mocks pass if its brief requires a real service.

## Scope exclusions

No Better Auth setup, API keys, login screens, auth middleware, membership administration, organization switching, file sharing to specific recipients, UI uploading, deletion/renaming, replacement/versioning, pagination/search, quotas, Redis, Temporal, cloud billing, or non-HTML rendering.

Do not introduce extra tables or storage providers to solve hypothetical later requirements. Keep a small backend-local S3 boundary; a local S3-compatible service exercises that same implementation.

## Final acceptance checklist

- [ ] A fresh clone has a verified macOS setup path using pinned Node/pnpm versions and a documented container runtime prerequisite.
- [ ] PostgreSQL and local S3-compatible storage start with persistent volumes and a dedicated bucket.
- [ ] Committed migrations apply to an empty database; explicit seed runs twice without duplicates or destructive resets.
- [ ] One command starts FE/BE; the CLI runs from another terminal without database/storage credentials.
- [ ] Private upload returns a viewer URL; refreshing My artifacts shows it; it is absent from Organization artifacts.
- [ ] Organization-shared upload appears in both My artifacts and Organization artifacts for the local actor.
- [ ] Clicking either artifact renders the uploaded HTML in an isolated iframe.
- [ ] A second user's seeded organization-shared artifact appears in Organization artifacts but not My artifacts; their private artifact appears in neither list.
- [ ] Missing files, unsupported inputs, oversized uploads, unknown IDs, and an unavailable backend produce useful errors.
- [ ] The CLI exits cleanly and JSON output contains no framework startup logs.
- [ ] Restarting FE/BE and local services without deleting volumes preserves the uploads.
- [ ] No raw HTML is injected into the Next.js application DOM; iframe/CSP isolation is checked.
- [ ] Root build/typecheck and the targeted checks documented by each task pass.
- [ ] Setup instructions distinguish unauthenticated list classifications from actual access control.

Task 01's baseline is ready for the remaining implementation streams. Tasks 02–07 have not been dispatched or marked complete.
