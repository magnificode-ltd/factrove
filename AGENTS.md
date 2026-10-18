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

- [README.md](README.md) explains the repository, architecture, and development commands. Its [backend directory structure](README.md#backend-directory-structure) is the canonical layout referenced by implementation PRDs.
- [docs/MVP_END_STATE.md](docs/MVP_END_STATE.md) is the agreed MVP north star, including the data model and observable completion criteria.
- [prd/README.md](prd/README.md) tracks implementation tasks, dependencies, and ownership.
- [prd/mvp_contract.md](prd/mvp_contract.md) defines the shared HTTP and package contracts.
- [prd/mvp/done/](prd/mvp/done/) contains completed task briefs and handoff notes.

## CLI

When the CLI interface is in doubt, follow the AWS S3 CLI (`aws s3`): command names, argument order, flag names, and output style. The current commands are `upload` and `get`. `get <id>` writes the artifact to stdout, in the same role as `aws s3 cp s3://bucket/key -`.

## Tooling

Node and pnpm pins live in `.nvmrc`, `.node-version`, `package.json`, and `pnpm-workspace.yaml`. Common checks are `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`. PostgreSQL schema and data changes use committed Prisma SQL migrations.

## Rules

File location is a convention. Never store the location of a file in the database. Do not add a column, field, or persisted value for an object key, storage path, or file location. The artifact storage key is `{artifactId}.html`, derived from the artifact id.

When adding an environment variable, add that key to the committed `.env.example` with a placeholder value. Do not commit real secrets.
