# Factrove — MVP end state

This document is the north star for the agreed MVP. It describes the desired completed product, independent of which tasks have been implemented. Implementation status and ownership live in [the PRDs](../prd/README.md); endpoint and package details live in [the shared contract](../prd/mvp_contract.md).

## The outcome

The owner runs Factrove's frontend and backend locally on a Mac, asks a coding agent to upload an HTML file using the CLI, refreshes the web library, sees the file, and clicks it to view the HTML.

That complete loop, backed by persistent PostgreSQL metadata and object storage, is the MVP. It works without authentication, API keys, or a Factrove cloud service.

## User experience

### Web library

The Next.js UI has two views:

- **My artifacts:** completed uploads whose creator is the configured local user. This includes both private and organization-shared artifacts created by that user.
- **Organization artifacts:** completed uploads associated with the configured local organization and marked `org_shared`. This includes other creators' organization-shared artifacts.

A user's own organization-shared artifact appears in both views. A private artifact never appears in the organization view, even when its organization ID is set. With no local organization configured, the organization view is empty.

The library displays filename, upload time, size, and access classification. Refreshing the page or using the refresh action loads current data. Items are ordered by row creation time descending, with ID as the tie-breaker. Loading, empty, and unavailable-backend states are visible.

### HTML viewer

Clicking an artifact opens a stable route, `/artifacts/{id}`, with its filename and a return-to-library action. The viewer displays the original HTML in a sandboxed iframe.

Input is always HTML for this MVP: a non-empty UTF-8 `.html` or `.htm` file, including HTML fragments. Self-contained inline styling, inline scripts, and embedded assets are supported. The browser renders the document; the backend serves bytes and response headers.

The uploaded document is isolated from the application's DOM. A fixed iframe/CSP policy permits inline behavior while blocking external network resources and access to the parent application. The detailed policy is in the shared contract. This is not a screenshot, conversion, or headless-browser feature.

### CLI upload

The CLI is a standalone NestJS application that calls the HTTP API. It has no listener or separate backend. Its target commands are:

```sh
pnpm factrove upload ./report.html
pnpm factrove upload ./report.html --access org_shared --json
```

The default access type is `private`. Plain output is the viewer URL. JSON output is the shared API response envelope containing the artifact metadata and URLs. Errors go to stderr, return a nonzero exit code, and explain local input, network, or API failures.

The CLI obtains its API origin from `--api-url`, then `FACTROVE_API_URL`, then the local default. It requires no login, key, or database/storage credentials. Each upload creates a new artifact; automatic retries, overwriting, and additional CLI commands are later features.

## Local identity and access classification

An explicit local seed creates one demo user and one demo organization. The backend resolves its current actor from `LOCAL_USER_ID` and optional `LOCAL_ORGANIZATION_ID`. This supplies consistent creator/org values for the UI and CLI without implementing authentication.

The API assigns creator and organization from that configuration. The client supplies the file and access classification.

`private` and `org_shared` control listing behavior in this unauthenticated build. They are not enforced privacy guarantees: direct detail/content requests do not authenticate a viewer. Local services bind to loopback by default.

There is no membership-management flow in the MVP. The schema places **no single-organization constraint on users**. Future Better Auth integration may support multiple memberships; this local fixture arrangement does not decide that future behavior.

## Three models

The MVP has three application models: `Artifact`, `User`, and `Organization`. These definitions are authoritative for the target data model. PostgreSQL stores metadata and identities; object storage holds file bytes.

Names below are database column names. Prisma uses consistently mapped model fields; JSON API fields use camelCase.

### Artifact

| Field | Type / constraint | Meaning |
| --- | --- | --- |
| `id` | UUID, primary key | Backend-generated stable artifact identity and link ID |
| `creator_user_id` | Text, required FK → User | User who created the artifact |
| `organization_id` | Text, nullable FK → Organization | Organization captured at upload |
| `access_type` | `private` or `org_shared`; default `private` | Library classification |
| `filename` | Text, required | Original/display basename, without the client's filesystem path |
| `mime_type` | Text, required | `text/html` for every MVP artifact |
| `object_key` | Text, required and unique | Actual storage key; initially `{artifactId}.html` |
| `size_bytes` | Nonnegative integer | Actual accepted file size |
| `created_at` | Timestamp with time zone | Database row creation time |
| `updated_at` | Timestamp with time zone | Last row modification, maintained by persistence code |
| `uploaded_at` | Nullable timestamp with time zone | Successful finalization time of the current content upload |

An artifact has one creator and optionally one associated organization. Both IDs are stored explicitly; the organization is not looked up from the creator's future membership.

Local uploads capture the configured organization even for private artifacts. A personal upload with no configured organization has a null organization ID. `org_shared` requires an organization ID, enforced by a database check.

The object key is persisted even though its initial naming rule is simple. A later naming change can therefore preserve existing object references. Filename is the initial display label; a separate title is unnecessary for this MVP.

### User

