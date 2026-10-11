# Task 02 — PostgreSQL schema, migrations, and repositories

## Goal

Persist the three-model MVP and provide the repository methods the API needs.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md) and [mvp_contract.md](mvp_contract.md). Status: not started. Depends on task 01's baseline.

## Owns

apps/api/prisma/**, apps/api/src/database/**, and database integration tests. Coordinate API manifest dependencies with task 04; task 07 owns final setup/lockfile integration.

## Deliverables

- Implement User, Organization, and Artifact as defined in docs/MVP_END_STATE.md, using the persistence interfaces in the shared contract.
- Commit an initial Prisma SQL migration with foreign keys, object-key uniqueness, access values, the org_shared organization check, and list indexes.
- Do not add membership, content, usage, upload-operation, sharing, or auth tables. Do not enforce one organization per user.
- Add an explicit, idempotent seed for the configured local identity defaults. Do not put demo data into ordinary application startup.
- Export a global DatabaseModule with PrismaService and a concrete ArtifactsRepository implementing the agreed method signatures.
- Use uploaded_at null for pending uploads; ready queries exclude them.
- Keep organization_id captured on Artifact; never derive it from a creator's later affiliation.
- Keep all schema and production data transformations in committed migrations. No db push or separate backfill scripts/folder.
- Make UTC timestamps and deterministic ordering match the HTTP contract.
- Choose explicit FK deletion behavior; no cascading destruction of artifacts through a future identity deletion by accident.

## Acceptance

Against real PostgreSQL:

- Apply migrations to an empty database; a second deploy has no pending changes.
- Run the local seed twice; IDs remain stable and rows are not duplicated.
- Create private and org_shared artifacts for two fixture users. Verify mine/org filters independently.
- Pending records never appear in ready queries.
- Database rejects duplicate object keys, missing creators, and org_shared rows without an organization.
- Marking an upload complete sets uploaded_at without changing created_at.
- Publish exports and any generated type details to task 04.

Tests may create additional fixture identities in an isolated test database; do not change the default local actor or assume mock repositories prove SQL behavior.

## Exclusions

No database adapter interface, Mongo support, Better Auth integration, membership enforcement, API routes, storage I/O, or automatic migration execution in API initialization.
