# Post-MVP 20 — Login, accounts, and API keys

## Goal

Replace the unauthenticated local actor with Better Auth email/password sessions, personal artifact ownership, and hashed API keys for the CLI. Private artifacts are readable only by their owner. Organization-shared artifacts are readable by members of the artifact's organization.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), and [the shared contract](../mvp_contract.md). **Status: implemented in this change.** The MVP outcome stays the historical unauthenticated loop. This task supersedes that actor.

## Owns

Runtime auth in `apps/api/src/auth/`, the Better Auth `apikey` migration, access checks on upload, list, get, and content, the web sign-in and API key pages, `factrove configure`, and the e2e sign-up, login, key, and owner-only checks.

The schema generator uses `plugins: [organization(), factroveApiKey()]`. Runtime auth mounts email/password and the API key plugin. It does not mount organization HTTP routes.

## Behavior

- Sign-up and sign-in use email and password at `/api/auth`. Email verification is off. There is no SSO. A session cookie is `SameSite=Lax` and `HttpOnly`.
- `BETTER_AUTH_SECRET` is required and at least 32 characters. It signs cookies and content grants.
- Collection routes without a session or API key return `401 UNAUTHENTICATED`. Get-by-id and content return `404 ARTIFACT_NOT_FOUND` for an unknown id and for a caller who cannot read the artifact, with the same body. A present invalid `Authorization` header does not fall back to a cookie.
- `private` is owner-only. `org_shared` is the owner or a member of `artifact.organizationId`. The current organization is the session's active organization when the user is a member, otherwise the user's only membership, otherwise null. API keys have no active organization.
- `org_shared` without a current organization is `400 ORGANIZATION_REQUIRED`.
- API keys are the Better Auth plugin `@better-auth/api-key` 1.7.7. They use the prefix `ftrv_`, are stored as unpadded base64url SHA-256 hashes, and are shown once in `key`. Create, list, and delete use `/api/auth/api-key/*` and require a browser session. A request with `Authorization` cannot manage keys, even when a session cookie is also present. Delete is `POST /api/auth/api-key/delete`. Another user's id is `404`.
- The sandboxed iframe still uses `allow-scripts` without `allow-same-origin`, and the content preflight omits credentials. `contentUrl` includes an HMAC `access` grant for that request. The grant is not an API key and is ignored when `Authorization` is present.
- `factrove configure` writes `~/.factrove/credentials` and `~/.factrove/config` for a profile. `FACTROVE_API_KEY` overrides the file. `--profile` overrides `FACTROVE_PROFILE`. The command does not print the key.

## Verification

API integration tests sign up an owner, store a membership, and call the existing upload, list, content, and Markdown cases with that API key. They also check anonymous `404`, a second account's `404`, hashed storage, revocation, and the content grant.

`pnpm e2e` signs up and signs in in the browser, creates a key, configures a profile from stdin, uploads with that profile, checks owner-only reads, and checks that revoking the key makes the next upload fail. Garage storage and content tests stay in that run. Real AWS is not called.

## Exclusions

No SSO, no organization administration UI, no invitations, no per-recipient sharing, and no change to the `{artifactId}.html` storage key.