| Field | Type / constraint | Meaning |
| --- | --- | --- |
| `id` | Text, primary key | Stable identity; text accommodates later Better Auth integration |
| `name` | Text, required | Display name |
| `email` | Text, required and unique | Identity metadata |
| `created_at` | Timestamp with time zone | Row creation time |
| `updated_at` | Timestamp with time zone | Last row modification |

This is a seeded local identity, not a password/session implementation. The default fixture is `local-user`, named Local User, with `local@example.invalid`.

### Organization

| Field | Type / constraint | Meaning |
| --- | --- | --- |
| `id` | Text, primary key | Stable organization identity |
| `name` | Text, required | Display name |
| `slug` | Text, required and unique | Organization slug |
| `created_at` | Timestamp with time zone | Row creation time |

The default fixture is `local-org`, named Local Organization, with slug `local`.

There is no user-to-org foreign key or uniqueness constraint encoding a single membership. Current local context comes from configuration. Better Auth's membership and other supporting tables arrive with the future auth implementation.

### Timestamp and lifecycle meaning

- Creating metadata sets `created_at` and `updated_at`; `uploaded_at` starts null.
- Successful object upload and metadata finalization set `uploaded_at` and `updated_at`.
- Lists and viewers expose only finalized artifacts.
- Future metadata-only edits would change `updated_at` without changing `uploaded_at`.
- Future replacement could retain the artifact ID and `created_at` while updating content metadata and `uploaded_at`. Replacement behavior and concurrency are outside this MVP.

There are no separate content, revision, sharing, personal-token, upload-operation, or usage models in this build. Better Auth itself is deferred; the initial User/Organization records will be migrated into its schema when that work begins.

## Storage and upload behavior

Each installation dedicates one bucket to Factrove. MVP objects are flat:

```text
<artifact UUID>.html
```

The original upload may end in `.htm`; the stored key always uses `.html`. Group prefixes and artifact versions are future work.

The backend-local storage module has one S3 implementation, with a configurable endpoint for local S3-compatible development storage. This small provider interface prepares for Azure/GCP later. Database persistence remains PostgreSQL-only, without a database-provider abstraction.

Upload size is limited to 10 MiB. The API validates the input and assigns `text/html`, creates pending metadata, writes the object, then finalizes metadata and returns the artifact. Storage I/O occurs outside database transactions.

A failed upload does not appear as a completed artifact. The API attempts cleanup; crash recovery may leave pending metadata or orphaned bytes in this initial build. This limitation is documented rather than introducing additional models or background infrastructure.

The upload endpoint is the ingestion path. Files placed into the bucket independently are not automatically imported.

## Application structure

- **Web:** Next.js App Router.
- **API:** Node.js/NestJS, grouped into controllers, services, database, storage, and HTML delivery policy.
- **CLI:** standalone NestJS context using the same API as the web app.
- **Shared packages:** runtime API contracts and a framework-neutral HTTP client.
- **Database:** PostgreSQL via Prisma, using concrete repositories and one backend-local global NestJS DatabaseModule.
- **Migrations:** committed SQL for schema changes and DML transformations in the same history; explicit idempotent local seeding.

Database and storage access remain in the backend. CLI/web communicate through the shared HTTP client. The product runs independently of the later closed-source cloud repository.

## Self-hosted end state

A documented fresh-checkout setup works on the owner's Mac with pinned Node/pnpm and a container runtime. PostgreSQL and local S3-compatible storage have persistent volumes; the dedicated bucket is initialized idempotently.

The target setup sequence is:

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

A separate terminal runs the CLI upload. The web origin defaults to `http://localhost:3000`; the API defaults to `http://localhost:3001`. These are target end-state commands; current implementation readiness is tracked in the PRDs.

Migration/seed steps are explicit. Re-running setup and restarting applications preserve data. Backend configuration holds database/storage credentials; web and CLI configuration hold HTTP origins.

## Completion criteria

The MVP is complete when demonstrated against real local PostgreSQL and S3-compatible storage:

1. A fresh checkout starts through the documented setup, with committed migrations and an idempotent seed.
2. An agent invokes the CLI on a local HTML file without credentials and receives a valid viewer URL.
3. Refreshing My artifacts shows that upload; clicking it renders the original HTML.
4. A private upload is absent from Organization artifacts.
5. An organization-shared upload by the local user appears in both lists.
6. A second fixture user's organization-shared artifact appears in the org list but not My artifacts; their private artifact appears in neither list.
7. Inline HTML behavior works within the isolated viewer.
8. Missing/unsupported/oversized files, unknown artifacts, and an unavailable backend have useful failure states.
9. CLI JSON output is parseable and the process exits cleanly.
10. Restarting applications and local services without removing volumes preserves metadata and content.

Mocks help individual tasks develop independently; the final acceptance loop uses the integrated system.

## Later work

Better Auth and API keys, real personal/org authorization, membership management, specific-person sharing, additional CLI commands, UI uploading, replacement/history, grouping, search/pagination, Markdown and other formats, Azure/GCP implementations, and managed hosting are later work.

This MVP intentionally ends at the local HTML upload, list, and view experience.
