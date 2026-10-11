# Task 02 — PostgreSQL schema, migrations, and repositories

## Goal

Persist Artifact using Better Auth's User and Organization identities, and provide the repository methods the API needs. The MVP remains unauthenticated at runtime; identity schema reuse is part of this database task.

Read [the MVP end state](../../../docs/MVP_END_STATE.md), [the project README](../../../README.md) and [the shared MVP contract](../../mvp_contract.md). **Status: done — October 11, 2026.** Depends on task 01's baseline.

## Owns

Follow the [canonical README backend directory structure](../../../README.md#backend-directory-structure): repositories in `src/database/repositories/`, record/input types in `src/database/types/`, module/service/seed files directly in `src/database/`, and schema/migrations in `apps/api/prisma/`. Directory placement is part of acceptance.

apps/api/prisma/**, apps/api/src/database/**, a backend-local schema-generation configuration such as apps/api/auth-schema.config.ts, and database integration tests. Coordinate pinned Better Auth/generator dependencies and API manifest changes with task 04; task 07 owns final setup/lockfile integration.

## Deliverables

- Configure Better Auth with its official Prisma adapter: `database: prismaAdapter(prisma, { provider: "postgresql" })`, and `plugins: [organization()]`. Keep this configuration backend-local and reuse the backend's Prisma setup; web/CLI do not own Better Auth database configuration. Pin compatible Better Auth, adapter, and schema-generator dependencies. The workspace currently pins Prisma 6.19.0; follow the documentation for the chosen compatible versions rather than copying Prisma 7-specific setup or upgrading Prisma implicitly.
- Generate the Prisma identity schema from a pinned Better Auth configuration with its organization plugin. User and Organization are Better Auth's models, not independently designed Factrove models or temporary tables for a later identity migration. Keep the generator configuration/command reproducible and backend-local.
- Retain the supporting models required by that generated configuration, including core session/account/verification and organization member/invitation models. These are library-owned schema, not additional Factrove product concepts. There is no requirement for exactly three physical tables.
- Add Factrove's Artifact model as defined in docs/MVP_END_STATE.md, referencing the generated User and Organization models directly, using the persistence interfaces in the shared contract. Preserve adapter-compatible identity model/field mappings.
- Commit an initial Prisma SQL migration with foreign keys, access values, the org_shared organization check, and list indexes. The storage key is `{artifactId}.html` and is not a column. The original filename is not a column.
- Do not add custom content, usage, upload-operation, sharing, or token tables. Do not enforce one organization per user; in particular, member.userId must not be globally unique. Generated pair-level membership constraints are a separate concern.
- Add an explicit, idempotent seed into the actual Better Auth user/organization tables, including their required fields, for the configured local identities. No credentials or sessions are needed. Do not put demo data into ordinary application startup.
- Use Better Auth tooling to generate schema only; create/review/commit SQL with Prisma Migrate. Keep auth routes, session/key checks, and runtime membership enforcement deferred. The schema-generation configuration is not mounted as a live auth server in the MVP.
- Export a global DatabaseModule with PrismaService and a concrete ArtifactsRepository implementing the agreed method signatures.
- Repository operations are create, update, delete, findById, and list. uploaded_at is an ordinary nullable column, not a pending-upload workflow.
- Keep organization_id captured on Artifact; never derive it from a creator's later affiliation.
- Keep all schema and production data transformations in committed migrations. No db push or separate backfill scripts/folder.
- Make UTC timestamps and deterministic ordering match the HTTP contract.
- Choose explicit FK deletion behavior; no cascading destruction of artifacts through a future identity deletion by accident.

## Acceptance

Against real PostgreSQL:

- Apply migrations to an empty database; a second deploy has no pending changes.
- Run the documented schema-generation command against the backend-local Better Auth configuration and confirm it uses the Prisma adapter with PostgreSQL and the organization plugin. Schema generation is separate from applying migrations and does not require mounting auth endpoints.
- Verify the identity schema against the pinned Better Auth core + organization configuration, including required supporting models/fields and mappings. Confirm Artifact FKs reference these same identities, with no duplicate custom User/Organization tables.
- Confirm membership schema permits a user to belong to multiple organizations; the local fixture convention adds no global member.userId uniqueness.
- Run the local seed twice; IDs remain stable and rows are not duplicated.
- Create private and org_shared artifacts for two fixture users. Verify mine/org filters independently.
- Database rejects missing creators and org_shared rows without an organization.
- Update and delete change the row without changing created_at. Missing ids throw Prisma P2025.
- Publish exports and any generated type details to task 04.

Tests may create additional fixture identities in an isolated test database; do not change the default local actor or assume mock repositories prove SQL behavior.

## Exclusions

No custom cross-database abstraction, Mongo support, live Better Auth endpoints, login/signup UI, session/API-key enforcement, membership administration, product API routes, storage I/O, or automatic migration execution in API initialization. Better Auth's official Prisma adapter and schema generation are explicitly included.

Setup references: [Better Auth installation](https://better-auth.com/docs/installation) and [Better Auth with Prisma](https://better-auth.com/docs/adapters/prisma). The generator supplies the configured identity models; Prisma owns the committed SQL migration history. Better Auth's direct migration command for its built-in Kysely adapter is not the Prisma migration workflow.

## Completion and handoff

Pinned Better Auth 1.7.7, `@better-auth/prisma-adapter` 1.7.7, and the `auth` CLI 1.7.7 against the workspace Prisma 6.19.0 pin. Identity models come from `apps/api/auth-schema.config.ts`: `prismaAdapter(prisma, { provider: "postgresql" })` and `plugins: [organization()]`. That file is a schema-generation config, not a mounted auth server.

`pnpm --filter @factrove/api db:generate-schema` regenerates `apps/api/prisma/schema.prisma` and is idempotent. `pnpm db:migrate` applies `prisma migrate deploy`. `pnpm db:seed` upserts `local-user` (Local User, `local@example.invalid`) and `local-org` (Local Organization, slug `local`) into the generated user and organization tables. It does not create credentials, sessions, or memberships, and it is not called from API startup.

The initial migration creates Better Auth tables `user`, `session`, `account`, `verification`, `organization`, `member`, and `invitation`, plus `artifact`. Artifact foreign keys reference those same `user` and `organization` ids with `ON DELETE RESTRICT`. `member.userId` is indexed and not unique. `org_shared` rows require `organization_id`. Ready artifact timestamps are `timestamptz`. `pnpm test` recreates the isolated `factrove_test` database from `DATABASE_URL` in gitignored `apps/api/.env`.

Task 04 should import `DatabaseModule` once from `apps/api/src/database/index.ts`. The module is global and exports `PrismaService` and `ArtifactsRepository`. Repository methods are `create`, `update`, `delete`, `findById`, and `list`. They return `ArtifactRecord` values with `Date` timestamps. `uploadedAt` is an ordinary nullable field set by create or update. `findById` returns null when the id is missing. `list({ view, userId, organizationId })` returns matching rows ordered by `createdAt` descending and then `id` descending. An org view with `organizationId: null` returns an empty list. `update` and `delete` throw Prisma `P2025` when the id is missing. `localUserFixture`, `localOrganizationFixture`, and `seedLocalIdentities` are exported from the same barrel. Task 04 maps records to HTTP DTOs and still owns wiring this module into `AppModule`. Task 07 still owns `.env.example`, infrastructure scripts, and lockfile reconciliation.
