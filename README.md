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
│   │   └── context.controller.ts
│   ├── services/
│   │   ├── services.module.ts
│   │   ├── artifacts.service.ts
│   │   └── local-actor.service.ts
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
│   ├── storage/
│   │   ├── index.ts
│   │   ├── storage.module.ts
│   │   ├── blob-store.ts             # Interface and injection token
│   │   └── providers/
│   │       └── s3.provider.ts
│   └── rendering/
│       └── html-policy.ts            # HTML validation/delivery policy
└── test/
    └── database.integration.test.ts
```

Backend code is grouped by responsibility, with concrete persistence classes under `src/database/repositories/`. Prisma schema and SQL migrations live in `apps/api/prisma/`; the Nest database module and service live directly in `src/database/`. Repositories use `PrismaService`; application services coordinate repositories and storage; controllers expose those services over HTTP. Database records stay backend-local, while wire schemas live in `packages/contracts`.

`AppModule` imports `DatabaseModule` once. Its `@Global()` declaration and exported `PrismaService` and repositories make those providers injectable throughout the backend. `ApiModule` registers controllers and imports `ServicesModule`; `ServicesModule` registers application services and imports `StorageModule` for file operations. The schema-generation and seed commands are standalone entry points with their own client lifecycle.

Storage implementations belong in `storage/providers/` behind the backend-local `BlobStore` interface. Additional cloud providers can follow that convention. Database repositories use PostgreSQL directly through Prisma, without a pluggable database-provider layer. `rendering/` holds browser-content validation and delivery policy; the browser renders the artifact itself.

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

Better Auth connects to PostgreSQL through its official Prisma adapter: `database: prismaAdapter(prisma, { provider: "postgresql" })`, with `organization()` configured for organization models. This configuration lives in the backend and uses its Prisma setup. Better Auth tooling generates the identity schema; Prisma Migrate manages the committed SQL migrations. See the [installation guide](https://better-auth.com/docs/installation) and [Prisma adapter guide](https://better-auth.com/docs/adapters/prisma).

Object storage is another backend-local module. Its S3 implementation uses the configured AWS bucket and region. The small provider interface accommodates future Azure/GCP implementations. The backend owns database and storage configuration.

Uploaded HTML is rendered by the browser in an isolated viewer. The backend's rendering responsibility is content validation and delivery policy.

## Local setup

This checkout runs the local upload, library, and viewer loop. PostgreSQL runs in Docker and keeps metadata in a named volume. Artifact bytes go to an existing AWS S3 bucket. The web app and CLI receive HTTP origins. Database and storage credentials stay in the API environment.

`private` and `org_shared` choose which library list an artifact appears in. This build is unauthenticated: those labels are list classifications, and opening an artifact URL does not check membership. Login, API keys, and managed hosting are later work described in the [MVP end state](docs/MVP_END_STATE.md).

### Prerequisites

- Node.js 24.16.0, pinned in [.nvmrc](.nvmrc) and [.node-version](.node-version).
- pnpm 11.25.0, pinned by `packageManager` in [package.json](package.json).
- Docker Desktop on Apple Silicon or Intel Mac, or another runtime that provides Docker Compose v2 (`docker compose`). OrbStack and Colima qualify when they provide that command. Start the runtime before `pnpm infra:up`.

The Postgres image is pinned to the official `postgres:17.11` multi-arch index, so the Mac's architecture selects its own build. Host port `5432` is bound to `127.0.0.1`.

### Environment

```sh
cp apps/api/.env.example apps/api/.env
cp .env.example .env
```

Edit `apps/api/.env` before uploading:

- `DATABASE_URL` already matches the Compose database `factrove` on `127.0.0.1:5432`, user `factrove`, password `factrove`.
- Set `S3_BUCKET` and `S3_REGION` to the existing bucket. Factrove does not create the bucket and does not run an S3 service.
- Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` together, with `AWS_SESSION_TOKEN` when the key is temporary. Leave those unset to use `AWS_PROFILE` or the default AWS credential chain.
- The API calls need `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on the object ARN, and `s3:ListBucket` on the bucket ARN.

The root `.env` holds `NEXT_PUBLIC_API_URL` and `FACTROVE_API_URL`. Both default to `http://localhost:3001`. `--api-url` overrides `FACTROVE_API_URL` for one CLI command.

