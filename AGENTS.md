# Codebase orientation

Factrove is a TypeScript pnpm monorepo for a self-hostable artifact library.

## Applications and packages

- `apps/web`: Next.js App Router frontend.
- `apps/api`: NestJS HTTP API; controllers, services, PostgreSQL/Prisma persistence, and object storage live here.
- `apps/cli`: standalone NestJS CLI that calls the API.
- `packages/contracts`: shared runtime schemas and TypeScript API types.
- `packages/api-client`: framework-neutral HTTP client consumed by web and CLI.

The backend owns database and storage access. Its database module is global within NestJS. Shared packages are linked through pnpm workspaces and expose compiled exports.

User and Organization are Better Auth identity models (core and organization plugin). Artifact is Factrove's custom domain model and references those identities. Runtime sign-in uses email and password sessions. API keys use the `@better-auth/api-key` plugin at the same Better Auth version, and the plugin stores only a hash. Organization HTTP routes are mounted. Creating or deleting an organization, inviting or removing members, changing roles, leaving, renaming, and switching or clearing the active organization are rejected. `GET /organization/get-organization` and `GET /organization/get-full-organization` are rejected too, because a non-member id clears the active organization. Signup still creates no membership. Membership is read from the `member` table. The build plan is [prd/org-first-plan.md](prd/org-first-plan.md).

## Documentation map

Documentation follows these roles: README.md provides long-term codebase documentation; PRDs capture MVP scope, implementation tasks, and progress. AGENTS.md provides general orientation about the codebase, using descriptive guidance. Task-specific constraints and exclusions belong in the relevant PRD, keeping this file focused on helping agents understand the project.

- [README.md](README.md) explains the repository, architecture, and development commands. Its [backend directory structure](README.md#backend-directory-structure) is the canonical layout referenced by implementation PRDs.
- [docs/](docs/introduction.mdx) is the user-facing documentation: an overview that separates self-hosting from Factrove Cloud, a quickstart for each, shared guides, and the generated CLI and API references.
- [prd/MVP_END_STATE.md](prd/MVP_END_STATE.md) is the agreed MVP north star, including the data model and observable completion criteria.
- [prd/README.md](prd/README.md) tracks implementation tasks, dependencies, and ownership.
- [prd/mvp_contract.md](prd/mvp_contract.md) defines the shared HTTP and package contracts.
- [prd/mvp/done/](prd/mvp/done/) contains completed task briefs and handoff notes.

## CLI

Commands are `upload`, `list`, `get`, `share`, `rename`, `delete`, and `configure`. Flags, config precedence, and the deliberate differences from `aws s3` are described in [README.md](README.md), [docs/guides/cli.mdx](docs/guides/cli.mdx), and [prd/mvp_contract.md](prd/mvp_contract.md).

## Tooling

Node and pnpm pins live in `.nvmrc`, `.node-version`, and `package.json`. `pnpm-workspace.yaml` sets `engineStrict` so those `engines` ranges apply to the running Node. Common checks are `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`. PostgreSQL schema and data changes use committed Prisma SQL migrations.

## Rules

The current HTML object key and its content revision are stored on the artifact row together with the size. The API generates the key. Clients never send it, and HTTP responses do not include it. The public filename stays `{artifactId}.html`. New writes use `{artifactId}/{contentId}.html` and commit only when the stored revision still matches the revision the replace read. Older rows keep `{artifactId}.html`. Do not store a bucket name, a filesystem path, or a client-supplied location.

When adding an environment variable, add that key to the committed example for the process that reads it. Application settings for the API and the web app belong in `apps/api/.env.example`. CLI settings belong in `apps/cli/.env.example`. Do not commit real secrets.

The project is licensed under AGPL-3.0-or-later. New packages must set `"license": "AGPL-3.0-or-later"` in package.json.

Every new CLI feature, and every change to CLI commands, flags, or output, ships in the same PR as the matching docs. Update the CLI guide pages under `docs/` (Mintlify reads that folder), regenerate the CLI reference with `pnpm docs:cli`, and update README CLI examples when they are affected. When the API changes, regenerate the OpenAPI reference with `pnpm docs:openapi`. A PR that adds a CLI feature without those docs is incomplete. See [DOCUMENTATION.md](DOCUMENTATION.md).

Factrove's core is open-source and self-hostable. Runtime code, config defaults, env examples, and docker-compose must not hardcode Factrove Cloud values such as `https://factrove.app`, server-side `api.factrove.app`, or `support@factrove.app`. Instance URLs come from config (`WEB_ORIGIN`, `PUBLIC_BASE_URL`, `API_PUBLIC_ORIGIN`). Sender addresses come from `EMAIL_FROM_ADDRESS` with no Cloud default. These values always come from environment variables. A hosted deployment (Cloud) just sets those same env vars, with no special code path. Cloud-only code lives in `ee/`. Docs may use `factrove.app` as the hosted Cloud example, and the published CLI may default to `https://api.factrove.app`. Tests use `example.com` or localhost-style values unless they test Cloud config.
