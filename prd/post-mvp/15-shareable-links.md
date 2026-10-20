# Post-MVP 15 — Shareable links

## Goal

Let the owner share an artifact with someone who does not have an account, using a link built from a configured base URL. Factrove does not start a server or publish the app as part of this feature. If the base URL is localhost, the link uses localhost. If it is `https://factrove.app`, the link uses that domain plus the artifact id.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), and [the shared contract](../mvp_contract.md). **Status: implemented in this change.** Password protection and versioning are separate later tasks.

## Owns

`PUBLIC_BASE_URL` in the API environment, the share columns on `artifact`, owner share and revoke routes, anonymous public HTML routes, the CLI `share` command, and the web Share control. Embeds reuse this base URL later. They are not implemented here.

## Behavior

- `PUBLIC_BASE_URL` defaults to `WEB_ORIGIN` when unset or blank. It must be an absolute `http` or `https` origin with no credentials, path, query, or hash. A trailing slash and an uppercase host normalize to the origin. Viewer URLs, CLI upload output, and Copy link all use it. `frame-ancestors` allows that origin, and also `WEB_ORIGIN` when the two differ. Session writes are accepted from both. When the hosts differ, `AUTH_COOKIE_DOMAIN` must cover `PUBLIC_BASE_URL` or the API refuses to start. Better Auth trusts both origins.
- Artifacts stay private until the owner shares them. `accessType` is unchanged by a public share.
- The public path is `{PUBLIC_BASE_URL}/share/{artifactId}/{token}`. The token is 32 random bytes encoded as unpadded base64url (43 characters). The artifact id already appears in private viewer URLs, CLI output, and the library, so the id alone is not the share secret. The row stores AES-256-GCM ciphertext so the owner can copy the link again, and stores the SHA-256 hash as the public lookup key. `SHARE_TOKEN_KEY` supplies the key when set. Otherwise the key is derived from `BETTER_AUTH_SECRET`. Rotating that input invalidates existing links. Public queries use the hash alone and then compare the id. `findShared` does not select the ciphertext. A check requires both columns to be null or both to be set.
- `POST /api/v1/artifacts/{id}/share` is idempotent. `DELETE` clears the token and the hash. Sharing again mints a new token. The previous URL is `404`. Only the creator can manage the share. A member who can read the artifact gets the same `404` as a missing id. A request with no credentials is `401` before the row is loaded.
- Anonymous `GET /api/v1/public/artifacts/{id}/{token}` returns id, filename, media type, size, upload time, and the public content URL. It omits the creator, organization, and share URL. Content is HTML only and keeps the sandboxed iframe and CSP. The browser loads that detail with credentials omitted. Invalid, unshared, revoked, and not-yet-uploaded links return one `404 ARTIFACT_NOT_FOUND` body, including unmatched public paths. Those responses send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. The page says "This artifact does not exist." It does not say the link was revoked, does not offer sign-in, and does not offer a link back to the library. `/api/v1/public` CORS omits credentials and allows GET, HEAD, and OPTIONS only.
- Public views allow 60 requests per 60 seconds per visitor address, in memory, on each API process. Expired entries are removed, the map is capped, and IPv6 is keyed by /64. Behind a proxy, `TRUSTED_PROXIES` must list that proxy. A missing address shares one bucket. The limit includes requests that 404. The response is `429 RATE_LIMITED`. Logs for a failed share store a Prisma code and a static message. They do not include the token.
- The CLI command is `pnpm factrove share <id> [--revoke] [--json]`. Plain success prints the URL. Revoke prints `Revoked the public link for {id}.` The web library and viewer use the same Share, Copy link, and Stop sharing actions.

## Verification

Unit tests cover token shape, ciphertext, link builders, framing origins, IPv6 /64 buckets, and limiter eviction. HTTP tests cover create, the stored ciphertext, open while logged out, revoke, rotation, a non-owner, a session share from a different public origin, public CORS without credentials, and a mutated `PUBLIC_BASE_URL`. The production rate-limit test gives two visitor addresses separate buckets. `pnpm e2e` shares a live artifact, opens it from the browser without a cookie, copies the link, revokes it, and checks that the old URL stays a 404.

## Exclusions

No password on the link, no version history, no embed snippet, no hosting, and no change to the object key. The key remains `{artifactId}.html`.
