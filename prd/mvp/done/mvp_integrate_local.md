# Task 07 — Self-hosted macOS runtime and end-to-end integration

## Goal

Make the full upload → refresh → view loop runnable from a fresh checkout on a Mac.

Read [the MVP end state](../../MVP_END_STATE.md), [the project README](../../../README.md), [the shared MVP contract](../../mvp_contract.md), and [the task index](../../README.md). **Status: done — local runtime verified, October 18, 2026. The AWS upload and viewer loop was not run.** Depends on 02–06 for completion.

## Owns

compose.yaml, apps/api/.env.example, apps/cli/.env.example, local infrastructure initialization, setup scripts/docs, final root command wiring, shared lockfile reconciliation, and end-to-end checks. Coordinate changes in other task directories with their owners.

## Deliverables

- Provide persistent PostgreSQL using a container. Select and pin an image compatible with the target Mac architecture.
- Bind the PostgreSQL host port to loopback.
- Do not run an S3 service, create a bucket, or set a custom S3 endpoint. Artifact bytes use the existing AWS bucket named by `S3_BUCKET`. Document the bucket, region, and API-only credentials the operator must supply.
- Document Node/pnpm and container-runtime prerequisites, environment setup, first migration/seed, and FE/BE startup.
- Implement/verify the root commands listed in the shared contract. pnpm dev should start frontend/backend with visible logs and clean shutdown; CLI runs separately.
- Keep migrations and local seed explicit before startup. An API restart must not reset data.
- Make infra:down preserve volumes; any destructive reset must be separately named/documented and never part of normal setup.
- Ensure only the API receives database/storage secrets. Web/CLI receive HTTP origins.
- Put `NEXT_PUBLIC_API_URL=http://localhost:3001` in `apps/api/.env.example` with the API settings. `pnpm dev` and `pnpm build` read it when the variable is unset. `FACTROVE_API_URL` lives in `apps/cli/.env.example`, commented out because the built-in default is already that origin. `pnpm factrove` reads the file. The built CLI does not. A profile `api_url` wins over the file. `--api-url` overrides both.
- Keep `pnpm factrove` on `node scripts/factrove.mjs`, which runs `node apps/cli/dist/main.js` in the caller's directory. The launcher sets that directory from `INIT_CWD`. The CLI resolves a relative path from its own working directory. Do not point the script back at `pnpm --filter @factrove/cli start`.
- Integrate the independently developed tasks and reconcile shared dependencies/lockfile.
- Update root README to distinguish implemented behavior from future plans and include commands verified on the actual checkout.
- Provide a short troubleshooting path for unavailable containers, missing seed, missing or unauthorized S3 bucket, port conflicts, and backend URL errors.

## End-to-end acceptance

Run against the real local stack, not mocks. Task 06 verified the CLI with an HTTP stub only. Items 3–6 below are that task's live acceptance and are not done until they pass here.

1. Install from the committed lockfile, start infrastructure, apply migrations to an empty database, seed twice.
2. Start FE/BE. Verify the seeded context and initially empty library.
3. From the repository root, run `pnpm factrove upload ./fixtures/hello.html --json` against the real API, local PostgreSQL, and the configured AWS S3 bucket. Parse stdout as JSON and assert the viewer URL uses the configured web origin.
4. Follow that viewer link. Refresh My artifacts and open the new artifact. Verify visible source content and inline script behavior.
5. Confirm the private artifact is absent from Organization artifacts.
6. From the repository root, run `pnpm factrove upload ./fixtures/hello.html --access org_shared`. Confirm that artifact appears in both My artifacts and Organization artifacts after refresh, and follow its viewer link.
7. Using isolated test fixtures, create another user's org_shared/private artifacts. Confirm the list semantics without adding a user switcher.
8. Verify the raw content endpoint sends sandbox/CSP headers and the iframe cannot access the parent DOM or make external requests.
9. Stop and restart applications and PostgreSQL without deleting the database volume. Confirm metadata remains and the AWS object bytes remain viewable.
10. Run workspace build/typecheck and targeted tests, then record actual results.

