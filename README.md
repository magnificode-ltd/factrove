# Factrove

Factrove is a self-hostable home for artifacts created by people and agents. Its web application organizes artifacts. Its command-line client publishes HTML files and prints the new artifact id. The share command prints a public link.

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

### Backend directory structure

This is the canonical backend layout for implementation PRDs. The directory boundaries and the locations of the database module, repositories, Prisma schema, and migrations are intentional. Feature filenames illustrate the convention; add files in the corresponding responsibility directory as features grow. This describes the target structure, not a claim that every file is already implemented.

```text
apps/api/
├── auth-schema.config.ts             # Better Auth schema-generation configuration
├── prisma/
│   ├── schema.prisma                 # Better Auth identities and Artifact
│   └── migrations/
│       ├── migration_lock.toml
│       └── <timestamp>_<description>/
│           └── migration.sql         # Committed DDL and DML
├── src/
│   ├── main.ts
│   ├── app.module.ts                 # Application composition
│   ├── controllers/
│   │   ├── api.module.ts
│   │   ├── artifacts.controller.ts
│   │   ├── public-artifacts.controller.ts
│   │   ├── json-body.ts              # Optional JSON bodies with a strict content type
│   │   └── context.controller.ts
│   ├── services/
│   │   ├── services.module.ts
│   │   ├── artifacts.service.ts
│   │   └── api-config.ts
│   ├── auth/
│   │   ├── create-auth.ts            # Email/password sessions and the API key plugin
│   │   ├── api-key-plugin.ts         # @better-auth/api-key options
│   │   └── actor.service.ts          # Session or API-key caller
│   ├── mail/
│   │   ├── email-sender.ts           # EmailSender and the log transport
│   │   ├── smtp-email-sender.ts      # SMTP transport for any server
│   │   ├── brevo-email-sender.ts     # Brevo HTTP transport
│   │   ├── invite-email-template.ts  # Branded HTML and text invite template
│   │   ├── invite-email.ts           # Invite message for a new account
│   │   ├── invite-mailer.ts          # Sends that message and logs failures
│   │   ├── redact-secret.ts          # Removes provider secrets from error text
│   │   └── mail.module.ts
│   ├── database/
│   │   ├── index.ts                  # Public backend database exports
│   │   ├── database.module.ts        # Global Nest module
│   │   ├── prisma.service.ts         # Prisma client and connection lifecycle
│   │   ├── repositories/
│   │   │   └── artifacts.repository.ts
│   │   ├── seed/
│   │   │   ├── seed.ts               # Explicit seed entry point
│   │   │   └── seed-local-identities.ts
│   │   └── types/
│   │       └── artifact-record.ts    # Internal persistence records/inputs
│   ├── sharing/
│   │   ├── share-link.ts             # Public base URL, share token, and link builders
│   │   ├── share-token-cipher.ts     # AES-256-GCM share token encryption
│   │   ├── share-password.ts         # Argon2id link password hashing
│   │   ├── share-grant.ts            # Unlock grants, content tickets, and the ticket ledger
│   │   ├── public-origin.ts          # Browser origins for CORS and frame-ancestors
│   │   ├── public-api-path.ts        # Public route matching
│   │   ├── rate-window.ts            # Two-window in-memory counter
│   │   ├── public-view-limit.ts      # Public view rate limit
│   │   └── password-attempt-limit.ts # Client, share, and per-IP verify unlock limits
│   ├── storage/
│   │   ├── index.ts
│   │   ├── storage.module.ts
│   │   ├── blob-store.ts             # Interface and injection token
│   │   └── providers/
│   │       └── s3.provider.ts
│   └── rendering/
│       ├── html-policy.ts            # HTML validation/delivery policy
│       ├── html-to-markdown.ts       # Linear HTML to Markdown conversion
│       ├── html-to-markdown.worker.ts
│       └── convert-html-to-markdown.ts # Bounded worker pool for Markdown conversion
└── test/
    └── database.integration.test.ts
```

Backend code is grouped by responsibility, with concrete persistence classes under `src/database/repositories/`. Prisma schema and SQL migrations live in `apps/api/prisma/`; the Nest database module and service live directly in `src/database/`. Repositories use `PrismaService`; application services coordinate repositories and storage; controllers expose those services over HTTP. Database records stay backend-local, while wire schemas live in `packages/contracts`.

