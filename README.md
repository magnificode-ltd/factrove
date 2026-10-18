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

## Development

Runtime versions are pinned in [.nvmrc](.nvmrc), [.node-version](.node-version), and [pnpm-workspace.yaml](pnpm-workspace.yaml). The package-manager version and workspace commands are recorded in [package.json](package.json).

With the pinned Node and pnpm versions available:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

The build follows workspace dependency order. Shared packages expose compiled modules and declarations from `dist/`.

After building, application-level commands are:

```sh
pnpm --filter @factrove/web dev
pnpm --filter @factrove/api dev
pnpm factrove upload ./fixtures/hello.html
```

The web development command uses Next.js dev mode. The API development command currently compiles once and starts Node. `pnpm factrove` runs the upload CLI against the HTTP API. The CLI only needs the API origin.

```sh
pnpm factrove upload ./fixtures/hello.html
pnpm factrove upload ./report.html --access org_shared --json
pnpm factrove upload ./report.html --api-url http://localhost:3001 --json
pnpm factrove upload --help
```

The API origin comes from `--api-url`, then `FACTROVE_API_URL`, then `http://localhost:3001`. Access defaults to `private`. Plain success prints only the viewer URL. `--json` prints the `{ artifact }` response envelope on one line. Failures go to stderr and the process exits nonzero. pnpm prints the script command it runs to stderr; the CLI leaves stdout free of Nest startup logs. Application feature coverage and local-stack setup progress are tracked in the PRDs.

## Database changes

The persistence convention is a committed Prisma SQL migration history under `apps/api/prisma/migrations/`. Both schema changes (DDL) and data transformations (DML) belong in that history. The selected SQL migration workflow applies releases with `prisma migrate deploy`.

Applied migrations remain immutable; subsequent changes receive new migrations. Changes that require data conversion can use expansion, a DML backfill, an application cutover, and contraction across compatible releases. Local demo fixtures are populated by an explicit idempotent seed.

## Documentation

- [MVP end state](docs/MVP_END_STATE.md): the agreed product target, models, behavior, and completion criteria.
- [Implementation task index](prd/README.md): task status, dependencies, and ownership.
- [Shared MVP contract](prd/mvp_contract.md): API, package interfaces, and local configuration.
- [Agent orientation](AGENTS.md): a concise guide to the codebase and its documentation.
