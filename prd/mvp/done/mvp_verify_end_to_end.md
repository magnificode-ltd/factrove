# Task 08 — End-to-end local acceptance

## Goal

Finish the live checks that task 07 left unrun. Task 07 verified the local Postgres runtime, `pnpm dev`, and the default test suites. This task owns the upload loop, the S3-gated integration tests, and a macOS run.

Read [the MVP end state](../../../docs/MVP_END_STATE.md), [the project README](../../../README.md), [the shared MVP contract](../../mvp_contract.md), [the task index](../../README.md), and [the task 07 handoff](mvp_integrate_local.md). **Status: done — local stack verified, October 18, 2026. The macOS run was not done.** Depends on 07.

## Product decision

The owner chose a fully local stack for now. A local S3-compatible stand-in is allowed. Real AWS S3 remains a configuration option: leave `S3_ENDPOINT` unset and the API keeps calling AWS in `S3_REGION`. This supersedes the task 07 exclusion of a local S3 emulator.

Garage `v2.3.0` is the stand-in. Official MinIO community images are no longer published. Garage is a maintained multi-arch image, and `--default-bucket` creates the local bucket when the service starts.

## Owns

The acceptance items below. Do not mark one complete until it has been run.

## Acceptance

1. From the repository root, run `pnpm factrove upload ./fixtures/hello.html` against the real API, local PostgreSQL, and the local Garage bucket. Also run the same upload with `--json`. The viewer URL uses the configured web origin. **Passed.**
2. Follow that viewer link. Refresh My artifacts and open the artifact. The uploaded HTML and its inline script are visible in the iframe. **Passed.**
3. The private artifact is absent from Organization artifacts. **Passed.**
4. Run `pnpm factrove upload ./fixtures/hello.html --access org_shared` from the repository root. That artifact appears in both My artifacts and Organization artifacts after refresh. Follow its viewer link. **Passed.**
5. The raw content endpoint sends sandbox and CSP headers. The iframe cannot access the parent DOM or make external requests. **Passed** in headless Chromium.
6. Stop and restart the apps, PostgreSQL, and Garage without deleting the data volumes. Metadata remains and the object bytes remain viewable. **Passed.**
7. Run `storage.integration` and `content.s3.integration` with `S3_INTEGRATION=1` against Garage. **Passed: 4 tests.**
8. Run this setup on macOS with the pinned Node and pnpm versions. `localhost` can resolve to `::1` while the API and web bind `127.0.0.1`. Confirm the browser and a Node fetch to `http://localhost:3001` still reach the API. **Not run.** This environment is Linux.

## Completion report

**Status: done — local stack verified, October 18, 2026.** `private` and `org_shared` remain list classifications. This build does not authenticate viewers. The live loop used Garage on `127.0.0.1:3900`, not a real AWS bucket. A unit test still checks that an unset `S3_ENDPOINT` addresses `bucket.s3.region.amazonaws.com` and ignores `AWS_ENDPOINT_URL`. There were no AWS credentials here, so that path was not called.

### What landed

- `compose.yaml` adds Garage `v2.3.0`, pinned by the multi-arch index `sha256:866bd13ed2038ba7e7190e840482bc27234c4afaf77be8cfa439ae088c1e4690` (linux/amd64 and linux/arm64, plus 386 and arm). Host port `3900` is bound to `127.0.0.1`. Volumes `factrove-garage-meta` and `factrove-garage-data` hold objects. `infra/garage.toml` has no credentials. The RPC secret and the local access key live in Compose, matching `apps/api/.env.example`.
- `pnpm infra:up` waits until PostgreSQL and Garage are healthy. Garage creates the `factrove` bucket on startup. `pnpm infra:down` keeps the dev project's Postgres and Garage volumes. `pnpm infra:reset` deletes those dev volumes after confirmation. `pnpm e2e` deletes volumes only in Compose project `factrove-e2e`. Objects in a real AWS bucket are outside both projects.
- The S3 client reads optional `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`. A set endpoint defaults to path-style addressing. Plain `http://` is accepted only for `localhost`, `127.0.0.1`, and `::1`. An unset endpoint keeps virtual-hosted AWS and ignores `AWS_ENDPOINT_URL` and `AWS_ENDPOINT_URL_S3`. The API does not create a bucket.
- `pnpm e2e` checks Docker and Playwright Chromium before it changes containers. It uses Compose project `factrove-e2e` on host ports 5433, 3910, 3100, and 3101, migrates, seeds twice, uploads, checks the library and the sandboxed viewer, restarts that project without dropping its volumes, and runs the S3 integration tests. The API and those tests set the Garage endpoint and credentials, strip `AWS_*` and `S3_*` overrides, and require a loopback HTTP endpoint before any S3 call. The dev project from `pnpm infra:up` is left in place.

