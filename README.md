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

Object storage is another backend-local module. Its small provider interface separates file operations from the S3 implementation and accommodates future Azure/GCP implementations. The backend owns database and storage configuration.

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
pnpm --filter @factrove/cli start
```

The web development command uses Next.js dev mode. The API development command currently compiles once and starts Node. The CLI starts a standalone Nest context and exits when its work is complete. Application feature coverage and local-stack setup progress are tracked in the PRDs.

## Database changes

The persistence convention is a committed Prisma SQL migration history under `apps/api/prisma/migrations/`. Both schema changes (DDL) and data transformations (DML) belong in that history. The selected SQL migration workflow applies releases with `prisma migrate deploy`.

Applied migrations remain immutable; subsequent changes receive new migrations. Changes that require data conversion can use expansion, a DML backfill, an application cutover, and contraction across compatible releases. Local demo fixtures are populated by an explicit idempotent seed.

## Documentation

- [MVP end state](docs/MVP_END_STATE.md): the agreed product target, models, behavior, and completion criteria.
- [Implementation task index](prd/README.md): task status, dependencies, and ownership.
- [Shared MVP contract](prd/mvp_contract.md): API, package interfaces, and local configuration.
- [Agent orientation](AGENTS.md): a concise guide to the codebase and its documentation.
