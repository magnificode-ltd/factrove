# Factrove

Factrove is a self-hostable home for artifacts created by people and agents. Upload a file, get a stable private link, and share it with specific people. A web library makes artifacts easy to find; a CLI lets agents publish them and return links.

This is the product repository. It is private initially and should be structured so the web app, backend, CLI, and deployment instructions can later be released as open source. Managed hosting will live in a separate, closed-source `factrove-cloud` repository.

**Status:** architecture agreed; application implementation has not started. The tree below describes the intended structure, not existing files. This README is the source of truth for the accepted architecture as of October 11, 2026. Earlier alternatives in the separate `artifactstore` documentation workspace are superseded by these decisions.

## Accepted decisions

| Area | Decision |
| --- | --- |
| Workspace | pnpm workspaces, TypeScript, one committed lockfile; no Nx. |
| Web | Next.js App Router. |
| Backend | Node.js and NestJS; one product API for web and CLI. |
| CLI | Node.js client of the same API; no separate backend. |
| Authentication | Better Auth hosted in NestJS; no Auth0. |
| Database | PostgreSQL only, accessed through Prisma and concrete repositories. No database pluggability. |
| Database scope | Backend-local, global NestJS `DatabaseModule`. |
| Database changes | Reviewed, committed Prisma SQL migrations for both schema changes (DDL) and data transformations (DML). |
| Object storage | Private Amazon S3 initially, behind a backend-local provider boundary for future Azure Blob Storage and Google Cloud Storage support. |
| Formats | Self-contained HTML initially; format-aware modeling for Markdown and other formats later. |
| Product boundary | The MVP contains the self-hostable product only. Cloud billing, provisioning, and hosting operations belong in the later cloud repository. |

## MVP scope

- Sign up, verify email, sign in, and recover access using Better Auth.
- Upload and safely view a self-contained HTML artifact.
- Browse owned/shared artifacts, search by title, and rename/delete owned artifacts.
- Share with specific verified email addresses. Artifacts are private by default; possessing a link does not grant access.
- Create and revoke scoped personal tokens for CLI and agent use.
- Publish from the CLI with machine-readable output and retry-safe uploads.
- Run a self-hosted installation without any Factrove cloud dependency.

Password-protected links, external iframe embedding, Markdown support, revisions, teams, and knowledge-base features are later work. The application's own isolated HTML viewer is part of the MVP; embedding artifacts on other websites is not.

## Repository structure

Use three applications and two genuinely shared packages. Group backend code by technical responsibility, inspired by Postiz's controllers/services/database arrangement. This is a Factrove adaptation, not a copy of Postiz's shared-library or deployment setup.

```text
factrove/
├── apps/
│   ├── web/                         # Next.js
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       └── lib/
│   │           └── api.ts           # Configured shared HTTP client
│   ├── cli/                         # Node.js
│   │   └── src/
│   │       ├── commands/
│   │       │   ├── login.ts
│   │       │   ├── push.ts
│   │       │   ├── list.ts
│   │       │   └── share.ts
│   │       └── config.ts            # Installation URL and credentials
│   └── api/                         # NestJS
│       ├── prisma/
│       │   ├── schema.prisma        # PostgreSQL schema, including auth
│       │   └── migrations/          # Committed DDL and DML migrations
│       └── src/
│           ├── main.ts
│           ├── app.module.ts
│           ├── controllers/
│           │   ├── api.module.ts
│           │   ├── artifacts.controller.ts
│           │   ├── uploads.controller.ts
│           │   ├── sharing.controller.ts
│           │   └── tokens.controller.ts
│           ├── services/
│           │   ├── services.module.ts
│           │   ├── artifacts.service.ts
│           │   ├── uploads.service.ts
│           │   ├── sharing.service.ts
│           │   └── tokens.service.ts
│           ├── database/
│           │   ├── database.module.ts   # @Global()
│           │   ├── prisma.service.ts
│           │   └── repositories/
│           │       ├── artifacts.repository.ts
│           │       ├── uploads.repository.ts
│           │       ├── sharing.repository.ts
│           │       └── tokens.repository.ts
│           ├── auth/
│           │   ├── auth.module.ts
│           │   ├── better-auth.ts
│           │   └── guards/
│           ├── storage/
│           │   ├── storage.module.ts
│           │   ├── storage.service.ts
│           │   ├── blob-store.ts
│           │   └── providers/
│           │       └── s3.provider.ts
│           └── rendering/
│               ├── rendering.module.ts
│               ├── renderer.registry.ts
│               └── html.renderer.ts
├── packages/
│   ├── contracts/                  # API schemas, DTOs, errors
│   └── api-client/                 # HTTP client used by web and CLI
├── deploy/                         # Container and proxy configuration
├── docs/                           # Operator and implementation docs
├── compose.yaml
├── pnpm-workspace.yaml             # apps/* and packages/*
├── pnpm-lock.yaml
├── package.json
├── AGENTS.md
└── README.md
```

