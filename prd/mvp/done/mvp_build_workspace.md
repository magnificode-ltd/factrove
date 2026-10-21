# Task 01 — Workspace, contracts, and shared HTTP client

## Goal

Provide a small buildable baseline so database, storage, backend, web, and CLI work can proceed independently.

Read [the project README](../../../README.md), [the MVP end state](../../MVP_END_STATE.md), and [the shared MVP contract](../../mvp_contract.md). **Status: done — October 11, 2026.** Implemented by a Luna agent at medium reasoning and reviewed by the parent agent.

## Owns

Root package.json, pnpm-workspace.yaml, initial lockfile, shared TypeScript/lint configuration, packages/contracts, packages/api-client, initial manifests/entrypoints for all three apps, and fixtures/hello.html. Handoff application directories to their owners after the baseline is ready.

## Deliverables

- Pin compatible Node, pnpm, TypeScript, NestJS, Next.js, and Prisma versions. Use pnpm workspace dependencies and one lockfile; no Nx.
- Scaffold @factrove/web (Next.js), @factrove/api (Nest HTTP), and @factrove/cli (Nest standalone context). Implement only enough entrypoints to build and start; no product behavior.
- Create @factrove/contracts with runtime schemas/types for DTOs, access/list enums, envelopes, and errors from the contract. Do not export ORM or server implementation types.
- Create the framework-neutral @factrove/api-client with the agreed methods, origin handling, multipart upload, injected fetch, and useful error handling.
- Set explicit package exports that resolve in Next.js and compiled Node apps. Establish working build order.
- Establish the planned root script names and delegate implementation-specific wiring to task 07. Clearly mark any remaining setup scripts as pending rather than silently succeeding.
- Provide a small self-contained HTML fixture with visible text, inline styling, and an inline script that changes a visible element.
- Document dependency versions and the baseline handoff. Ensure web/CLI do not import apps/api code.

## Acceptance

- A clean install can build/typecheck the shared packages and all three skeleton apps.
- API client contract tests cover multipart field names, response parsing, error envelopes, and a network failure using an HTTP stub or injected fetch.
- Tests verify the client appends /api/v1 exactly once and does not set its own multipart boundary.
- Contracts can be consumed by browser and Node runtimes.
- Nest CLI scaffold closes its context without leaving the terminal hanging or emitting startup logs on stdout.
- Hand off actual package paths, exports, and commands to tasks 02–07.

## Exclusions

No full API, database schema, auth, storage provider, product screens, or additional packages. Do not let scaffold work expand into implementation assigned to other agents.

## Completion and handoff

- Added the pnpm workspace with Next.js web, NestJS HTTP API, and standalone NestJS CLI skeletons.
- Added runtime contracts, framework-neutral API client, six client contract tests, shared TypeScript/lint configuration, pinned runtime/dependencies, lockfile, and a self-contained HTML fixture.
- Verified `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` (six passing tests).
- Verified the compiled CLI exits successfully with zero stdout/stderr, and pending setup commands exit nonzero with an explicit message.
- Started and stopped both compiled server scaffolds on loopback: the empty API responded with the expected 404, and Next.js served the scaffold page with HTTP 200. These checks do not claim product endpoint or browser-interaction coverage.
- Recorded versions, exports, and ownership handoffs in the workspace handoff below.

Tasks 02–07 remain pending. The upload command, product endpoints/screens, PostgreSQL/S3 implementations, and combined local runtime have not been implemented. API/CLI dev scripts compile once and do not watch for changes. Root local-service/database/dev commands explicitly remain pending.

## Workspace handoff

The baseline pins Node 24.16.0, pnpm 11.25.0, TypeScript 5.9.3, NestJS 11.1.9, Next.js 16.4.0, React 19.3.0, and Zod 4.1.12. Prisma 6.19.0 is pinned by workspace override for the database task. Package manifests and the lockfile carry the dependency state; shared packages build before their consumers through pnpm dependency ordering.

`packages/api-client` exports `createFactroveClient` and `FactroveApiError` and consumes `@factrove/contracts`. The browser scaffold imports the shared client; the Nest CLI registers it through the `FACTROVE_CLIENT` provider.

Ownership after this task:

- Task 02 adds the Prisma schema, migrations, seed, and concrete repositories.
- Task 03 implements backend-local S3 storage.
- Task 04 owns `apps/api/src/main.ts`, `app.module.ts`, and product HTTP behavior.
- Task 05 owns `apps/web/src/app` and product screens.
- Task 06 owns `apps/cli/src/main.ts`, `CliModule`, and upload behavior.
- Task 07 integrates setup scripts, local infrastructure, and the shared lockfile.

At handoff, `pnpm dev`, `pnpm infra:up`, `pnpm infra:down`, `pnpm db:migrate`, and `pnpm db:seed` exit with pending-task messages. Package-level scaffold and verification commands work. The CLI closes its context quietly but has no upload command yet. API development compiles once; web development uses Next.js dev mode.