### Start, stop, and upload

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm infra:up` starts PostgreSQL and waits until it accepts connections. `pnpm db:migrate` applies the committed migrations. `pnpm db:seed` upserts the local user `local-user` (Local User) and organization `local-org` (Local Organization). Run seed again whenever you want; it keeps those ids and does not wipe artifacts. Neither migrate nor seed runs from API startup.

`pnpm dev` builds the API, CLI, and shared packages, then starts the API on `http://127.0.0.1:3001` and the web app on `http://127.0.0.1:3000`. Open the library at `http://localhost:3000`. Logs from both are prefixed `[api]` and `[web]`. Ctrl+C, SIGTERM, and closing the terminal stop both. If one app exits, the command stops the other. Restart `pnpm dev` after API changes. The Next.js app reloads as web files change. While it is running, Next.js may rewrite `apps/web/next-env.d.ts`. The command restores the committed copy when it exits.

In a second terminal, from the repository root:

```sh
pnpm factrove upload ./fixtures/hello.html
pnpm factrove upload ./fixtures/hello.html --access org_shared --json
pnpm factrove upload ./report.html --api-url http://localhost:3001 --json
pnpm factrove upload --help
```

Open `http://localhost:3000`, choose My artifacts or Organization artifacts, and use Refresh after an upload. Plain CLI success prints only the viewer URL. `--json` prints the `{ artifact }` envelope on one line. Failures go to stderr and the process exits nonzero. pnpm prints the script line it runs to stderr, prefixed with `$ `. A relative upload path uses the CLI process directory. `pnpm factrove` sets that directory to the one where you ran `pnpm`. Direct `node apps/cli/dist/main.js` uses its own directory and ignores `INIT_CWD`.

`pnpm infra:down` stops PostgreSQL and keeps the data volume. `pnpm infra:reset` stops it and deletes that volume. In a terminal it asks you to type `yes`. From a non-interactive shell, confirm with `pnpm infra:reset -- --yes`. Reset is the only command that drops local metadata. It does not delete S3 objects: bytes for the removed artifact rows stay in the bucket.

Workspace checks:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm --filter @factrove/web dev` and `pnpm --filter @factrove/api dev` still start one app at a time. `pnpm dev` is the command that runs them together.

## Troubleshooting

- **Container runtime unavailable.** `pnpm infra:up` exits when `docker` is missing or the daemon is stopped. Start Docker Desktop and run `pnpm infra:up` again.
- **Port 5432 is taken.** Another PostgreSQL is listening on `127.0.0.1:5432`. Stop it, or change the host port in [compose.yaml](compose.yaml) and `DATABASE_URL` together.
- **Port 3000 or 3001 is taken.** Stop the other process and run `pnpm dev` again. The web origin is `http://localhost:3000` and the API origin is `http://localhost:3001`.
- **The API stops and asks for a seed.** `LOCAL_USER_ID` or `LOCAL_ORGANIZATION_ID` has no matching row. Run `pnpm db:seed`, then `pnpm dev`.
- **Upload returns `STORAGE_UNAVAILABLE`.** The bucket name, region, or credentials cannot write the object. Check `S3_BUCKET`, `S3_REGION`, and the AWS credential chain in `apps/api/.env`. A failed upload leaves no artifact row. `S3_BUCKET=your-bucket` is the placeholder from the example file.
- **The CLI reports `NETWORK_ERROR`.** The API origin is wrong or `pnpm dev` is not running. Precedence is `--api-url`, then `FACTROVE_API_URL`, then `http://localhost:3001`.
- **The library says the API is unavailable.** The web app is using a different origin from the running API. Set `NEXT_PUBLIC_API_URL` in the root `.env` or the environment, then restart `pnpm dev`.

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
