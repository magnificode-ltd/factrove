# Codebase orientation

Factrove is a TypeScript pnpm monorepo for a self-hostable artifact library.

## Applications and packages

- `apps/web`: Next.js App Router frontend.
- `apps/api`: NestJS HTTP API; controllers, services, PostgreSQL/Prisma persistence, and object storage live here.
- `apps/cli`: standalone NestJS CLI that calls the API.
- `packages/contracts`: shared runtime schemas and TypeScript API types.
- `packages/api-client`: framework-neutral HTTP client consumed by web and CLI.

The backend owns database and storage access. Its database module is global within NestJS. Shared packages are linked through pnpm workspaces and expose compiled exports.

User and Organization are Better Auth identity models (core and organization plugin). Artifact is Factrove's custom domain model and references those identities. Runtime sign-in uses email and password sessions. API keys use the `@better-auth/api-key` plugin at the same Better Auth version, and the plugin stores only a hash. Organization HTTP routes are mounted. Creating or deleting an organization, inviting or removing members, changing roles, leaving, renaming, and switching or clearing the active organization are rejected. `GET /organization/get-organization` and `GET /organization/get-full-organization` are rejected too, because a non-member id clears the active organization. Signup still creates no membership. API keys belong to the caller's active organization. `apikey.referenceId` is that organization, metadata records the creating user, and a key-authenticated request acts in the key's organization. The upgrade migration deletes every existing key. A signed-in user names their first organization with `POST /api/v1/onboarding/organization`. Until then, product routes return `403 ORGANIZATION_SETUP_REQUIRED` and the web app sends the user to `/onboarding`. A user who already has an organization is unaffected, and `/onboarding` sends them home. Membership is read from the `member` table. Requirements are in [prd/organizations.md](prd/organizations.md) and [prd/api-keys.md](prd/api-keys.md).

## Documentation map

Documentation follows these roles: README.md provides long-term codebase documentation. `prd/` holds one document per feature, covering current behavior and the constraints a change has to keep. AGENTS.md provides general orientation. Feature-specific constraints belong in the relevant PRD.

- [README.md](README.md) explains the repository, architecture, and development commands. Its [backend directory structure](README.md#backend-directory-structure) is the canonical layout.
- [docs/](docs/introduction.mdx) is the user-facing documentation: an overview that separates self-hosting from Factrove Cloud, a quickstart for each, shared guides, and the generated CLI and API references.
- [RELEASING.md](RELEASING.md) is the maintainer process for publishing the CLI. It is not part of the docs site.
- [prd/README.md](prd/README.md) indexes the feature documents.

## CLI

Commands are `upload`, `list`, `get`, `share`, `rename`, `delete`, and `configure`. Flags, config precedence, and the deliberate differences from `aws s3` are described in [prd/cli.md](prd/cli.md), [docs/guides/cli.mdx](docs/guides/cli.mdx), and [README.md](README.md).

## Tooling

Node and pnpm pins live in `.nvmrc`, `.node-version`, and `package.json`. `pnpm-workspace.yaml` sets `engineStrict` so those `engines` ranges apply to the running Node. Common checks are `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test`. PostgreSQL schema and data changes use committed Prisma SQL migrations.

## UI

For any UI or visual work in `apps/web`, or for docs styling, load and follow [`.agents/skills/frontend-design/SKILL.md`](.agents/skills/frontend-design/SKILL.md). Keep the existing brand (indigo and lilac, light theme) and Factrove's rule of no decorative motion in the signed-in app.

## Rules

The current HTML object key and its content revision are stored on the artifact row together with the size. The API generates the key. Clients never send it, and HTTP responses do not include it. The public filename stays `{artifactId}.html`. New writes use `{artifactId}/{contentId}.html` and commit only when the stored revision still matches the revision the replace read. Older rows keep `{artifactId}.html`. Do not store a bucket name, a filesystem path, or a client-supplied location.

When adding an environment variable, add that key to the committed example for the process that reads it. Application settings for the API and the web app belong in `apps/api/.env.example`. CLI settings belong in `apps/cli/.env.example`. Do not commit real secrets.

The project is licensed under AGPL-3.0-or-later. New packages must set `"license": "AGPL-3.0-or-later"` in package.json.

Every new CLI feature, and every change to CLI commands, flags, or output, ships in the same PR as the matching docs. Update the CLI guide pages under `docs/` (Mintlify reads that folder), regenerate the CLI reference with `pnpm docs:cli`, and update README CLI examples when they are affected. When the API changes, regenerate the OpenAPI reference with `pnpm docs:openapi`. A PR that adds a CLI feature without those docs is incomplete. See [DOCUMENTATION.md](DOCUMENTATION.md).

Factrove is open-source and self-hostable. A hosted offering called Factrove Cloud is available. Runtime code, config defaults, env examples, and docker-compose must not hardcode Factrove Cloud values such as `https://factrove.app`, server-side `api.factrove.app`, or `support@factrove.app`. Instance URLs come from config (`WEB_ORIGIN`, `PUBLIC_BASE_URL`, `API_PUBLIC_ORIGIN`). Sender addresses come from `EMAIL_FROM_ADDRESS` with no Cloud default. These values always come from environment variables. Docs may use `factrove.app` as the hosted Cloud example, and the published CLI may default to `https://api.factrove.app`. Tests use `example.com` or localhost-style values unless they test Cloud config.
