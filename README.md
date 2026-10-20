# Factrove

Factrove is a self-hostable home for artifacts created by people and agents. Its web application organizes artifacts, while its command-line client publishes files and returns links.

This repository contains the product: frontend, backend, CLI, and shared packages. It is private initially and intended for a future open-source release. A separate `factrove-cloud` repository is planned for proprietary managed-hosting capabilities.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router frontend |
| `apps/api` | NestJS HTTP backend |
| `apps/cli` | Standalone NestJS command-line application |
| `packages/contracts` | Zod schemas and TypeScript types for the HTTP API |
| `packages/api-client` | Framework-neutral HTTP client used by web and CLI |
| `fixtures` | Sample files for development and verification |
| `scripts` | Repository tooling |
| `docs` | Product and architecture documentation |
| `prd` | Implementation briefs, contracts, task ownership, and progress |
| `prd/mvp/done` | Completed MVP task briefs and verification records |

### Backend directory structure

This is the canonical backend layout for implementation PRDs. The directory boundaries and the locations of the database module, repositories, Prisma schema, and migrations are intentional. Feature filenames illustrate the convention; add files in the corresponding responsibility directory as features grow. This describes the target structure, not a claim that every file is already implemented.

```text
apps/api/
├── auth-schema.config.ts             # Better Auth schema-generation configuration
├── prisma/
│   ├── schema.prisma                 # Better Auth identities and Artifact
│   └── migrations/
│       ├── migration_lock.toml
│       └── <timestamp>_<description>/
│           └── migration.sql         # Committed DDL and DML
├── src/
│   ├── main.ts
│   ├── app.module.ts                 # Application composition
│   ├── controllers/
│   │   ├── api.module.ts
│   │   ├── artifacts.controller.ts
│   │   ├── public-artifacts.controller.ts
│   │   └── context.controller.ts
│   ├── services/
│   │   ├── services.module.ts
│   │   ├── artifacts.service.ts
│   │   └── api-config.ts
│   ├── auth/
│   │   ├── create-auth.ts            # Email/password sessions and the API key plugin
│   │   ├── api-key-plugin.ts         # @better-auth/api-key options
│   │   └── actor.service.ts          # Session or API-key caller
│   ├── database/
│   │   ├── index.ts                  # Public backend database exports
│   │   ├── database.module.ts        # Global Nest module
│   │   ├── prisma.service.ts         # Prisma client and connection lifecycle
│   │   ├── repositories/
│   │   │   └── artifacts.repository.ts
│   │   ├── seed/
│   │   │   ├── seed.ts               # Explicit seed entry point
│   │   │   └── seed-local-identities.ts
│   │   └── types/
│   │       └── artifact-record.ts    # Internal persistence records/inputs
│   ├── sharing/
│   │   ├── share-link.ts             # Public base URL, share token, and link builders
│   │   ├── public-origin.ts          # Browser origins for CORS and frame-ancestors
│   │   └── public-view-limit.ts      # Public view rate limit
│   ├── storage/
│   │   ├── index.ts
│   │   ├── storage.module.ts
│   │   ├── blob-store.ts             # Interface and injection token
│   │   └── providers/
│   │       └── s3.provider.ts
│   └── rendering/
│       ├── html-policy.ts            # HTML validation/delivery policy
│       ├── html-to-markdown.ts       # Linear HTML to Markdown conversion
│       ├── html-to-markdown.worker.ts
│       └── convert-html-to-markdown.ts # Bounded worker pool for Markdown conversion
└── test/
    └── database.integration.test.ts
```

Backend code is grouped by responsibility, with concrete persistence classes under `src/database/repositories/`. Prisma schema and SQL migrations live in `apps/api/prisma/`; the Nest database module and service live directly in `src/database/`. Repositories use `PrismaService`; application services coordinate repositories and storage; controllers expose those services over HTTP. Database records stay backend-local, while wire schemas live in `packages/contracts`.

`AppModule` imports `DatabaseModule` once. Its `@Global()` declaration and exported `PrismaService` and repositories make those providers injectable throughout the backend. `ApiModule` registers controllers and imports `ServicesModule`; `ServicesModule` registers application services and imports `StorageModule` for file operations. The schema-generation and seed commands are standalone entry points with their own client lifecycle.