Use a browser check for visible rendering; HTTP status alone is insufficient. Do not claim full MVP completion if the UI, CLI, or persistence was only tested with mocks.

## Completion and handoff

**Status: done — local runtime verified, October 18, 2026.** `private` and `org_shared` remain list classifications. This build does not authenticate viewers. The AWS upload, byte persistence, and sandboxed render of an uploaded file were not run: this environment has no AWS credential chain, and the plan forbids a local S3 emulator.

### What landed

- `compose.yaml` runs official Postgres `17.11`, pinned by the multi-arch image index `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3` (linux/amd64 and linux/arm64). Host port `5432` is bound to `127.0.0.1`. The named volume `factrove-postgres` holds the data. There is no S3 service.
- `pnpm infra:up` waits until Postgres is healthy. `pnpm infra:down` removes the container and network and keeps the volume. `pnpm infra:reset` is the only command that deletes the volume. It asks for confirmation in a terminal and otherwise requires `pnpm infra:reset -- --yes`. Deleting the volume removes Postgres metadata. S3 objects for those rows stay in the bucket.
- `pnpm dev` builds the API, CLI, and shared packages, then starts both apps with `[api]` and `[web]` logs. Ctrl+C, SIGTERM, and SIGHUP (closing the terminal) stop both. If one app exits, the command stops the other. It does not migrate or seed. The API listens on `127.0.0.1:3001` and loads `apps/api/.env`. The web app listens on `127.0.0.1:3000`. On exit it restores `apps/web/next-env.d.ts` when Next.js rewrote that file.
- `apps/api/.env.example` documents the API settings and `NEXT_PUBLIC_API_URL`. `pnpm dev` and `pnpm build` pass that origin to the web app when the process variable is unset. The production value is fixed in the client bundle. `apps/cli/.env.example` documents `FACTROVE_API_URL` and `FACTROVE_PROFILE` for `pnpm factrove`. The built CLI does not load that file, and the file does not supply an API key. `--api-url` still wins, then the process environment, then the selected profile. Database and storage variables are removed from the web and CLI process environments.
- `scripts/factrove.mjs` sets the CLI working directory from `INIT_CWD` and removes `INIT_CWD` from the child environment. The CLI resolves paths from its own working directory and ignores `INIT_CWD`, including a direct `node apps/cli/dist/main.js` run.
- `apps/api/.env.example` uses `postgresql://factrove:factrove@127.0.0.1:5432/factrove`, matching Compose. Those are local loopback credentials.

### Commands run on October 18, 2026

The run was Linux x86_64 with Docker Engine 29.1.3 and Compose 2.40.3, Node 24.16.0, and pnpm 11.25.0. It was not a Mac.

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm db:migrate
pnpm infra:down
pnpm infra:up
pnpm dev
pnpm factrove upload ./fixtures/hello.html --json
pnpm factrove upload ./fixtures/missing.html --json
pnpm factrove upload ./README.md
pnpm factrove upload /tmp/oversize.html --json
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm db:migrate` applied `20261011120000_add_identity_and_artifact` to an empty database. A second deploy reported no pending migrations. Two seeds left one `local-user` and one `local-org`. `pnpm infra:down` kept volume `factrove_factrove-postgres`. After `pnpm infra:up`, those identity rows were still there. `docker port` showed `5432/tcp -> 127.0.0.1:5432`. `pnpm infra:reset` was not executed. The runtime test asserts that only that command passes `--volumes`.

`pnpm dev` reached Nest "successfully started" and Next "Ready". `GET /api/v1/health` returned `{"status":"ok"}`. `GET /api/v1/context` returned Local User and Local Organization. Both artifact lists were empty. `http://localhost:3000/` and `http://127.0.0.1:3000/` returned 200. After restart, `ss` showed `127.0.0.1:3000`, `127.0.0.1:3001`, and `127.0.0.1:5432` only. Ctrl+C stopped the API and the web app. The web process environment contained `NEXT_PUBLIC_API_URL` and did not contain `DATABASE_URL`, `S3_*`, or `AWS_*`. The API loads those from `apps/api/.env` after start.

