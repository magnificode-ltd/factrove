# Task 02 — PostgreSQL schema, migrations, and repositories

## Goal

Persist Artifact using Better Auth's User and Organization identities, and provide the repository methods the API needs. The MVP remains unauthenticated at runtime; identity schema reuse is part of this database task.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md) and [mvp_contract.md](mvp_contract.md). Status: not started. Depends on task 01's baseline.

## Owns

apps/api/prisma/**, apps/api/src/database/**, a backend-local schema-generation configuration such as apps/api/auth-schema.config.ts, and database integration tests. Coordinate pinned Better Auth/generator dependencies and API manifest changes with task 04; task 07 owns final setup/lockfile integration.

## Deliverables

- Configure Better Auth with its official Prisma adapter: `database: prismaAdapter(prisma, { provider: "postgresql" })`, and `plugins: [organization()]`. Keep this configuration backend-local and reuse the backend's Prisma setup; web/CLI do not own Better Auth database configuration. Pin compatible Better Auth, adapter, and schema-generator dependencies. The workspace currently pins Prisma 6.19.0; follow the documentation for the chosen compatible versions rather than copying Prisma 7-specific setup or upgrading Prisma implicitly.
- Generate the Prisma identity schema from a pinned Better Auth configuration with its organization plugin. User and Organization are Better Auth's models, not independently designed Factrove models or temporary tables for a later identity migration. Keep the generator configuration/command reproducible and backend-local.
- Retain the supporting models required by that generated configuration, including core session/account/verification and organization member/invitation models. These are library-owned schema, not additional Factrove product concepts. There is no requirement for exactly three physical tables.
- Add Factrove's Artifact model as defined in docs/MVP_END_STATE.md, referencing the generated User and Organization models directly, using the persistence interfaces in the shared contract. Preserve adapter-compatible identity model/field mappings.
- Commit an initial Prisma SQL migration with foreign keys, object-key uniqueness, access values, the org_shared organization check, and list indexes.
- Do not add custom content, usage, upload-operation, sharing, or token tables. Do not enforce one organization per user; in particular, member.userId must not be globally unique. Generated pair-level membership constraints are a separate concern.
- Add an explicit, idempotent seed into the actual Better Auth user/organization tables, including their required fields, for the configured local identities. No credentials or sessions are needed. Do not put demo data into ordinary application startup.
- Use Better Auth tooling to generate schema only; create/review/commit SQL with Prisma Migrate. Keep auth routes, session/key checks, and runtime membership enforcement deferred. The schema-generation configuration is not mounted as a live auth server in the MVP.
- Export a global DatabaseModule with PrismaService and a concrete ArtifactsRepository implementing the agreed method signatures.
- Use uploaded_at null for pending uploads; ready queries exclude them.
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
- Pending records never appear in ready queries.
- Database rejects duplicate object keys, missing creators, and org_shared rows without an organization.
- Marking an upload complete sets uploaded_at without changing created_at.
- Publish exports and any generated type details to task 04.

Tests may create additional fixture identities in an isolated test database; do not change the default local actor or assume mock repositories prove SQL behavior.

## Exclusions

No custom cross-database abstraction, Mongo support, live Better Auth endpoints, login/signup UI, session/API-key enforcement, membership administration, product API routes, storage I/O, or automatic migration execution in API initialization. Better Auth's official Prisma adapter and schema generation are explicitly included.

Setup references: [Better Auth installation](https://better-auth.com/docs/installation) and [Better Auth with Prisma](https://better-auth.com/docs/adapters/prisma). The generator supplies the configured identity models; Prisma owns the committed SQL migration history. Better Auth's direct migration command for its built-in Kysely adapter is not the Prisma migration workflow.
