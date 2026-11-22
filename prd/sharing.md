# Sharing

## Purpose

The creator of an artifact can publish one public link. Anyone with the link can read the HTML. The link can require a password. Organization visibility is `org_shared` on the artifact, specified in [artifacts.md](artifacts.md). A public link is a separate step and is left in place when access changes or content is replaced.

## Current behavior

`POST /api/v1/artifacts/{id}/share` creates a link or returns the existing one. An optional `{ "password" }` sets or replaces the password. Omitting the password keeps the current one. `DELETE .../share` clears the token and the password. `DELETE .../share/password` clears the password and keeps the same link. `GET .../share` returns `{ shared, shareUrl, passwordProtected }` for the creator. The raw token appears only as `shareUrl`, which is `PUBLIC_BASE_URL/share/{id}/{token}`. List and detail JSON set `shared` and `passwordProtected` and do not include the token.

Only the creator can read or change the share. Another member, including someone who can read an `org_shared` artifact, receives `404 ARTIFACT_NOT_FOUND`. A request with no credentials is `401 UNAUTHENTICATED` before the artifact is loaded.

`GET /api/v1/public/artifacts/{id}/{token}` needs no session. The body is the filename, name, size, upload time, a content URL, and `passwordProtected`. It omits the creator, organization, access type, and share URL. HTML uses the same sandbox policy as a signed-in viewer. Markdown is not offered. An invalid id, an invalid token, an unshared artifact, a revoked token, a missing upload time, and an unmatched path under `/api/v1/public` all return the same `404 ARTIFACT_NOT_FOUND` body. Public responses send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. A `/share` URL whose id or token has the wrong shape is HTTP 404. The share page loads this detail from the browser with credentials omitted.

A password is 10 to 128 NFC characters, at least four distinct characters, not all whitespace, and not a common password from the bundled list. It is stored as an Argon2id PHC string (`artifact.share_password_hash`): 19 MiB, 2 passes, parallelism 1, a 16-byte salt, and a 32-byte tag. The parameters live in the PHC string, so a later parameter change still verifies old hashes. A check requires a share hash whenever a password hash is set. Detail on a protected link without a valid grant is `401 PASSWORD_REQUIRED`. An inactive link stays the uniform 404, so the password form does not confirm that a dead link existed. A wrong password is `401 PASSWORD_INCORRECT`.

A correct password returns a grant, `g1.{expiry}.{HMAC-SHA256}`, valid for 15 minutes. The HMAC covers the artifact id, the share token hash, a fingerprint of the stored password hash, and the expiry. The browser keeps it in `sessionStorage` and sends `X-Factrove-Share-Grant` on the credentials-omitted detail request. It is not a cookie and not part of a URL. The granted detail returns a `contentUrl` with a `ticket` query, valid for 60 seconds and honored at most 3 times per API process, because the sandboxed iframe cannot send headers. Content on a protected link without a valid ticket is `401 PASSWORD_REQUIRED`. A password change, a revoke, a new share token, or a key rotation invalidates existing grants. There is no grant table.

Public views are limited to 60 requests per 60 seconds per client address, in memory and per process. A page view counts the detail request and up to two content requests in the following 30 seconds. The password budgets are separate: 10 client failures per 10 minutes, refunded after a match or an infrastructure failure, and 30 wrong passwords per 10 minutes for that share token hash. Exhausting the share budget is `429 RATE_LIMITED` with `Retry-After` and no hash verification. Revoking and sharing again mints a fresh share budget. Every verify also spends 20 per minute and 100 per 10 minutes per address. One address may run one verify at a time. A saturated Argon2 gate is `503 UNLOCK_UNAVAILABLE`. IPv6 addresses share a bucket by their /64. `TRUSTED_PROXIES` is what lets the API see the visitor behind a proxy. See [self-host.md](self-host.md).

## Decisions

The token is 32 random bytes, encoded as unpadded base64url. The row stores AES-256-GCM ciphertext plus the SHA-256 hash of the token as hex. Lookup uses the hash, checks the artifact id, then decrypts. The artifact id is additional authenticated data. The key is `SHARE_TOKEN_KEY` when set (at least 32 characters) and otherwise HKDF over `BETTER_AUTH_SECRET`. Rotating that input makes existing public URLs return 404, and `shared` becomes false until the creator shares again. The ciphertext and the hash are both null or both set. Application logs do not record the token. When the current key cannot read a stored token, `GET` share reports it as not shared, and the next `POST` mints a new token.

`POST` returns the same token while the current key can still read it. Sharing again after revoke mints a new token. The previous URL stays 404. Replacing HTML keeps the token, so the existing link serves the new bytes.

The public unlock route ignores a leftover session cookie and does not use the cookie-origin guard. Owner writes still do. `/api/v1/public` allows the configured browser origins without credentials. The unlock route allows POST. Other public methods are GET, HEAD, and OPTIONS.

Someone who has the link and keeps failing can lock that link for up to ten minutes. The creator recovers by revoking and sharing again.

## Open items

A link for one named person, separate from a public token and from `org_shared`, is not part of this feature.