Storage implementations belong in `storage/providers/` behind the backend-local `BlobStore` interface. Additional cloud providers can follow that convention. Database repositories use PostgreSQL directly through Prisma, without a pluggable database-provider layer. `rendering/` holds browser-content validation and delivery policy. The browser renders the artifact itself. Markdown conversion runs in a worker thread with time, memory, and output limits.

## Architecture

Factrove is a TypeScript pnpm workspace with three applications and two shared packages. Internal dependencies use `workspace:*`; a single lockfile records dependency resolution.

```text
Next.js web ──┐
             ├── shared HTTP client → NestJS API → PostgreSQL metadata
NestJS CLI ──┘                                 → object storage
```

The web application and CLI communicate with the backend over HTTP. The shared contracts describe requests, responses, and errors. The HTTP client works in browser and Node runtimes; the CLI registers it as a Nest provider.

Backend code is organized by responsibility: controllers handle HTTP, services coordinate behavior, and repositories handle persistence. The database design uses PostgreSQL with Prisma and a backend-local global NestJS `DatabaseModule`. Concrete repositories encapsulate queries and transactions.

Identity models come from Better Auth: its core schema provides User, and its organization plugin provides Organization and membership-related models. Artifact references those identities directly. Better Auth schema generation and committed Prisma migrations maintain these definitions; Factrove's custom domain model is Artifact. Schema ownership is separate from when authentication flows are enabled, which is specified in the PRDs.