The CLI upload of `fixtures/hello.html` exited 1. Stderr was the pnpm `$ ` line plus `{"error":{"code":"STORAGE_UNAVAILABLE","message":"Object storage is unavailable."}}`. The API log said it could not load credentials from any providers. The artifact count stayed 0. Missing, non-HTML, and over-10-MiB uploads returned `FILE_NOT_FOUND` or `INVALID_INPUT` without creating a row. An unknown id returned `404` `ARTIFACT_NOT_FOUND` as JSON.

List semantics were checked by inserting a second user and four artifact rows into the running database, then reading the real API and clicking through the library in headless Chrome. My artifacts showed the local user's private and org_shared rows and hid the other user's rows. Organization artifacts showed both org_shared rows and hid both private rows. The page states that the labels are not access control. Opening the local org_shared viewer showed the content-load failure, with no iframe and no fixture HTML in the parent page, because the object was never stored. Those rows were deleted after the check. This was not an upload.

`pnpm test` passed: api-client 6, web 17, cli 24, api 41 passed and 4 skipped (`storage.integration` and `content.s3.integration`, which stay off unless `S3_INTEGRATION=1`), plus 7 runtime script tests. `pnpm lint`, `pnpm typecheck`, and `pnpm build` passed. The lockfile did not change.

### Not run

Task 08 owns these checks.

- Upload of `./fixtures/hello.html` through the CLI to the configured AWS bucket, the viewer URL from that response, and a refresh that shows the uploaded HTML.
- An org_shared upload appearing in both library tabs.
- Sandbox and CSP headers on a real content response, and inline script behavior inside the iframe. The web browser tests still cover the sandboxed iframe against a local content stub.
- Restart proof that AWS object bytes remain.
- `storage.integration` and `content.s3.integration` with `S3_INTEGRATION=1`.
- A macOS execution of this setup. The image pin includes linux/arm64 for Apple Silicon and linux/amd64 for Intel Macs. On macOS, `localhost` may resolve to `::1` while the API and web bind `127.0.0.1`. Task 08 confirms the browser and a Node fetch to `http://localhost:3001` still reach the API.
- The web library's unavailable-backend state against a stopped API. The web tests cover that state.

### Review follow-up, October 18, 2026

- `pnpm dev` treats SIGHUP like SIGTERM, stops the other app when one exits, and signals remaining child process groups on exit. A supervisor test sends SIGHUP and checks that both child processes are gone. Another checks that one child exiting stops the other.
- On that exit it restores `apps/web/next-env.d.ts` if Next.js rewrote the committed file. A Next.js dev process on port 3011 rewrote the file to `.next/dev/types`, and SIGHUP restored the committed text.
- `pnpm infra:reset` asks for `yes` in a terminal and refuses otherwise unless `--yes` is passed. The volume delete still does not remove S3 objects.
- The CLI no longer reads `INIT_CWD`. The launcher still applies it as the child working directory.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed again. `pnpm test` reported api-client 6, web 17, cli 24, api 41 passed and 4 skipped (`storage.integration` and `content.s3.integration`), plus 12 runtime script tests.

No product decision is blocking. Postgres 17.11, the local database password `factrove`, and binding the Next dev server to `127.0.0.1` are local runtime choices.

## Exclusions

No cloud deployment of Factrove, AWS account or bucket provisioning, production TLS setup, local S3 emulator, filesystem storage adapter, authentication, CI/CD platform, multi-host orchestration, or product features beyond upload/list/view.
