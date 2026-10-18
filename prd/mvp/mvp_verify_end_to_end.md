# Task 08 — End-to-end local acceptance

## Goal

Finish the live checks that task 07 left unrun. Task 07 verified the local Postgres runtime, `pnpm dev`, and the default test suites. This task owns the upload loop, the S3-gated integration tests, and a macOS run.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), [the shared MVP contract](../mvp_contract.md), [the task index](../README.md), and [the task 07 handoff](done/mvp_integrate_local.md). **Status: in progress.** Depends on 07.

## Product decision

The owner chose a fully local stack for now. A local S3-compatible stand-in is allowed. Real AWS S3 remains a configuration option: leave `S3_ENDPOINT` unset and the API keeps calling AWS in `S3_REGION`. This supersedes the task 07 exclusion of a local S3 emulator.

Garage `v2.3.0` is the stand-in. Official MinIO community images are no longer published. Garage is a maintained multi-arch image, and `--default-bucket` creates the local bucket when the service starts.

## Owns

The acceptance items below. Do not mark one complete until it has been run.

## Acceptance

1. From the repository root, run `pnpm factrove upload ./fixtures/hello.html` against the real API, local PostgreSQL, and the local Garage bucket. Also run the same upload with `--json`. The viewer URL uses the configured web origin.
2. Follow that viewer link. Refresh My artifacts and open the artifact. The uploaded HTML and its inline script are visible in the iframe.
3. The private artifact is absent from Organization artifacts.
4. Run `pnpm factrove upload ./fixtures/hello.html --access org_shared` from the repository root. That artifact appears in both My artifacts and Organization artifacts after refresh. Follow its viewer link.
5. The raw content endpoint sends sandbox and CSP headers. The iframe cannot access the parent DOM or make external requests.
6. Stop and restart the apps, PostgreSQL, and Garage without deleting the data volumes. Metadata remains and the object bytes remain viewable.
7. Run `storage.integration` and `content.s3.integration` with `S3_INTEGRATION=1` against Garage.
8. Run this setup on macOS with the pinned Node and pnpm versions. `localhost` can resolve to `::1` while the API and web bind `127.0.0.1`. Confirm the browser and a Node fetch to `http://localhost:3001` still reach the API.

## Not in this task

Local Postgres, Compose, `pnpm dev`, and the default test suites are already covered by task 07. AWS account or bucket provisioning is not required for the local stack.