Better Auth connects to PostgreSQL through its official Prisma adapter: `database: prismaAdapter(prisma, { provider: "postgresql" })`, with `organization()` configured for organization models and `@better-auth/api-key` for API keys. This configuration lives in the backend and uses its Prisma setup. Better Auth tooling generates the identity schema; Prisma Migrate manages the committed SQL migrations. See the [installation guide](https://better-auth.com/docs/installation), the [Prisma adapter guide](https://better-auth.com/docs/adapters/prisma), and the [API key plugin](https://better-auth.com/docs/plugins/api-key).

Object storage is another backend-local module. Its S3 implementation uses the configured bucket and region, and `S3_ENDPOINT` when that variable selects an S3-compatible service. The small provider interface accommodates future Azure/GCP implementations. The backend owns database and storage configuration.

Uploaded HTML is rendered by the browser in an isolated viewer. The backend's rendering responsibility is content validation, delivery policy, and converting stored HTML to Markdown when a client asks for that format. Markdown is not stored.

## Local setup

This checkout runs the local upload, library, and viewer loop. PostgreSQL runs in Docker and keeps metadata in a named volume. Artifact bytes go to Garage, the local S3-compatible server started with it. Real AWS S3 stays available: set the bucket, region, and credentials, and leave `S3_ENDPOINT` unset. The API and the web app share one environment file. The CLI reads its own environment file, process variables, and `~/.factrove` profile files. Database and storage credentials stay in the application environment.

Sign in at `http://localhost:3000/signup` or `/login`. Private artifacts are readable only by their owner. Organization-shared artifacts are readable by members of the artifact's organization. A public link works only after the owner shares the artifact. Anyone with that link can open it without an account. The CLI sends an API key from `FACTROVE_API_KEY` or from `factrove configure`. Create and revoke keys at `/account/api-keys`. The secret is shown once.

`PUBLIC_BASE_URL` is the origin used for viewer URLs and public share links. When it is unset, those links use `WEB_ORIGIN`. `http://localhost:3000` keeps every link on localhost. `https://factrove.app` uses that domain plus the artifact id. The same value is the source for later embeds. It does not start a server or publish the app. CORS and `frame-ancestors` follow that origin and `WEB_ORIGIN`.

### Prerequisites

- Node.js 24.16.0, pinned in [.nvmrc](.nvmrc) and [.node-version](.node-version).
- pnpm 11.25.0, pinned by `packageManager` in [package.json](package.json).
- Docker Desktop on Apple Silicon or Intel Mac, or another runtime that provides Docker Compose v2 (`docker compose`). OrbStack and Colima qualify when they provide that command. Start the runtime before `pnpm infra:up`.
- Playwright's Chromium build, for `pnpm e2e`:

```sh
pnpm --filter @factrove/web exec playwright install chromium
```

On Linux, Chromium also needs its system libraries. `pnpm --filter @factrove/web exec playwright install-deps chromium` installs them and may need root.

The Postgres image is pinned to the official `postgres:17.11` multi-arch index, so the Mac's architecture selects its own build. Host port `5432` is bound to `127.0.0.1`. Garage `v2.3.0` is pinned the same way. Its S3 API is bound to `127.0.0.1:3900`, and it creates the `factrove` bucket on startup.

### Environment

```sh
cp apps/api/.env.example apps/api/.env
cp apps/cli/.env.example apps/cli/.env
```

`apps/api/.env` is the application environment. The API loads it on startup and keeps variables that are already set. `pnpm dev` reads `NEXT_PUBLIC_API_URL` from that file and passes it to the web app when the variable is unset. `pnpm build` and `next build` read the same value when it is unset and Next.js fixes it in the client bundle. `next start` cannot change that origin, so run the build again after changing it. Only `NEXT_PUBLIC_API_URL` is copied from that file. Database, storage, and auth-secret settings stay on the API process.

`apps/cli/.env` is read by `pnpm factrove` for local development. `node apps/cli/dist/main.js` does not read it. The file may set `FACTROVE_API_URL` and `FACTROVE_PROFILE` when those variables are unset. It does not set an API key. `FACTROVE_CLI_ENV_FILE` selects a different file. That name is read from the process environment, and the file itself cannot set it. The example leaves `FACTROVE_API_URL` commented because the built-in default is already `http://localhost:3001`. Omit the file and the CLI still uses that default.

Edit `apps/api/.env` before uploading:

- `DATABASE_URL` already matches the Compose database `factrove` on `127.0.0.1:5432`, user `factrove`, password `factrove`.
- `S3_BUCKET=factrove`, `S3_REGION=us-east-1`, `S3_ENDPOINT=http://127.0.0.1:3900`, and `S3_FORCE_PATH_STYLE=true` match Garage. The access key `factrove-local` and secret `factrove-local-secret` are local credentials from [compose.yaml](compose.yaml). `pnpm infra:up` creates the bucket. A plain `http://` `S3_ENDPOINT` is accepted for `localhost`, `127.0.0.1`, and `::1`. Any other host needs `https://`.
- For an existing AWS bucket, set `S3_BUCKET` and `S3_REGION`, remove `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`, and set `AWS_ACCESS_KEY_ID` with `AWS_SECRET_ACCESS_KEY` (and `AWS_SESSION_TOKEN` for a temporary key). Leave that pair unset to use `AWS_PROFILE` or the default credential chain. With `S3_ENDPOINT` unset, the API calls AWS in `S3_REGION` and ignores `AWS_ENDPOINT_URL`. It does not create the AWS bucket.
- AWS calls need `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on the object ARN, and `s3:ListBucket` on the bucket ARN.

`NEXT_PUBLIC_API_URL` in `apps/api/.env` is the origin the browser uses for the API. It defaults to `http://localhost:3001`. A production bundle keeps the origin from the build.

CLI resolution follows the AWS CLI: flags, then environment variables, then profile files. `--api-url` overrides the API origin for one command. Then `FACTROVE_API_URL` from the process environment. Then the selected profile's `api_url` in `~/.factrove/config`. `pnpm factrove` uses a URL from `apps/cli/.env` only when both of those are unset. The built-in default is `http://localhost:3001`. `FACTROVE_API_KEY` supplies the key when `--profile` is omitted. An explicit `--profile` uses that profile's `factrove_api_key` in `~/.factrove/credentials` and ignores `FACTROVE_API_KEY`. `factrove configure` writes those files mode 0600. `apps/cli/.env` does not supply a key. `FACTROVE_PROFILE` selects a profile when `--profile` is omitted, and `pnpm factrove` can fill that name from `apps/cli/.env` when the variable is unset. The API key is not printed.

The session cookie is for the API host. On localhost that cookie is sent to both ports. When the web app and API use different hosts, set `AUTH_COOKIE_DOMAIN` in `apps/api/.env` to the narrowest parent of both, such as `factrove.example.com` for `app.factrove.example.com` and `api.factrove.example.com`. The browser sends that cookie to every subdomain of the value. Startup rejects an IP address, a public suffix, and a domain that does not cover both origins. Set `TRUSTED_PROXIES` to the IP addresses or CIDR ranges of reverse proxies that may send `X-Forwarded-For`. Leave it unset when the API sees the client socket directly. Sign-in limits follow that client address, and an incoming `X-Forwarded-For` from an untrusted peer does not choose the bucket.

### Start, stop, and upload

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm infra:up` starts PostgreSQL and Garage and waits until both are healthy. Garage creates the `factrove` bucket when it starts. `pnpm db:migrate` applies the committed migrations. `pnpm db:seed` upserts the fixture user `local-user` (Local User) and organization `local-org` (Local Organization). That user has no password. Run seed again whenever you want; it keeps those ids and does not wipe artifacts. Neither migrate nor seed runs from API startup. Set `BETTER_AUTH_SECRET` in `apps/api/.env` before `pnpm dev`. Use at least 32 characters. The example value is a local placeholder.

An installation that already has artifacts owned by `local-user` keeps those rows and their ids through migrate. Sign up in the web app, then attach them to that account:

```sh
pnpm db:claim-local-artifacts -- --email you@example.com
```

The command changes the creator of those artifacts to the account and adds a membership for each organization they already reference. Viewer links stay `/artifacts/{id}`. Running it again changes nothing. It does not create a password for `local-user`.

`pnpm dev` builds the API, CLI, and shared packages, then starts the API on `http://127.0.0.1:3001` and the web app on `http://127.0.0.1:3000`. Open the library at `http://localhost:3000`. Logs from both are prefixed `[api]` and `[web]`. Ctrl+C, SIGTERM, and closing the terminal stop both. If one app exits, the command stops the other. Restart `pnpm dev` after API changes. The Next.js app reloads as web files change. While it is running, Next.js may rewrite `apps/web/next-env.d.ts`. The command restores the committed copy when it exits.

In a second terminal, from the repository root:

```sh
pnpm factrove configure
pnpm factrove upload ./fixtures/hello.html
pnpm factrove upload ./fixtures/hello.html --access org_shared --json
pnpm factrove upload ./report.html --api-url http://localhost:3001 --json
pnpm factrove upload --help
pnpm factrove get <artifact-id>
pnpm factrove get <artifact-id> --format markdown
pnpm factrove get <artifact-id> --format markdown --json
pnpm factrove share <artifact-id>
pnpm factrove share <artifact-id> --revoke
```

Open `http://localhost:3000`, choose My artifacts or Organization artifacts, and use Refresh after an upload. Plain CLI success prints only the viewer URL. `--json` prints the `{ artifact }` envelope on one line. Failures go to stderr and the process exits nonzero. pnpm prints the script line it runs to stderr, prefixed with `$ `. A relative upload path uses the CLI process directory. `pnpm factrove` sets that directory to the one where you ran `pnpm`. Direct `node apps/cli/dist/main.js` uses its own directory and ignores `INIT_CWD`.

`pnpm factrove get <id>` prints that artifact's content. The default format is HTML, the same bytes stored for the artifact. `--format markdown` asks the API to convert that stored HTML on the way out; Markdown is not saved. Plain get success prints the content and nothing else. `--json` prints one line with `format`, `mediaType`, and `content`.

`pnpm factrove share <id>` creates a public link, or prints the existing one. Plain success prints that URL. `--revoke` removes it and prints a confirmation that does not include the token. `--json` prints `{ share: { shared, shareUrl } }`. The owner can also use Share in the library or the viewer. Copy link copies the public URL while a share is on, and the private viewer URL otherwise.

When in doubt, follow aws s3 conventions; existing upload/get/--json kept for now, cp/--output json are follow-ups. `get <id>` writes to stdout the way `aws s3 cp s3://bucket/key -` streams an object to stdout.

`pnpm infra:down` stops PostgreSQL and Garage and keeps their data volumes. `pnpm infra:reset` stops the dev Compose project and deletes its PostgreSQL and Garage volumes. In a terminal it asks you to type `yes`. From a non-interactive shell, confirm with `pnpm infra:reset -- --yes`. That removes local metadata and local object bytes for the dev project. Objects in a real AWS bucket are outside these volumes and stay there. `pnpm e2e` deletes volumes only for its own Compose project, `factrove-e2e`.

Workspace checks:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
```

`pnpm e2e` checks that Docker is running and that Playwright Chromium is installed, builds the API and CLI, then starts Compose project `factrove-e2e`. That project has its own volumes. PostgreSQL is published on `127.0.0.1:5433`, Garage on `127.0.0.1:3910`, the web app on `127.0.0.1:3100`, and the API on `127.0.0.1:3101`. The dev project from `pnpm infra:up` keeps its volumes and ports. The script sets the Garage endpoint and credentials for the API and the S3 integration tests, removes `AWS_*` and `S3_*` overrides from those processes, and requires the effective endpoint to be loopback HTTP before any S3 call. `S3_INTEGRATION=1` does the same inside the integration tests. The default `pnpm test` still skips those files unless `S3_INTEGRATION=1`. When `pnpm e2e` exits, it restores `apps/web/next-env.d.ts` if Next.js rewrote it and removes the `factrove-e2e` project.

`pnpm --filter @factrove/web dev` and `pnpm --filter @factrove/api dev` still start one app at a time. `pnpm dev` is the command that runs them together.

## Troubleshooting

- **Container runtime unavailable.** `pnpm infra:up` exits when `docker` is missing or the daemon is stopped. Start Docker Desktop and run `pnpm infra:up` again.
- **Port 5432 is taken.** Another PostgreSQL is listening on `127.0.0.1:5432`. Stop it, or change the host port in [compose.yaml](compose.yaml) and `DATABASE_URL` together.
- **Port 3900 is taken.** Another process is listening on `127.0.0.1:3900`. Stop it, or change the Garage host port in [compose.yaml](compose.yaml) and `S3_ENDPOINT` together.
- **Port 3000 or 3001 is taken.** Stop the other process and run `pnpm dev` again. The web origin is `http://localhost:3000` and the API origin is `http://localhost:3001`.
- **`pnpm e2e` reports a taken port.** That command uses `127.0.0.1:5433` for PostgreSQL, `127.0.0.1:3910` for Garage, `127.0.0.1:3100` for the web app, and `127.0.0.1:3101` for the API. Stop the other process and run `pnpm e2e` again. The dev ports 5432, 3900, 3000, and 3001 stay with `pnpm infra:up` and `pnpm dev`.
- **The API stops on `BETTER_AUTH_SECRET`.** The value is missing or shorter than 32 characters. Set a local placeholder in `apps/api/.env`, then run `pnpm dev`.
- **Upload returns `STORAGE_UNAVAILABLE`.** The API could not write the object, and the failed upload leaves no artifact row. For Garage, run `pnpm infra:up` and match `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, and the access key in `apps/api/.env` to [compose.yaml](compose.yaml). For AWS, set `S3_BUCKET`, `S3_REGION`, and the credential chain, and leave `S3_ENDPOINT` unset. `S3_BUCKET=your-bucket` is an old placeholder.
- **The CLI reports `NETWORK_ERROR`.** The API origin is wrong or `pnpm dev` is not running. Precedence is `--api-url`, then `FACTROVE_API_URL`, then the selected profile's `api_url`, then a URL from `apps/cli/.env` when you use `pnpm factrove`, then `http://localhost:3001`.
- **The library says the API is unavailable.** The web app is using a different origin from the running API. Set `NEXT_PUBLIC_API_URL` in `apps/api/.env` or the environment, then restart `pnpm dev`. A production bundle keeps the origin from the build, so run `pnpm build` again after changing it.

## Development

Runtime versions are pinned in [.nvmrc](.nvmrc), [.node-version](.node-version), and [pnpm-workspace.yaml](pnpm-workspace.yaml). The package-manager version and workspace commands are recorded in [package.json](package.json).

The build follows workspace dependency order. Shared packages expose compiled modules and declarations from `dist/`. `pnpm factrove` runs the compiled CLI. When `apps/cli/dist` is missing it tells you to run `pnpm --filter @factrove/cli build`. `pnpm dev` performs that build before starting the servers.

## Database changes

The persistence convention is a committed Prisma SQL migration history under `apps/api/prisma/migrations/`. Both schema changes (DDL) and data transformations (DML) belong in that history. The selected SQL migration workflow applies releases with `prisma migrate deploy`.

Applied migrations remain immutable; subsequent changes receive new migrations. Changes that require data conversion can use expansion, a DML backfill, an application cutover, and contraction across compatible releases. Local demo fixtures are populated by an explicit idempotent seed.

## Documentation

- [MVP end state](docs/MVP_END_STATE.md): the agreed product target, models, behavior, and completion criteria.
- [Implementation task index](prd/README.md): task status, dependencies, and ownership.
- [Shared MVP contract](prd/mvp_contract.md): API, package interfaces, and local configuration.
- [Agent orientation](AGENTS.md): a concise guide to the codebase and its documentation.
