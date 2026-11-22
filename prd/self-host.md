# Self-host

## Purpose

This repository is the product you run yourself. PostgreSQL holds metadata. One S3-compatible bucket holds artifact bytes. A hosted service, Factrove Cloud, runs the same product. This tree does not configure that service. Instance URLs and the sender address come from environment variables.

## Current behavior

Local setup is pinned Node and pnpm, a container runtime, and:

```sh
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm infra:up` starts PostgreSQL and Garage on loopback and creates the local bucket. `pnpm infra:down` stops them and keeps the volumes. `pnpm db:migrate` applies the committed Prisma SQL history. `pnpm db:seed` is idempotent. `pnpm dev` runs the web app and the API. The web origin defaults to `http://localhost:3000`. The API listens on `127.0.0.1` port 3001, and `API_PUBLIC_ORIGIN` defaults to `http://localhost:3001`. A second terminal runs `pnpm factrove`.

Application settings for the API and the web app belong in `apps/api/.env`, copied from `apps/api/.env.example`. CLI settings belong in `apps/cli/.env.example`. The API holds `DATABASE_URL` and the storage settings in [storage.md](storage.md). Web and CLI hold HTTP origins and, for the CLI, an API key. They do not hold database, storage, or auth-secret credentials.

`WEB_ORIGIN`, `API_PUBLIC_ORIGIN`, and `PUBLIC_BASE_URL` are absolute `http` or `https` origins. `PUBLIC_BASE_URL` builds viewer URLs and public share links and defaults to `WEB_ORIGIN`. `NEXT_PUBLIC_API_URL` is the browser's API origin. `pnpm dev` and `pnpm build` copy it from the application env file when the variable is unset, and a production client bundle keeps the value from the build. On the Docker web image, `BROWSER_API_URL` is the origin the browser uses and `INTERNAL_API_URL` is the origin the Next.js server can reach. Both are read at request time.

`SOURCE_CODE_URL` is the absolute URL for the Source code link. Unset, the link is this repository. `DOCS_BASE_URL` is the base URL for docs links in the web app. Unset or empty, those links use the published docs site. `pnpm dev` does not copy either value from the application env file.

`POSTHOG_KEY` and `POSTHOG_HOST` are optional web analytics settings, read when a page renders. `pnpm dev` does not copy them from the application env file. Unset or invalid `POSTHOG_KEY` does not load `posthog-js` and does not send analytics requests. A valid key is a public `phc_` project key. `POSTHOG_HOST` is an absolute http(s) origin and defaults to `https://us.i.posthog.com`. Analytics keeps state in memory, does not set a cookie, and does not show a banner. It records pageviews and route changes. Autocapture, session recording, surveys, and exception capture stay off. Feature flags and the decide endpoint are not requested. Do Not Track skips loading the library. Captured URLs drop the query and the hash, and replace artifact ids, share tokens, file names, and other long or secret path segments with `:id`. Events do not include page titles, artifact content, artifact or file names, share passwords, Factrove API keys, email addresses, or account names. Each event still carries the public PostHog project key. The client does not call identify. The hosted Factrove Cloud web app can set the key. This repository does not record that key or any other Cloud runtime.

The API binds `HOST` `127.0.0.1` by default. Auth cookie, share-token, email, and proxy settings are in [auth.md](auth.md) and [sharing.md](sharing.md). `BETTER_AUTH_SECRET` is required before the API serves. The committed example is a local placeholder.

`pnpm db:seed` creates `local-user` (`local@example.invalid`, no password, no membership) and `local-org` (slug `local`). That user cannot sign in. `pnpm db:claim-local-artifacts -- --email …` attaches that user's artifacts to an account that already has a password and exactly one organization. See [organizations.md](organizations.md).

The published CLI defaults to `https://api.factrove.app` when no flag, environment variable, profile, or checkout env file sets an origin. A server you run sets its own origin earlier in the precedence in [cli.md](cli.md). Docs may use `factrove.app` as the hosted example. Runtime code, config defaults, env examples, and Compose files do not hardcode a Factrove Cloud web origin, a server-side Cloud API host, or a Cloud support address.

Deploy, HTTPS, upgrades, and backups for a server you run are [docs/self-host/deploy.mdx](../docs/self-host/deploy.mdx). Configuration of the env files is [docs/self-host/configuration.mdx](../docs/self-host/configuration.mdx).

## Decisions

Schema changes and data transformations share one committed migration history. Applied migrations stay immutable. Local demo fixtures are an explicit seed, not a migration.

`localhost` can resolve to `::1` while the servers bind `127.0.0.1`. Browser and CLI origins have to reach the address that is actually listening. `WEB_ORIGIN` and `PUBLIC_BASE_URL` stay on the same host so the session cookie and the viewer links agree.

One installation is one database and one bucket. The API process is the only holder of those credentials.
