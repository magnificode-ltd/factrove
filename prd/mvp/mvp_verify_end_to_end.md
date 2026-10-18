# Task 08 — End-to-end AWS and macOS checks

## Goal

Finish the live checks that task 07 left unrun. Task 07 verified the local Postgres runtime, `pnpm dev`, and the default test suites. This task owns the AWS upload loop, the S3-gated integration tests, and a macOS run.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), [the shared MVP contract](../mvp_contract.md), [the task index](../README.md), and [the task 07 handoff](done/mvp_integrate_local.md). **Status: not started.** Depends on 07.

## Owns

The acceptance items below. Do not mark one complete until it has been run. Do not add a local S3 emulator.

## Acceptance

1. From the repository root, run `pnpm factrove upload ./fixtures/hello.html --json` against the real API, local PostgreSQL, and the configured AWS S3 bucket. The viewer URL uses the configured web origin.
2. Follow that viewer link. Refresh My artifacts and open the artifact. The uploaded HTML and its inline script are visible in the iframe.
3. The private artifact is absent from Organization artifacts.
4. Run `pnpm factrove upload ./fixtures/hello.html --access org_shared` from the repository root. That artifact appears in both My artifacts and Organization artifacts after refresh. Follow its viewer link.
5. The raw content endpoint sends sandbox and CSP headers. The iframe cannot access the parent DOM or make external requests.
6. Stop and restart the apps and PostgreSQL without deleting the database volume. Metadata remains and the AWS object bytes remain viewable.
7. Run `storage.integration` and `content.s3.integration` with `S3_INTEGRATION=1`.
8. Run this setup on macOS with the pinned Node and pnpm versions. `localhost` can resolve to `::1` while the API and web bind `127.0.0.1`. Confirm the browser and a Node fetch to `http://localhost:3001` still reach the API.

## Not in this task

Local Postgres, Compose, `pnpm dev`, and the default test suites are already covered by task 07.
