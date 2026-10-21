# Task 06 — NestJS upload CLI

## Goal

Let a person or coding agent upload a local HTML file and obtain a viewer link, without credentials.

Read [the MVP end state](../../MVP_END_STATE.md), [the project README](../../../README.md) and [the shared MVP contract](../../mvp_contract.md). **Status: done — stub-verified, October 18, 2026.** Depends on task 01. Uploads go to the task 04 API. The live API, PostgreSQL, and S3 acceptance is task 07.

## Owns

apps/cli/** after scaffold handoff. Coordinate the root pnpm factrove script with task 07.

## Deliverables

- Use NestFactory.createApplicationContext with a CLI-specific module and injectable command/config/file services. Do not start an HTTP server.
- Implement only `upload <path>`, `--access private|org_shared`, `--api-url <origin>`, `--json`, and help.
- Inject @factrove/api-client as a provider. Do not import apps/api, Prisma, storage SDKs, or Better Auth.
- Resolve the API URL using flag → FACTROVE_API_URL → localhost default precedence.
- Validate a readable regular file, supported extension, nonempty content, and the documented size bound; backend validation remains authoritative.
- Upload a Blob through the shared client with its basename, not the local absolute path.
- Print only viewerUrl on plain success; print the exact response envelope on one line for JSON success.
- Put useful errors on stderr and return a nonzero exit code. Preserve backend error codes; use the specified local codes for local input/network failures.
- Disable Nest bootstrap noise on stdout and close the application context on both success and failure.
- Do not automatically retry POST uploads: each request creates a new artifact.
- Document examples usable by another coding agent from the repository root. Publishing an npm package/global binary is not required.

## Acceptance

Using a local HTTP stub:

- Verify multipart file bytes/name and accessType.
- Verify default private and explicit org_shared.
- Verify configuration precedence.
- Verify plain/JSON output, stderr behavior, exit codes, and no framework log contamination.
- Verify missing file, directory path, unsupported extension, oversize file, server error, and unreachable API.
- Verify the command exits without a lingering Nest process.

Using the real local API, local PostgreSQL, and configured AWS S3 bucket:

- Run the documented command against fixtures/hello.html and follow its returned viewer link.
- Confirm the returned artifact appears in the appropriate UI lists after refresh.

## Exclusions

No login, API keys, credential file, interactive auth, list/share/delete commands, direct S3 uploads, direct database access, daemon, package publication, or backend bootstrap inside the CLI.

## Completion and handoff

`pnpm factrove upload <path>` builds nothing by itself. It runs the compiled CLI, which opens a Nest application context, uploads one HTML file, prints the result, and closes the context. There is no HTTP listener, login, credential file, or upload retry.

From the repository root, after `pnpm build`:

```sh
pnpm factrove upload ./fixtures/hello.html
pnpm factrove upload ./report.html --access org_shared --json
pnpm factrove upload ./report.html --api-url http://localhost:3001 --json
pnpm factrove upload --help
```

`--access` defaults to `private`. `--api-url` wins over `FACTROVE_API_URL`, which wins over the selected profile's `api_url`, which wins over a URL from `apps/cli/.env` loaded by `pnpm factrove`, which wins over `http://localhost:3001`. The built CLI does not read `apps/cli/.env`. That file may set `FACTROVE_API_URL` and `FACTROVE_PROFILE` only. API keys stay in `~/.factrove/credentials`. Flags win, then environment variables, then profile files, then the dev file URL. The multipart body sends the file basename and `accessType`. A relative path resolves from `INIT_CWD` when pnpm sets it, and otherwise from the process directory, so `./fixtures/hello.html` works from the repository root. `FILE_NOT_FOUND` includes the resolved absolute path. Plain success writes only `viewerUrl` and a newline to stdout. `--json` writes the client's `{ artifact }` envelope on one line. Local failures use `FILE_NOT_FOUND`, `INVALID_INPUT`, or `NETWORK_ERROR`. API failures keep the API `code` and `message`. `--json` errors use `{"error":{"code":"...","message":"..."}}` on stderr. Other errors use `<code>: <message>` on stderr. The process exits nonzero. `--help` and `help` print usage on stdout and exit 0.

The root script is `node scripts/factrove.mjs`, which runs `node apps/cli/dist/main.js` with the caller's working directory. That replaced `pnpm --filter @factrove/cli start`, which ran inside `apps/cli` and broke repository-root relative paths. Task 07 should keep this wiring. If `apps/cli/dist/main.js` is missing, the launcher prints: `The CLI is not built. From the repository root, run: pnpm --filter @factrove/cli build`. pnpm still prints the script line it executes, prefixed with `$ `, to stderr. Stdout stays limited to the viewer URL or the JSON envelope.

`pnpm --filter @factrove/cli test` runs 23 tests. They cover argument precedence, `.html`/`.htm` reads, basename handling, a symlink, the 10 MiB boundary, `INIT_CWD` resolution, and the compiled command against a local HTTP stub: multipart bytes and filename, default `private`, explicit `org_shared`, flag over environment, an origin that already ends in `/api/v1`, plain and JSON output, help, missing files, directories, unsupported extensions, empty and oversize files, `STORAGE_UNAVAILABLE` without a second POST, an unreachable API, and `pnpm factrove upload ./fixtures/hello.html` from the repository root. The default API origin `http://localhost:3001` is asserted in the argument unit test and is not bound by the process tests. Direct `node dist/main.js` success runs left stderr empty and did not print Nest logs.

The live check against PostgreSQL, the configured AWS bucket, and the web library was not run here. This environment has no PostgreSQL server, no `apps/api/.env`, and no AWS credential chain. That check is now an explicit task 07 acceptance item: from the repository root, upload `./fixtures/hello.html`, follow the viewer URL, and confirm the library lists after refresh.

On main, `ArtifactDto.filename` is `{id}.html`. The upload still requires an `.html` or `.htm` basename, and the CLI sends that basename. JSON output prints the API envelope, so `artifact.filename` is the id-based name the API returns.

Task 07 still owns the combined dev command, the application env example, infrastructure scripts, and lockfile reconciliation beyond the CLI test dependency added here.