Use `workspace:*` dependencies and explicit exports for shared packages. Pin pnpm and runtime versions when scaffolding. Keep database, storage, authentication, and rendering inside the backend: having a distinct responsibility does not itself justify a workspace package. Extract a package only when an actual consumer needs it.

## Backend responsibilities and boundaries

| Layer | Owns |
| --- | --- |
| Controllers | HTTP inputs, authentication guards, validation, response mapping. |
| Services | Authorization decisions, sharing rules, upload lifecycle, coordination. |
| Repositories | Concrete Prisma queries and transactional persistence. |
| Auth | Better Auth server configuration, sessions, resolving user/token principals. |
| Storage | Reading, writing, inspecting, and deleting private objects through providers. |
| Rendering | Supported-format validation and safe preview behavior. |

`AppModule` imports `DatabaseModule` once. Mark it with NestJS `@Global()` and export `PrismaService` and concrete repositories so other backend modules can inject them. Register business services in `ServicesModule`, export them to `ApiModule`, and register controllers in `ApiModule`.

Global means available through dependency injection inside the NestJS application. It does not expose database access to Next.js or the CLI, or imply a single shared connection across processes.

Repositories need no interchangeable interfaces, generic database adapter, or database-provider selector. They may use Prisma types and PostgreSQL-specific behavior directly. A repository can operate on related tables; one repository per model is not required. Operations spanning repositories must use the same transaction client when atomicity is required.

```text
Next.js web ── shared HTTP client ──┐
                                  ├── NestJS controllers → services
Node CLI ───── shared HTTP client ──┘                         ├── repositories → PostgreSQL
                                                            └── storage → S3
```

- `contracts` is shared by the API and its clients; `api-client` depends on those contracts and is used by web and CLI.
- Shared packages contain no Prisma entities, NestJS providers, server secrets, or storage SDK details. API contracts remain separate from database models; validate inputs at runtime.
- Web and CLI never import backend implementation files. Next.js server components also use the API rather than querying PostgreSQL directly.
- NestJS owns the product API and Better Auth endpoints. Do not create a second product backend or auth server in Next.js.
- Configure the HTTP client separately for browser, Next.js server, and CLI credentials. Private responses must not enter shared caches.
- Keep the product API versioned for independently installed CLI versions.

### CLI framework

Node.js is the runtime; NestJS is an optional framework on that runtime. The current CLI proposal uses ordinary TypeScript command handlers and the shared HTTP client because its responsibilities are argument parsing, local credentials, file uploads, and output formatting. It does not need the backend's dependency-injection graph or database services.

