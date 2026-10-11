# Task 06 — NestJS upload CLI

## Goal

Let a person or coding agent upload a local HTML file and obtain a viewer link, without credentials.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md) and [mvp_contract.md](mvp_contract.md). Status: not started. Depends on 01; may use an HTTP stub until 04 is ready.

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

Using the real local API/S3/PostgreSQL stack:

- Run the documented command against fixtures/hello.html and follow its returned viewer link.
- Confirm the returned artifact appears in the appropriate UI lists after refresh.

## Exclusions

No login, API keys, credential file, interactive auth, list/share/delete commands, direct S3 uploads, direct database access, daemon, package publication, or backend bootstrap inside the CLI.