`AppModule` imports `DatabaseModule` once. Its `@Global()` declaration and exported `PrismaService` and repositories make those providers injectable throughout the backend. `ApiModule` registers controllers and imports `ServicesModule`; `ServicesModule` registers application services and imports `StorageModule` for file operations. The schema-generation and seed commands are standalone entry points with their own client lifecycle.

Storage implementations belong in `storage/providers/` behind the backend-local `BlobStore` interface. Additional cloud providers can follow that convention. Database repositories use PostgreSQL directly through Prisma, without a pluggable database-provider layer. `rendering/` holds browser-content validation and delivery policy. The browser renders the artifact itself. Markdown conversion runs in a worker thread with time, memory, and output limits.

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

Better Auth connects to PostgreSQL through its official Prisma adapter: `database: prismaAdapter(prisma, { provider: "postgresql" })`, with `organization()` configured for organization models and `@better-auth/api-key` for API keys. This configuration lives in the backend and uses its Prisma setup. Better Auth tooling generates the identity schema; Prisma Migrate manages the committed SQL migrations. See the [installation guide](https://better-auth.com/docs/installation), the [Prisma adapter guide](https://better-auth.com/docs/adapters/prisma), and the [API key plugin](https://better-auth.com/docs/plugins/api-key).

Object storage is another backend-local module. Its S3 implementation uses the configured bucket and region, and `S3_ENDPOINT` when that variable selects an S3-compatible service. The small provider interface accommodates future Azure/GCP implementations. The backend owns database and storage configuration.

Uploaded HTML is rendered by the browser in an isolated viewer. The backend's rendering responsibility is content validation, delivery policy, and converting stored HTML to Markdown when a client asks for that format. Markdown is not stored.

## Local setup

This checkout runs the local upload, library, and viewer loop. PostgreSQL runs in Docker and keeps metadata in a named volume. Artifact bytes go to Garage, the local S3-compatible server started with it. Real AWS S3 stays available: set the bucket, region, and credentials, and leave `S3_ENDPOINT` unset. The API and the web app share one environment file. The CLI reads its own environment file, process variables, and `~/.factrove` profile files. Database and storage credentials stay in the application environment.

Sign in at `http://localhost:3000/signup` or `/login`. Creating an account sends an invite email to that address. `POST /api/auth/sign-up/email` is the same path, and a plus-address such as `name+tag@example.com` is a valid invitee. The CLI does not create accounts. `EMAIL_TRANSPORT` selects `log`, `smtp`, or `brevo`. Unset transport logs the message and does not send it. The from address defaults to Factrove `<support@factrove.app>`. The local commands are in [docs/guides/self-hosting.mdx](docs/guides/self-hosting.mdx). Private artifacts are readable only by their owner. Organization-shared artifacts are readable by members of the artifact's organization. A public link works only after the owner shares the artifact. Anyone with that link can open it without an account. The CLI sends an API key from `FACTROVE_API_KEY` or from `factrove configure`. Create and revoke keys at `/account/api-keys`. The secret is shown once.

`PUBLIC_BASE_URL` is the origin used for viewer URLs and public share links. When it is unset, those links use `WEB_ORIGIN`. `http://localhost:3000` keeps every link on localhost. `https://factrove.app` uses that domain plus the artifact id. A trailing slash or an uppercase host is normalized to the origin. A path, query, or hash is rejected. The same value is the source for later embeds. It does not start a server or publish the app. `frame-ancestors` follows that origin and `WEB_ORIGIN`. Public API routes allow those origins with credentials omitted. Most public routes allow GET, HEAD, and OPTIONS. The password unlock route also allows POST. That public-path check is case-insensitive. Session writes are accepted from both origins. When the hosts differ, `AUTH_COOKIE_DOMAIN` must cover both, and Better Auth trusts both origins. When one of those hosts is localhost or an IP address, use the same host for `WEB_ORIGIN` and `PUBLIC_BASE_URL`. A cookie domain cannot cover those names.

The share token is encrypted at rest with AES-256-GCM, and the ciphertext is bound to the artifact id. Set `SHARE_TOKEN_KEY` to choose the key material. When it is unset, the key is derived from `BETTER_AUTH_SECRET`. Rotating the value that supplies the key revokes existing public links. The old URL returns 404, and the library shows the artifact as not shared, because public lookup decrypts the stored token with the current key and requires the hash to match. Sharing again mints a new link. A decrypted token is shown only when its hash matches the stored hash.

Public views allow 60 requests per minute per client address, in memory, on each API process. Counts live in the current window and the previous window. Those windows use a monotonic clock and rotate so a request does not scan every visitor. When the map is full, the oldest visitor is dropped and the new visitor is still allowed. Oldest means the first address inserted in that window, not the least recently used, so a busy early visitor is dropped before a later one. A caller who can present more than 10,000 addresses can cycle keys and exceed the per-address limit. The cap keeps one process from growing without bound. It is not a defence against a large set of source addresses. One page view counts as one request: the detail request is charged, and up to two following content loads within 30 seconds are included in that view. IPv6 addresses share a bucket by their /64. Behind a reverse proxy, set `TRUSTED_PROXIES` to that proxy so the limit uses the visitor address from `X-Forwarded-For`. Without it, every visitor shares the proxy's address. A share URL whose id or token has the wrong shape is HTTP 404. The library loading UI does not wrap `/share`.

A share link can carry an optional password, 10 to 128 characters, that is not on the bundled common-password list. It is hashed with Argon2id from `node:crypto` and only the PHC hash is stored. Visitors to a protected link see a password page. The detail request returns `401 PASSWORD_REQUIRED` until they unlock, while a dead link is still the same 404. A correct password returns a grant that lasts 15 minutes. The grant is an HMAC over the artifact id, the share token hash, a fingerprint of the stored password hash, and the expiry, keyed from the same input as the share token key. The browser keeps it in `sessionStorage` and sends it in the `X-Factrove-Share-Grant` header on the cookie-free detail request, so it never becomes a cookie or a URL. The sandboxed iframe cannot send headers, so its content URL carries a separate ticket that lasts 60 seconds and is honored three times per API process. With N API processes that is up to 3N uses within those 60 seconds, because each process has its own ledger. A grant minted on one process is honored on another. Evicting the oldest ledger entry at 10,000 keys can also hand uses back. The artifact document can see only that ticket. Changing or removing the password, revoking the link, and rotating the key all invalidate existing grants. Sharing again without a password, while the current key can still read the token, returns the same link and leaves those grants in place. Reverse proxies should not log the `ticket` query parameter. Unlock failures allow 10 per 10 minutes per client address and 30 per 10 minutes per current share token hash, separately from the view limit, in memory on each API process. A missing or non-JSON body is rejected before either bucket is touched. The share cap is charged only after a wrong password, so thirty correct visitors do not exhaust it. In-flight unlock checks occupy share slots separately from those confirmed failures, so concurrent correct visitors are not counted as lockouts. An exhausted share is refused without hashing and sends `Retry-After`. That is the accepted MVP trade-off: someone who has the leaked link and keeps submitting wrong passwords can lock the link for up to ten minutes at a time. The owner recovers by revoking and sharing again with the same password. Revoke clears the password, so a following share that omits it creates an unprotected link. The new share has a new token hash and a fresh share budget. The owner panel shows that lockout when the cap is hit. Recent confirmed failures add a delay of at most two seconds before verification; they do not reject a correct password. Every Argon2 verify, success or failure, also spends a per-IP budget of 20 per minute and 100 per 10 minutes, with one concurrent verify per address, so an attacker cannot starve other visitors by unlocking their own shares. A saturated process-wide gate is 503 with `Retry-After` and does not refund that verify budget. When confirmed failures are under the cap but every remaining share slot is already in flight, unlock returns that same 503, charges the per-IP verify budget, and does not refund it.

### Prerequisites

- Node.js 24.16.0, pinned in [.nvmrc](.nvmrc) and [.node-version](.node-version). The engine floor is `>=24.7.0`, the first release with `crypto.argon2`. pnpm checks that range against the running Node.
- pnpm 11.25.0, pinned by `packageManager` in [package.json](package.json).
- Docker Desktop on Apple Silicon or Intel Mac, or another runtime that provides Docker Compose v2 (`docker compose`). OrbStack and Colima qualify when they provide that command. Start the runtime before `pnpm infra:up`.
- Playwright's Chromium build, for `pnpm e2e`:

```sh
pnpm --filter @factrove/web exec playwright install chromium
```

On Linux, Chromium also needs its system libraries. `pnpm --filter @factrove/web exec playwright install-deps chromium` installs them and may need root.

The Postgres image is pinned to the official `postgres:17.11` multi-arch index, so the Mac's architecture selects its own build. Host port `5432` is bound to `127.0.0.1`. Garage `v2.3.0` is pinned the same way. Its S3 API is bound to `127.0.0.1:3900`, and it creates the `factrove` bucket on startup.

### Environment

```sh
cp apps/api/.env.example apps/api/.env
cp apps/cli/.env.example apps/cli/.env
```

`apps/api/.env` is the application environment. The API loads it on startup and keeps variables that are already set. `pnpm dev` reads `NEXT_PUBLIC_API_URL` from that file and passes it to the web app when the variable is unset. `pnpm build` and `next build` read the same value when it is unset and Next.js fixes it in the client bundle. `next start` cannot change that origin, so run the build again after changing it. Only `NEXT_PUBLIC_API_URL` is copied from that file. Database, storage, and auth-secret settings stay on the API process.

`apps/cli/.env` is read by `pnpm factrove` for local development. `node apps/cli/dist/main.js` does not read it. The file may set `FACTROVE_API_URL` and `FACTROVE_PROFILE` when those variables are unset. It does not set an API key. `FACTROVE_CLI_ENV_FILE` selects a different file. That name is read from the process environment, and the file itself cannot set it. The example leaves `FACTROVE_API_URL` commented because the built-in default is already `http://localhost:3001`. Omit the file and the CLI still uses that default.

Edit `apps/api/.env` before uploading:

- `DATABASE_URL` already matches the Compose database `factrove` on `127.0.0.1:5432`, user `factrove`, password `factrove`.
- `S3_BUCKET=factrove`, `S3_REGION=us-east-1`, `S3_ENDPOINT=http://127.0.0.1:3900`, and `S3_FORCE_PATH_STYLE=true` match Garage. The access key `factrove-local` and secret `factrove-local-secret` are local credentials from [compose.yaml](compose.yaml). `pnpm infra:up` creates the bucket. A plain `http://` `S3_ENDPOINT` is accepted for `localhost`, `127.0.0.1`, and `::1`. Any other host needs `https://`.
- For an existing AWS bucket, set `S3_BUCKET` and `S3_REGION`. Remove `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`. Replace `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or remove both. The storage client uses that pair whenever both are set, so the Garage values `factrove-local` and `factrove-local-secret` keep an instance role or `AWS_PROFILE` from being selected. When the key is temporary, set `AWS_SESSION_TOKEN` as well. The API sends the token only together with the access key and secret. With `S3_ENDPOINT` unset, the API calls AWS in `S3_REGION` and ignores `AWS_ENDPOINT_URL`. It does not create the AWS bucket.
- AWS calls need `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` on the object keys the API generates.

`NEXT_PUBLIC_API_URL` in `apps/api/.env` is the origin the browser uses for the API. It defaults to `http://localhost:3001`. A production bundle from `pnpm build` keeps the origin from the build. The Docker web image reads `BROWSER_API_URL` when it renders a page, so that origin can change without a rebuild. `INTERNAL_API_URL` is the origin the Next.js server uses to reach the API. Leave both unset for `pnpm dev`.

CLI resolution follows the AWS CLI: flags, then environment variables, then profile files. `--endpoint-url` and `--api-url` set the API origin for one command. They must agree when both are present. Then `FACTROVE_API_URL` from the process environment, then `FACTROVE_ENDPOINT_URL` when that is unset. Then the selected profile's `api_url` in `~/.factrove/config`, or `endpoint_url` in that profile when `api_url` is absent. `pnpm factrove` uses a URL from `apps/cli/.env` only when the environment and the profile have no URL. The built-in default is `http://localhost:3001`. `FACTROVE_API_KEY` supplies the key when `--profile` is omitted. An explicit `--profile` uses that profile's `factrove_api_key` in `~/.factrove/credentials` and ignores `FACTROVE_API_KEY`. `factrove configure` writes those files mode 0600 and stores the origin as `api_url`. `apps/cli/.env` does not supply a key or `FACTROVE_ENDPOINT_URL`. `FACTROVE_PROFILE` selects a profile when `--profile` is omitted, and `pnpm factrove` can fill that name from `apps/cli/.env` when the variable is unset. The API key is not printed. Commands, config precedence, the dev env file, and the differences from `aws s3` are in [docs/guides/cli.mdx](docs/guides/cli.mdx).

The session cookie is for the API host. On localhost that cookie is sent to both ports. When the web app and API use different hosts, set `AUTH_COOKIE_DOMAIN` in `apps/api/.env` to the narrowest parent of both, such as `factrove.example.com` for `app.factrove.example.com` and `api.factrove.example.com`. The browser sends that cookie to every subdomain of the value. Startup rejects an IP address, a public suffix, and a domain that does not cover both origins. Set `TRUSTED_PROXIES` to the IP addresses or CIDR ranges of reverse proxies that may send `X-Forwarded-For`. Leave it unset when the API sees the client socket directly. Sign-in limits follow that client address, and an incoming `X-Forwarded-For` from an untrusted peer does not choose the bucket.

### Start, stop, and upload

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm infra:up` starts PostgreSQL and Garage and waits until both are healthy. Garage creates the `factrove` bucket when it starts. `pnpm db:migrate` applies the committed migrations. `pnpm db:seed` upserts the fixture user `local-user` (Local User) and organization `local-org` (Local Organization). That user has no password. Run seed again whenever you want; it keeps those ids and does not wipe artifacts. Neither migrate nor seed runs from API startup. Set `BETTER_AUTH_SECRET` in `apps/api/.env` before `pnpm dev`. Use at least 32 characters. The example value is a local placeholder.

An installation that already has artifacts owned by `local-user` keeps those rows and their ids through migrate. Sign up in the web app, then attach them to that account:

```sh
pnpm db:claim-local-artifacts -- --email you@example.com
```

The command changes the creator of those artifacts to the account and adds a membership for each organization they already reference. Viewer links stay `/artifacts/{id}`. Running it again changes nothing. It does not create a password for `local-user`.

`pnpm dev` builds the API, CLI, and shared packages, then starts the API on `http://127.0.0.1:3001` and the web app on `http://127.0.0.1:3000`. Open the library at `http://localhost:3000`. Logs from both are prefixed `[api]` and `[web]`. Ctrl+C, SIGTERM, and closing the terminal stop both. If one app exits, the command stops the other. Restart `pnpm dev` after API changes. The Next.js app reloads as web files change. While it is running, Next.js may rewrite `apps/web/next-env.d.ts`. The command restores the committed copy when it exits.

In a second terminal, from the repository root:

```sh
pnpm factrove configure
pnpm factrove upload ./fixtures/hello.html
pnpm factrove upload ./fixtures/hello.html --name "X launch calendar"
pnpm factrove upload ./fixtures/hello.html --access org_shared --json
pnpm factrove upload ./report.html --api-url http://localhost:3001 --json
pnpm factrove upload --help
pnpm factrove get <artifact-id>
pnpm factrove get <artifact-id> --format markdown
pnpm factrove get <artifact-id> --format markdown --json
pnpm factrove share <artifact-id>
pnpm factrove share <artifact-id> --password
printf '%s' "$LINK_PASSWORD" | pnpm factrove share <artifact-id> --password-stdin
pnpm factrove share <artifact-id> --remove-password
pnpm factrove share <artifact-id> --revoke
pnpm factrove upload ./fixtures/hello.html --artifactId <artifact-id>
pnpm factrove list
pnpm factrove list --view org --json
pnpm factrove rename <artifact-id> --name "X launch calendar"
pnpm factrove delete <artifact-id>
pnpm factrove delete <artifact-id> --yes
```

Open `http://localhost:3000`, choose My artifacts or Organization artifacts, and use Refresh after an upload. An empty My artifacts page shows `npm i -g factrove`, `factrove configure --api-url` for the app's API origin, and `factrove upload`. The npm package is not published yet. `--access org_shared` requires an existing organization membership. Signup and `pnpm db:seed` do not create one. Plain `upload` success prints only the artifact id. `--json` prints the `{ artifact }` envelope on one line. `upload <file> --artifactId <id>` replaces that artifact's content and prints the same id. Failures go to stderr and the process exits 1. Success exits 0. pnpm prints the script line it runs to stderr, prefixed with `$ `. A relative upload path uses the CLI process directory. `pnpm factrove` sets that directory to the one where you ran `pnpm`. Direct `node apps/cli/dist/main.js` uses its own directory and ignores `INIT_CWD`.

`pnpm factrove get <id>` prints that artifact's content. The default format is HTML, the same bytes stored for the artifact. `--format markdown` asks the API to convert that stored HTML on the way out; Markdown is not saved. Plain get success prints the content and nothing else. `--json` prints one line with `format`, `mediaType`, and `content`.

`pnpm factrove share <id>` creates a public link, or prints the existing one. Plain success prints that URL and whether the link is password protected. After a key rotation, sharing again mints a new unprotected link. `--revoke` removes it and prints a confirmation that does not include the token. `--json` prints `{ share: { shared, shareUrl, passwordProtected } }`. The owner can also use Share in the library or the viewer. Copy link copies the public URL while a share is on, and the private viewer URL otherwise.

`pnpm factrove list` prints the caller's artifacts, one per line: id, `private` or `org_shared`, then the library name. `--view org` lists organization-shared artifacts in the current organization. `--json` prints `{ items }` on one line. `pnpm factrove rename <id> --name <name>` changes that library name and leaves the HTML in place. Plain success prints `Renamed <id>.` `pnpm factrove delete <id>` removes the artifact, its stored HTML, and any public link. A terminal asks for confirmation. `--yes` and `--force` skip it, which is what an agent should pass. Plain success prints `Deleted <id>.` `--json` prints `{"deleted":true,"id":"…"}`. The CLI does not keep a local index, so delete does not edit a `factrove.md` file. In the web app, the owner can rename and delete from the library and the viewer. Delete asks for confirmation there too. Only the creator can rename or delete. An organization admin who did not create the artifact gets the same `404 ARTIFACT_NOT_FOUND` as a missing id.

A link can also need a password. `--password` prompts twice without echoing and needs a terminal. `--password-stdin` reads it from a pipe and removes one trailing newline. Either one sets or replaces the password and prints the same link. A protected link also says to revoke, then share again, if visitors are locked out. That status line does not set a password. Revoke clears the stored password, so share again with `--password` or `--password-stdin` to keep protection. `--remove-password` keeps the link and removes the password, or says so when the artifact is not shared or the link has no password. A password typed as an argument, such as `--password=secret`, is refused so it stays out of shell history. In the web app, the Public link panel has Add, Change, and Remove password, and tells the owner to revoke and share again after a lockout. That panel does not set a password. Revoke clears it, so set the password again when sharing. The viewer panel stays closed until the owner opens Sharing. Revoking a link also removes its password.

Creating an upload assigns a new id. `--name` sets the library name, one line of 1 to 120 characters. Omit it and the name is the file name without `.html` or `.htm`. A stem that is empty, longer than 120 characters, or not one line stores null, and the upload still succeeds. Replacing content keeps that id, the current name, the current access, and any existing share link. Pass `--name` with `--artifactId` to change the name. A replace that loses the revision check does not change the name. A lost acknowledgement can still land the new HTML and the name together, because they are one update. `--access` with `--artifactId` is an error. A replace can rarely return 500 after the new object is already committed. GET the artifact before retrying. Config precedence, the dev env file, and the differences from `aws s3` are in [docs/guides/cli.mdx](docs/guides/cli.mdx).

### Self-host with Docker Compose

`compose.yaml` is PostgreSQL and Garage for `pnpm dev`. [`docker-compose.yml`](docker-compose.yml) is the self-host stack: PostgreSQL, Garage, a one-shot migration, the API, and the web app. [`Dockerfile`](Dockerfile) has two targets, `api` and `web`, so both images share one workspace install. Node 24.16.0 and pnpm 11.25.0 match the pins in this repository.

```sh
cp .env.docker.example .env.docker
```

Replace every placeholder in `.env.docker`. `openssl rand -hex 32` generates a secret. Use that hex output as-is, because `@`, `:`, `/`, or `#` in the database password breaks `DATABASE_URL`. `GARAGE_RPC_SECRET` must be 64 hex characters. `BETTER_AUTH_SECRET` must be at least 32 characters. Do not commit `.env.docker`.

```sh
docker compose --env-file .env.docker -f docker-compose.yml up --build
```

`docker compose up` without `-f docker-compose.yml` still uses `compose.yaml` and does not start the API or the web app. Published ports bind to `127.0.0.1`. The web app is `http://localhost:3000`. The API health check is `http://localhost:3001/api/v1/health`. Add `-d` to leave the stack in the background. Every `.env.docker` variable, the reverse proxy, an external database or bucket, the CLI, upgrades, and backups are in [docs/guides/self-hosting.mdx](docs/guides/self-hosting.mdx).

Pushes to `main` also publish `linux/arm64` images at `ghcr.io/magnificode-ltd/factrove-api` and `ghcr.io/magnificode-ltd/factrove-web`. Tags are the full commit SHA, the 7-character short SHA, and `latest` from the default branch. The packages stay private while this repository is private. When the repository is open-sourced, each package is set to public in its package settings. Pulling them needs a token with `read:packages`. The EC2 read:packages token will be stored in AWS Secrets Manager, created by `factrove-cloud`. Image names, tags, and the pull commands are in [Published images](docs/guides/self-hosting.mdx#published-images).

The `migrate` service runs `prisma migrate deploy` and exits. The API process does not migrate on startup. Run the migration again with:

```sh
docker compose --env-file .env.docker -f docker-compose.yml run --rm migrate
```

Set `FACTROVE_MIGRATE=1` on the API container only when that container should migrate before it listens. Any other value leaves startup as it is.

`BROWSER_API_URL` is the origin the browser uses to call the API. The web server injects it when it renders a page, so one image works for any host. It must match the host and port you publish for the API. `INTERNAL_API_URL` is `http://api:3001` on this Compose network, which is the origin the Next.js server uses for its own requests. Changing either value does not require a rebuild. `pnpm build` and `next start` still keep `NEXT_PUBLIC_API_URL` from the build. `SOURCE_CODE_URL` is the URL of the Source code link. It defaults to `https://github.com/magnificode-ltd/factrove`. The web server reads it when it renders a page. Set it on the web process, or in `.env.docker` for Compose, when a fork should point at its own repository.

Garage is `http://garage:3900` on the Compose network, and it creates the bucket named by `S3_BUCKET` when it starts. The API sets `S3_ALLOW_INSECURE_HTTP=true` so that private-network HTTP endpoint is accepted. The access key is sent in cleartext. Leave the flag unset for localhost and for AWS.

`pnpm infra:down` stops PostgreSQL and Garage and keeps their data volumes. `pnpm infra:reset` stops the dev Compose project and deletes its PostgreSQL and Garage volumes. In a terminal it asks you to type `yes`. From a non-interactive shell, confirm with `pnpm infra:reset -- --yes`. That removes local metadata and local object bytes for the dev project. Objects in a real AWS bucket are outside these volumes and stay there. `pnpm e2e` deletes volumes only for its own Compose project, `factrove-e2e`.

Workspace checks:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
```

`pnpm e2e` checks that Docker is running and that Playwright Chromium is installed, builds the API and CLI, then starts Compose project `factrove-e2e`. That project has its own volumes. PostgreSQL is published on `127.0.0.1:5433`, Garage on `127.0.0.1:3910`, the web app on `127.0.0.1:3100`, and the API on `127.0.0.1:3101`. The dev project from `pnpm infra:up` keeps its volumes and ports. The script sets the Garage endpoint and credentials for the API and the S3 integration tests, removes `AWS_*` and `S3_*` overrides from those processes, and requires the effective endpoint to be loopback HTTP before any S3 call. `S3_INTEGRATION=1` does the same inside the integration tests. The default `pnpm test` still skips those files unless `S3_INTEGRATION=1`. When `pnpm e2e` exits, it restores `apps/web/next-env.d.ts` if Next.js rewrote it and removes the `factrove-e2e` project. Set `FACTROVE_E2E_SCREENSHOTS` to a directory to save screenshots of the password-protected link flow there. The script reads it from its own process environment, not from an `.env` file.

`pnpm --filter @factrove/web dev` and `pnpm --filter @factrove/api dev` still start one app at a time. `pnpm dev` is the command that runs them together.

## Troubleshooting

- **Container runtime unavailable.** `pnpm infra:up` exits when `docker` is missing or the daemon is stopped. Start Docker Desktop and run `pnpm infra:up` again.
- **Port 5432 is taken.** Another PostgreSQL is listening on `127.0.0.1:5432`. Stop it, or change the host port in [compose.yaml](compose.yaml) and `DATABASE_URL` together.
- **Port 3900 is taken.** Another process is listening on `127.0.0.1:3900`. Stop it, or change the Garage host port in [compose.yaml](compose.yaml) and `S3_ENDPOINT` together.
- **Port 3000 or 3001 is taken.** Stop the other process and run `pnpm dev` again. The web origin is `http://localhost:3000` and the API origin is `http://localhost:3001`.
- **`pnpm e2e` reports a taken port.** That command uses `127.0.0.1:5433` for PostgreSQL, `127.0.0.1:3910` for Garage, `127.0.0.1:3100` for the web app, and `127.0.0.1:3101` for the API. Stop the other process and run `pnpm e2e` again. The dev ports 5432, 3900, 3000, and 3001 stay with `pnpm infra:up` and `pnpm dev`.
- **The API stops on `BETTER_AUTH_SECRET`.** The value is missing or shorter than 32 characters. Set a local placeholder in `apps/api/.env`, then run `pnpm dev`.
- **Upload returns `STORAGE_UNAVAILABLE`.** The API could not write the object, and the failed upload leaves no artifact row. For Garage, run `pnpm infra:up` and match `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, and the access key in `apps/api/.env` to [compose.yaml](compose.yaml). For AWS, set `S3_BUCKET`, `S3_REGION`, and the credential chain, and leave `S3_ENDPOINT` unset. `S3_BUCKET=your-bucket` is an old placeholder.
- **The CLI reports `NETWORK_ERROR`.** The API origin is wrong or `pnpm dev` is not running. Precedence is `--endpoint-url` or `--api-url`, then `FACTROVE_API_URL`, then `FACTROVE_ENDPOINT_URL`, then the selected profile's `api_url` or `endpoint_url`, then a URL from `apps/cli/.env` when you use `pnpm factrove`, then `http://localhost:3001`.
- **The library says the API is unavailable.** The web app is using a different origin from the running API. Set `NEXT_PUBLIC_API_URL` in `apps/api/.env` or the environment, then restart `pnpm dev`. A production bundle from `pnpm build` keeps the origin from the build, so run `pnpm build` again after changing it. On the Docker web image, set `BROWSER_API_URL` to the origin the browser uses and `INTERNAL_API_URL` to the origin the Next.js server can reach. Those two are read at request time.

## Development

Runtime versions are pinned in [.nvmrc](.nvmrc), [.node-version](.node-version), and [pnpm-workspace.yaml](pnpm-workspace.yaml). The package-manager version and workspace commands are recorded in [package.json](package.json).

The build follows workspace dependency order. Shared packages expose compiled modules and declarations from `dist/`. `pnpm factrove` runs the compiled CLI. When `apps/cli/dist` is missing it tells you to run `pnpm --filter @factrove/cli build`. `pnpm dev` performs that build before starting the servers.

## Database changes

The persistence convention is a committed Prisma SQL migration history under `apps/api/prisma/migrations/`. Both schema changes (DDL) and data transformations (DML) belong in that history. The selected SQL migration workflow applies releases with `prisma migrate deploy`.

Applied migrations remain immutable; subsequent changes receive new migrations. Changes that require data conversion can use expansion, a DML backfill, an application cutover, and contraction across compatible releases. Local demo fixtures are populated by an explicit idempotent seed.

### Upgrade cutover for object keys

Stop writers before applying `20261021170000_add_artifact_object_key`. The migration locks `artifact`, and an API process from before this change cannot insert or replace content once `object_key` is required. There is no down migration. Rolling back after the cutover means stopping the old app processes, restoring the schema, and copying each current object back to `{artifactId}.html` so the row points at that key. New objects live at `{artifactId}/{contentId}.html`.

## Documentation

User guides and the generated CLI and API references live in [docs/](docs/introduction.mdx).

- [Quickstart](docs/quickstart.mdx): clone, local startup, and a first upload.
- [Self-hosting](docs/guides/self-hosting.mdx): Docker Compose install, published GHCR images, configuration, HTTPS, external storage, upgrades, and backups. The from-source process is the alternative in that guide.
- [CLI](docs/guides/cli.mdx): commands, precedence, and a copyable agent workflow.
- [Sharing links](docs/guides/sharing-links.mdx): public links, passwords, and lockout recovery.
- [Troubleshooting](docs/guides/troubleshooting.mdx): ports, secrets, storage, and cookie-origin failures.
- [MVP end state](prd/MVP_END_STATE.md): the agreed product target, models, behavior, and completion criteria.
- [Implementation task index](prd/README.md): task status, dependencies, and ownership.
- [Shared MVP contract](prd/mvp_contract.md): API, package interfaces, and local configuration.
- [Docs site maintenance](DOCUMENTATION.md): regenerate Mintlify references and preview locally. The pages themselves are the user documentation above.
- [Agent orientation](AGENTS.md): a concise guide to the codebase and its documentation.

## License

Copyright (C) 2026 Magnificode LTD. Factrove is released under the [GNU Affero General Public License v3.0](LICENSE) or any later version (`AGPL-3.0-or-later`). The copyright notice is in [NOTICE](NOTICE). If you run a modified version as a network service, you must offer its source to the people who use it. The web app shows a Source code link for that purpose, and `SOURCE_CODE_URL` points a fork at its own repository.

Factrove is not accepting outside pull requests yet; issues, bug reports, and feedback are welcome; outside pull requests will be closed without merging.

Contributors keep their copyright and license their contributions to Magnificode LTD under the [contributor license agreement](CLA.md), which includes the right to relicense those contributions. Signing steps are in [CONTRIBUTING.md](CONTRIBUTING.md).
