# Factrove local MVP — task index

## Outcome

Run Factrove on the owner's Mac. An agent uploads an HTML file through the Nest CLI. Refreshing the Next.js library shows it, and clicking it displays the HTML. PostgreSQL persists metadata locally, and the configured S3 bucket persists artifact bytes. Local setup uses Garage. Real AWS S3 remains available when `S3_ENDPOINT` is unset. No Factrove authentication or API keys are required.

The agreed product target and models are in [../docs/MVP_END_STATE.md](../docs/MVP_END_STATE.md). The [shared contract](mvp_contract.md) defines implementation interfaces; this index tracks execution and progress. Tasks 01–08 are complete except the macOS localhost check, which remains open in [mvp/mvp_macos_localhost.md](mvp/mvp_macos_localhost.md). Task 06 is stub-verified. Completed briefs are archived under `prd/mvp/done/`.

## Tasks and ownership

All implementation tasks follow the [canonical backend directory structure](../README.md#backend-directory-structure) where applicable. Directory placement is part of acceptance, alongside behavior and tests. Task ownership determines who implements each part; README defines where that code belongs.

| ID | Brief | Status | Owns | Prerequisites |
| --- | --- | --- | --- | --- |
| 01 | [Workspace and shared client](mvp/done/mvp_build_workspace.md) | Done | Root workspace/config, initial app scaffolds, packages/contracts, packages/api-client, fixture HTML | Shared contract |
| 02 | [Database](mvp/done/mvp_build_database.md) | Done | API Prisma schema/migrations/seed and src/database | 01 baseline |
| 03 | [Storage](mvp/done/mvp_build_storage.md) | Done | API src/storage and storage-focused tests | 01 baseline |
| 04 | [Backend](mvp/done/mvp_build_backend.md) | Done | API bootstrap, controllers, services, rendering | 01; 02/03 interfaces, implementations for final verification |
| 05 | [Frontend](mvp/done/mvp_build_frontend.md) | Done | apps/web after scaffold handoff | 01; may use contract fixtures before 04 is ready |
| 06 | [CLI](mvp/done/mvp_build_cli.md) | Done — stub-verified | apps/cli after scaffold handoff | 01; may use an HTTP stub before 04 is ready |
| 07 | [Local runtime and integration](mvp/done/mvp_integrate_local.md) | Done — runtime verified; AWS live loop not run | compose.yaml, .env.example, setup docs/scripts, integration checks, shared lockfile reconciliation | 01 to start; 02–06 to finish |
| 08 | [End-to-end local acceptance](mvp/done/mvp_verify_end_to_end.md) | Done — local stack verified; macOS not run | Local Garage stand-in, live CLI upload, viewer and list refresh, content CSP, bytes after restart, macOS setup, S3-gated integration tests | 07 |

## Parallel execution

1. Complete 01 and hand off a buildable baseline with agreed dependency versions, exports, API client, and app skeletons. It is a small integration prerequisite, not the entire application.
2. Start 02, 03, 05, and 06 independently. Task 04 can implement against the repository/storage contracts while 02/03 are in progress.
3. Task 07 can prepare local PostgreSQL and setup instructions alongside those tasks. Task 08 adds the local Garage stand-in. An AWS bucket remains an optional configuration.
4. Integrate 02/03 into 04, then verify web and CLI against the real backend. Task 07 provides the local runtime. Task 08 runs the remaining live upload and macOS checks.

With fewer agents, schedule these streams in waves. With shared checkouts, respect the disjoint ownership above; isolated branches/worktrees can also be used. Do not overwrite another task's in-progress work.

Task 01 owns app entrypoints only until its baseline handoff. Afterward, 04 owns API entrypoints, 05 owns web, and 06 owns CLI. Only 02 owns the Prisma migration history. API owners coordinate additions to the API package manifest; 07 reconciles the root lockfile and setup scripts. App owners report needed shared dependency changes rather than independently changing version policy.

Stub implementations are development aids, not final deliverables. Mark all mocked acceptance checks as such. No task is complete solely because mocks pass if its brief requires a real service.

## Scope exclusions

Better Auth identity schema generation is included in the database task. Live authentication setup, API keys, login screens, auth middleware, membership administration, organization switching, file sharing to specific recipients, UI uploading, deletion/renaming, replacement/versioning, pagination/search, quotas, Redis, Temporal, cloud billing, and non-HTML rendering are deferred.

Use Artifact as the custom product table alongside the schema required by Better Auth core and its organization plugin. Keep a small backend-local S3 boundary. Local development uses Garage. Real AWS S3 remains the configuration with `S3_ENDPOINT` unset.

## Final acceptance checklist

- [ ] A fresh clone has a verified macOS setup path using pinned Node/pnpm versions and a documented container runtime prerequisite. The open check is [mvp/mvp_macos_localhost.md](mvp/mvp_macos_localhost.md).
- [x] PostgreSQL starts with a persistent volume. Artifact bytes use the configured S3 bucket. Local setup uses Garage. AWS remains available when `S3_ENDPOINT` is unset.
- [x] Committed migrations apply to an empty database; explicit seed runs twice without duplicates or destructive resets.
- [x] One command starts FE/BE; the CLI runs from another terminal without database/storage credentials.
- [x] Private upload returns a viewer URL; refreshing My artifacts shows it; it is absent from Organization artifacts.
- [x] Organization-shared upload appears in both My artifacts and Organization artifacts for the local actor.
- [x] Clicking either artifact renders the uploaded HTML in an isolated iframe.
- [x] A second user's seeded organization-shared artifact appears in Organization artifacts but not My artifacts; their private artifact appears in neither list.
- [x] Missing files, unsupported inputs, oversized uploads, unknown IDs, and an unavailable backend produce useful errors.
- [x] The CLI exits cleanly and JSON output contains no framework startup logs.
- [x] Restarting FE/BE, PostgreSQL, and local object storage without deleting the data volumes preserves metadata and object bytes. AWS objects stay in AWS when that configuration is used.
- [x] No raw HTML is injected into the Next.js application DOM; iframe/CSP isolation is checked.
- [x] Root build, typecheck, and the default test suites pass.
- [x] S3-gated integration tests pass (`storage.integration` and `content.s3.integration`, enabled with `S3_INTEGRATION=1`).
- [x] Setup instructions distinguish unauthenticated list classifications from actual access control.

Checked items were observed on October 18, 2026. The upload loop, library refresh, sandboxed viewer, content headers, restart, and `S3_INTEGRATION=1` tests ran on Linux against local PostgreSQL and Garage. Headless Chromium showed the fixture's inline script inside the iframe and showed that the frame could not read the parent document or call `https://example.com/`. The parent page did not contain the uploaded HTML. After `pnpm infra:down` and `pnpm infra:up`, the same artifact bytes were still served. `storage.integration` and `content.s3.integration` passed (4 tests). The default `pnpm test` still skips those 4 unless `S3_INTEGRATION=1`. Root lint, typecheck, test, and build passed: api-client 6, web 17, cli 24, api 44 passed and 4 skipped, plus 12 runtime script tests.

The macOS item is unchecked. This run was Linux x86_64, Node 24.16.0, pnpm 11.25.0, Docker Engine 29.1.3, and Compose 2.40.3. A real AWS bucket was not called. A unit test checks that an unset `S3_ENDPOINT` still targets the regional AWS host. The second-user list check remains the earlier database insert plus the real API and library UI. The oversized-file CLI error remains the earlier check; missing file, non-HTML, unknown id, and the web unavailable-backend screen were checked again.

Tasks 01–08 are complete except the macOS localhost check in [mvp/mvp_macos_localhost.md](mvp/mvp_macos_localhost.md). Task 06 is stub-verified. Task 08's local stack is verified.
