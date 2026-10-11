# Codebase orientation

Factrove is a TypeScript pnpm monorepo for a self-hostable artifact library.

## Applications and packages

- `apps/web`: Next.js App Router frontend.
- `apps/api`: NestJS HTTP API; controllers, services, PostgreSQL/Prisma persistence, and object storage live here.
- `apps/cli`: standalone NestJS CLI that calls the API.
- `packages/contracts`: shared runtime schemas and TypeScript API types.
- `packages/api-client`: framework-neutral HTTP client consumed by web and CLI.

The backend owns database and storage access. Its database module is global within NestJS. Shared packages are linked through pnpm workspaces and expose compiled exports.

User and Organization are Better Auth identity models (core and organization plugin). Artifact is Factrove's custom domain model and references those identities.

## Documentation map

Documentation follows these roles: README.md provides long-term codebase documentation; PRDs capture MVP scope, implementation tasks, and progress. AGENTS.md provides general orientation about the codebase, using descriptive guidance. Task-specific constraints and exclusions belong in the relevant PRD, keeping this file focused on helping agents understand the project.

- [README.md](README.md) explains the repository, architecture, and development commands.
- [docs/MVP_END_STATE.md](docs/MVP_END_STATE.md) is the agreed MVP north star, including the data model and observable completion criteria.
- [prd/README.md](prd/README.md) tracks implementation tasks, dependencies, and ownership.
- [prd/mvp_contract.md](prd/mvp_contract.md) defines the shared HTTP and package contracts.
- [prd/mvp/done/](prd/mvp/done/) contains completed task briefs and handoff notes.

## Tooling

Node and pnpm pins live in `.nvmrc`, `.node-version`, `package.json`, and `pnpm-workspace.yaml`. Common checks are `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`. PostgreSQL schema and data changes use committed Prisma SQL migrations.

## Cursor Cloud specific instructions

Node 24.16.0 is installed at `/usr/local/bin/node`, and pnpm 11.25.0 is activated with Corepack. Agent shells can resolve `node` to an older binary that appears earlier on `PATH`. Export `PATH="/usr/local/bin:$PATH"` before `pnpm`, `node`, or app commands so engine checks use the pinned runtime.

On boot, the API scaffold listens on `127.0.0.1:3001` and the Next.js dev server listens on port 3000. A Nest `404` for `GET /` is the empty API scaffold. The web page is the Factrove scaffold at `/`. Run `pnpm --filter @factrove/cli start` for the CLI; the compiled process exits immediately with no product command yet. Root `dev`, `infra:up`, `infra:down`, `db:migrate`, and `db:seed` are pending stubs. PostgreSQL and object storage are not part of this baseline.