### Commands run on October 18, 2026

The run was Linux x86_64 with Docker Engine 29.1.3 and Compose 2.40.3, Node 24.16.0, and pnpm 11.25.0. It was not a Mac. The first `pnpm e2e` on that date reset the dev Compose project. The current script uses `factrove-e2e` instead, as described above.

```sh
pnpm install --frozen-lockfile
pnpm e2e
S3_INTEGRATION=1 pnpm --filter @factrove/api exec vitest run test/storage.integration.test.ts test/content.s3.integration.test.ts
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm e2e` applied `20261011120000_add_identity_and_artifact` to an empty database. A second deploy reported no pending migrations. Two seeds left one `user` row and one `organization` row. Context returned Local User and Local Organization. Both artifact lists started empty.

`pnpm factrove upload ./fixtures/hello.html` printed only `http://localhost:3000/artifacts/<id>`. `--json` printed one artifact envelope whose `viewerUrl` used that origin. `--access org_shared` printed a second viewer URL. Headless Chromium refreshed My artifacts and Organization artifacts. My artifacts listed the private ids and the org_shared id. Organization artifacts listed only the org_shared id. Opening both viewer URLs showed `Inline JavaScript ran successfully.` inside the iframe. The parent document did not contain that text. The iframe sandbox was `allow-scripts` with `referrerpolicy=no-referrer`. Script access to `window.parent.document` threw, and `fetch("https://example.com/")` from the iframe failed. The content response was `text/html; charset=utf-8` with `no-store`, `nosniff`, `no-referrer`, and a CSP that includes `sandbox allow-scripts`, `connect-src 'none'`, and `frame-ancestors http://localhost:3000`.

A missing file returned `FILE_NOT_FOUND`. `README.md` returned `INVALID_INPUT`. An unknown id returned `404` `ARTIFACT_NOT_FOUND`. With the API stopped, the library page said `The Factrove API is unavailable. Start the backend and refresh.` The oversized-file check from task 07 was not repeated.

`pnpm infra:down` and `pnpm infra:up` kept the volumes. After `pnpm dev` started again, the same ids were in the lists, the user count was still 1, and the content bytes matched `fixtures/hello.html`.

`S3_INTEGRATION=1` reported `Test Files  2 passed` and `Tests  4 passed` (`storage.integration` 3, `content.s3.integration` 1). The default `pnpm test` left those 4 skipped.

`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed. `pnpm test` reported api-client 6, web 17, cli 24, api 44 passed and 4 skipped, plus 12 runtime script tests.

### Not run

- A macOS execution. The Garage and Postgres image pins include linux/arm64 and linux/amd64. On macOS, `localhost` may resolve to `::1` while the API and web bind `127.0.0.1`. That browser and Node fetch check is still open.
- A live call to a real AWS bucket. The regional host is covered by a unit test only.

No product decision is blocking. Garage 2.3.0, the local key `factrove-local`, and the bucket name `factrove` are local runtime choices.

## Not in this task

Local Postgres, Compose, `pnpm dev`, and the default test suites were already covered by task 07. AWS account or bucket provisioning is not required for the local stack.
