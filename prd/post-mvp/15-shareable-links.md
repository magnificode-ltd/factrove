# Post-MVP 15 — Shareable links

## Goal

Let the owner share an artifact with someone who does not have an account, using a link built from a configured base URL. Factrove does not start a server or publish the app as part of this feature. If the base URL is localhost, the link uses localhost. If it is `https://factrove.app`, the link uses that domain plus the artifact id.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), and [the shared contract](../mvp_contract.md). **Status: implemented in this change.** Password protection and versioning are separate later tasks.

## Owns

`PUBLIC_BASE_URL` in the API environment, the share columns on `artifact`, owner share and revoke routes, anonymous public HTML routes, the CLI `share` command, and the web Share control. Embeds reuse this base URL later. They are not implemented here.

## Behavior

- `PUBLIC_BASE_URL` defaults to `WEB_ORIGIN` when unset or blank. It must be an absolute `http` or `https` origin with no credentials, path, query, or hash. Viewer URLs, CLI upload output, and Copy link all use it. CORS and `frame-ancestors` allow that origin, and also `WEB_ORIGIN` when the two differ. Cookie writes still require `WEB_ORIGIN`.
- Artifacts stay private until the owner shares them. `accessType` is unchanged by a public share.
- The public path is `{PUBLIC_BASE_URL}/share/{artifactId}/{token}`. The token is 32 random bytes encoded as unpadded base64url (43 characters). The artifact id already appears in private viewer URLs, CLI output, and the library, so the id alone is not the share secret. The row stores the token so the owner can copy the link again, and stores the SHA-256 hash as the public lookup key. Public queries do not use the raw token as a predicate, and `findShared` does not select it.
- `POST /api/v1/artifacts/{id}/share` is idempotent. `DELETE` clears the token and the hash. Sharing again mints a new token. The previous URL is `404`. Only the creator can manage the share. A member who can read the artifact gets the same `404` as a missing id. A request with no credentials is `401` before the row is loaded.
- Anonymous `GET /api/v1/public/artifacts/{id}/{token}` returns id, filename, media type, size, upload time, and the public content URL. It omits the creator, organization, and share URL. Content is HTML only and keeps the sandboxed iframe and CSP. Invalid, unshared, and revoked links return one `404 ARTIFACT_NOT_FOUND` body. The page says "This artifact does not exist." It does not say the link was revoked and does not offer sign-in.
- Public views allow 60 requests per 60 seconds per `x-factrove-client-ip`, after the API replaces any caller-supplied value. A missing address shares one bucket. The limit includes requests that 404. The response is `429 RATE_LIMITED`. Logs for a failed share store a Prisma code and a static message. They do not include the token.
- The CLI command is `pnpm factrove share <id> [--revoke] [--json]`. Plain success prints the URL. Revoke prints `Revoked the public link for {id}.` The web library and viewer use the same Share, Copy link, and Stop sharing actions.

## Verification

Unit tests cover token shape, link builders for localhost and a domain, framing origins, and the rate-limit window. HTTP tests cover create, open while logged out, revoke, rotation, a non-owner, and a mutated `PUBLIC_BASE_URL` of `https://factrove.app` and `http://localhost:4000`, including CSP and CORS. The production rate-limit test uses the assigned client IP and ignores a spoofed forwarding header. `pnpm e2e` shares a live artifact, opens it logged out, copies the link, revokes it, and checks that the old URL stays a 404.

## Exclusions

No password on the link, no version history, no embed snippet, no hosting, and no change to the object key. The key remains `{artifactId}.html`.
