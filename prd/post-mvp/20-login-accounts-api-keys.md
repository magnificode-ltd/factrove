# Post-MVP 20 — Login, accounts, and API keys

## Goal

Replace the unauthenticated local actor with Better Auth email/password sessions, personal artifact ownership, and hashed API keys for the CLI. Private artifacts are readable only by their owner. Organization-shared artifacts are readable by members of the artifact's organization.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), and [the shared contract](../mvp_contract.md). **Status: implemented in this change.** The MVP outcome stays the historical unauthenticated loop. This task supersedes that actor.

## Owns

Runtime auth in `apps/api/src/auth/`, the Better Auth `apikey` migration, access checks on upload, list, get, and content, the web sign-in and API key pages, `factrove configure`, and the e2e sign-up, login, key, and owner-only checks.

The schema generator uses `plugins: [organization(), factroveApiKey()]`. Runtime auth mounts email/password and the API key plugin. It does not mount organization HTTP routes.

## Behavior

- Sign-up and sign-in use email and password at `/api/auth`. Email verification is off. There is no SSO. A session cookie is `SameSite=Lax` and `HttpOnly`. Sign-in and sign-up are rate limited in every environment: 10 requests per 60 seconds. `AUTH_COOKIE_DOMAIN` sets the session cookie domain when the web app and API are on different hosts. Leave it unset on localhost.
- `BETTER_AUTH_SECRET` is required and at least 32 characters. It signs cookies. Content grants use an HMAC subkey derived from that secret. Better Auth is mounted once, in `configureHttpApp`.
- Collection routes without a session or API key return `401 UNAUTHENTICATED`. Get-by-id and content return `404 ARTIFACT_NOT_FOUND` for an unknown id and for a caller who cannot read the artifact, with the same body. A present invalid `Authorization` header does not fall back to a cookie.
- `private` is owner-only. `org_shared` is the owner or a member of `artifact.organizationId`. The current organization is the session's active organization when the user is a member, otherwise the user's only membership, otherwise null. API keys have no active organization.
- `org_shared` without a current organization is `400 ORGANIZATION_REQUIRED`.
- API keys are the Better Auth plugin `@better-auth/api-key` 1.7.7. They use the prefix `ftrv_`, are stored as unpadded base64url SHA-256 hashes, and are shown once in `key`. Create, list, and delete use `/api/auth/api-key/*` and require a browser session. A request with `Authorization` cannot manage keys, even when a session cookie is also present. Delete is `POST /api/auth/api-key/delete`. Another user's id is `404`.
- The sandboxed iframe still uses `allow-scripts` without `allow-same-origin`, and the content preflight omits credentials. A session detail read appends an HMAC `access` grant to `contentUrl`. The grant lasts at most five minutes, is HTML-only, and is ignored when `Authorization` or `x-api-key` is present. List, upload, and API-key responses omit it. `x-api-key` is not a credential.
- Cookie-authenticated writes require `Origin`, or else `Referer`, to equal `WEB_ORIGIN`. Anything else is `403 FORBIDDEN`. `Authorization` skips that check.
- `factrove configure` writes `~/.factrove/credentials` and `~/.factrove/config` for a profile. Credential files are mode 0600, written through a private temporary file and rename. Directories created for those files are mode 0700, and an existing parent directory keeps its mode. An explicit `--profile` uses that profile's key and ignores `FACTROVE_API_KEY`. Otherwise `FACTROVE_API_KEY` overrides the file. `--profile` overrides `FACTROVE_PROFILE`. The command does not print the key.
- Artifacts created before sign-in stay owned by seeded `local-user`. `pnpm db:claim-local-artifacts -- --email you@example.com` assigns those artifacts to an account that has a password, keeps their ids, and adds memberships for the organizations they reference. The seeded user still has no password. A logged-out viewer link checks `GET /api/v1/context` before treating an artifact `404` as missing, and sign-in returns to that artifact path. Anonymous artifact reads stay `404`. The API keys page sends a signed-out caller to `/login?next=/account/api-keys`.

## Verification

API integration tests sign up an owner, store a membership, and call the existing upload, list, content, and Markdown cases with that API key. They also check anonymous `404`, a second account's `404`, hashed storage, revocation, and the content grant. An upgrade case inserts artifacts owned by `local-user`, shows that a new account cannot read them, then claims them and reads the same ids.

`pnpm e2e` signs up and signs in in the browser, creates a key, configures a profile from stdin, uploads with that profile, checks owner-only reads, opens an existing artifact while logged out, returns to it after sign-in, and checks that revoking the key makes the next upload fail. Garage storage and content tests stay in that run. Real AWS is not called.

## Exclusions

No SSO, no organization administration UI, no invitations, no per-recipient sharing, and no change to the `{artifactId}.html` storage key.