A standalone NestJS CLI is also possible without starting an HTTP server. If adopted later for dependency injection and framework consistency, it must still call the product API and must not import backend/database modules. This is a framework choice, not a change to the remote-client boundary. See [NestJS standalone applications](https://docs.nestjs.com/standalone-applications).

### Rendering module

The backend `rendering/` module is a small home for format-specific validation and delivery behavior. For HTML, it validates the supported format and supplies the media type and isolation policy for serving the stored source. The browser renders the HTML in the web viewer's sandboxed iframe; NestJS does not execute uploaded HTML or run a browser to generate it.

Later, a Markdown handler could convert source into safe preview HTML, while a plain-text handler could serve escaped text. The registry selects the supported handler by format. Storage only retrieves bytes; authorization remains in product services/content routes; the Next.js viewer owns the surrounding UI. Keep this module small: no headless browser, screenshot generation, conversion jobs, or dynamic plugin loader in the MVP.

## Data model

PostgreSQL stores identity, metadata, permissions, and operational state. Object storage holds source bytes. These are logical models; exact fields and indexes will be implemented in `schema.prisma` and reviewed migrations.

| Model | Main fields and relationships |
| --- | --- |
| Better Auth models | User, session, account, and verification records required by Better Auth. Product ownership and principals reference the auth user's stable ID. |
| `Artifact` | ID, owner ID, title, lifecycle status, timestamps, deletion state. Its ID identifies the stable shareable link. |
| `ArtifactContent` | ID, unique artifact ID, format, MIME type, original filename, `storeId`, `objectKey`, byte size, checksum, optional format metadata. Exactly one source record per artifact in the MVP. |
| `ArtifactAccess` | ID, artifact ID, normalized recipient email, viewer permission, timestamps. Unique per artifact and recipient; access requires a matching verified identity. |
| `PersonalToken` | ID, owner ID, token hash, scopes, creation/expiry/revocation timestamps, last-used timestamp. Never persist the raw token. |
| `UploadOperation` | ID, owner ID, artifact ID, idempotency key, request fingerprint, status, lease/retry state, result/error metadata. Enforce owner-scoped idempotency uniqueness. |
| `OwnerUsage` | One record per owner with committed and reserved storage/count totals for configurable installation limits. Update atomically with lifecycle changes. |

An owner has many artifacts, tokens, and upload operations. An artifact has one source content record and many access grants. Keep `(storeId, objectKey)` unique. Enforce relationships and uniqueness in PostgreSQL as well as application checks.

The artifact is the shareable item; content is its stored source. Avoid `htmlBody` fields, HTML-only object-key conventions, and provider URLs as artifact identities. A future Markdown source uses the same ownership, sharing, and storage model with a different format and renderer. Revisions or derived previews require explicit later model changes and migrations.

## Committed schema and data migrations

`apps/api/prisma/schema.prisma` describes the intended schema. Commit generated and reviewed SQL migrations under `apps/api/prisma/migrations/`. Include Better Auth schema changes in the same controlled history, in dependency order with product tables.

- Generate migrations during development with Prisma Migrate, inspect their SQL, and commit them with associated schema/application changes.
- Apply committed migrations with `prisma migrate deploy` as an explicit installation/upgrade step before starting the compatible application version. Do not have each API replica independently change the schema at startup.
- Do not use `prisma db push`, schema resets, or `--accept-data-loss` as the normal installation or upgrade path.
- Never edit a migration already applied to a shared or deployed database; add a new migration to correct it.
- Verify installation into an empty PostgreSQL database and upgrades from the previous supported schema with representative existing data.
- Document upgrade ordering, compatibility, backups, and recovery. Committed migrations do not provide automatic rollback.

Schema changes do not automatically transform existing data. Write data transformations as DML (`UPDATE`, `INSERT`, or `DELETE`) in committed `migration.sql` files alongside schema migrations. There is no separate backfill folder or script runner. Generate a draft migration with `prisma migrate dev --create-only`, write/review the required SQL before applying it, and commit it. A data-only migration can leave `schema.prisma` unchanged. This is supported by the [Prisma SQL migration workflow](https://docs.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations), which includes an example of copying existing values with an `UPDATE` migration. Pin a compatible Prisma version when scaffolding.

Review DML migrations for correctness on empty and populated databases, existing constraints, concurrent writes, expected row counts, locking, and failure recovery. Prisma records migration application; it does not infer the transformation from a schema diff. Assess large data changes explicitly rather than introducing a separate backfill system preemptively.

For a change such as splitting `full_name` into `first_name` and `last_name`, use expand → backfill → contract:

1. **Expand:** commit a migration adding nullable columns while retaining the old one. Deploy compatible code that maintains both representations for new writes.
2. **Backfill:** commit and apply a DML migration that transforms old values into the new columns. Define parsing rules, prevent overwriting newer writes, and verify completeness before switching reads.
3. **Switch:** deploy reads using the new representation. Retire old application versions and consumers, then stop depending on or writing the old field.
4. **Contract:** in a later compatible release, commit a migration removing the obsolete column and adding final constraints. Apply it only after backfill and compatibility checks succeed.

This applies to any model. Not every additive change requires multiple releases, but destructive transformations must not drop source data before backfilling. Both DDL and DML run through the same migration history. Coordinate application releases with the migration phases: `migrate deploy` applies all pending migrations, so ship the contract migration only in the release where removing the old schema is safe, rather than shipping every phase together and expecting the runner to pause.

## Storage and upload lifecycle

Database and storage extensibility are separate decisions. PostgreSQL has no provider abstraction. Storage retains a small `BlobStore` contract because Azure and GCP support are intended future requirements.

- Implement only S3 for production in the MVP. Keep SDK types and provider-specific errors inside its implementation.
- Persist `storeId` and `objectKey`; resolve the store ID through trusted operator configuration. Temporary signed URLs are not canonical locations.
- Keep store IDs stable. Future providers must preserve reads from existing stores; moving bytes requires explicit copying, verification, and reference updates.
- Use bounded-memory streaming, normalized errors, and explicit retry/deletion behavior.
- Keep authorization in product services and content routes, independent of the provider.

Uploads reserve capacity and create metadata in a short database transaction, write bytes to S3 outside that transaction, then finalize the artifact and usage in another short transaction. Track retries and incomplete work in `UploadOperation`. Never hold a database transaction open during object-storage I/O.

Deletion first makes the artifact inaccessible, then removes bytes with retryable cleanup and releases usage exactly once. PostgreSQL and S3 do not share a transaction; cleanup must recover after restarts. A scheduled product command is sufficient initially. Temporal, Redis, and a separate worker application are outside the agreed MVP.

## Authentication and safe viewing

Better Auth runs in NestJS using PostgreSQL-backed auth models. Web uses its browser client; CLI and agents use revocable scoped personal tokens for product requests. Backend authorization applies equally to both clients.

Share links point to the product viewer, not public S3 objects. Check ownership or a verified recipient grant before issuing content access, and recheck artifact/access state when serving content. Uploaded HTML runs on a separate, restricted content origin in a sandboxed viewer without application cookies or access to the application DOM. Do not insert uploaded HTML into Next.js pages.

Each future format needs its own validation and safe viewing behavior. Markdown must not implicitly enable embedded code or inherit HTML script permissions.

## Implementation and validation

Build the first vertical slice here: workspace setup, Next.js and NestJS, PostgreSQL migrations, Better Auth, S3 upload, and an authorized HTML viewer. Then add library/sharing, CLI, failure recovery, and self-hosted installation documentation.

Validate import boundaries, migration installation/upgrades, ownership and sharing, token scopes, private response caching, rendering isolation, concurrent/idempotent uploads, and recovery across PostgreSQL/S3 failures. Test database behavior against PostgreSQL and storage behavior against the supported S3 implementation.

No runnable setup commands or application tests exist yet. Add and verify them when scaffolding; keep this README current as implementation replaces the planned structure.

## Future cloud repository

`factrove-cloud` will add managed hosting, billing, provisioning, entitlements, and operations around versioned product releases. The product must remain independently usable, without imports from the private cloud repository or a cloud activation dependency. Public publication and license selection are separate future decisions.
