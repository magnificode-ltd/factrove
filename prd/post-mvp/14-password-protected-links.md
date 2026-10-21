# Post-MVP 14 — Password-protected links

## Goal

Let the owner put an optional password on a public share link. A visitor with the link sees a password page and gets no artifact content until the password checks out. This builds on [task 15](15-shareable-links.md) and keeps all of its guarantees: links are `{PUBLIC_BASE_URL}/share/{id}/{token}`, tokens are AES-256-GCM ciphertext bound to the artifact id and looked up by SHA-256 hash, rotating the key revokes links, public loads omit credentials and are rate limited, and every inactive link is the same 404.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), and [the shared contract](../mvp_contract.md). **Status: implemented in this change.**

## Owns

The `share_password_hash` column and its check, the owner password routes, the public unlock route, grants and content tickets, the password attempt limiter, the CLI password flags, the web password controls, and the visitor password page. No new environment variable. The grant key comes from the share-token key input.

## Behavior

- `POST /api/v1/artifacts/{id}/share` accepts no body or JSON `{ password }`. With a password it shares the artifact if needed, then sets or replaces the password. Without one it keeps the current password. `DELETE /share/password` removes the password and keeps the link. `DELETE /share` revokes the link and clears the password. Only the creator manages either. A non-JSON body is `400`. Passwords are 8 to 128 characters.
- Passwords are hashed with Argon2id from `node:crypto` (memory 19456 KiB, 2 passes, parallelism 1, 16-byte salt, 32-byte tag), stored as a PHC string. The plaintext is never stored or logged. Verification bounds the stored parameters, recomputes the tag, and compares with `timingSafeEqual`. Node 24.7 is the first release with `crypto.argon2`, so the engine floor is `>=24.7.0`.
- The share state, owner DTOs, and public detail include `passwordProtected`. The hash is never returned.
- Public detail on a protected link without a valid grant is `401 PASSWORD_REQUIRED`. Invalid, unshared, and revoked links stay `404 ARTIFACT_NOT_FOUND`, so the password page only appears for a live link.
- `POST /api/v1/public/artifacts/{id}/{token}/unlock` takes JSON `{ password }`. It charges a per-client bucket (10 attempts per 10 minutes, keyed like the view limit, IPv6 by /64) before the lookup and a per-share bucket (30 per 10 minutes) after the token matches. Both are separate from the view limiter, every attempt is charged, and refusal is `429 RATE_LIMITED`. A wrong password is `401 PASSWORD_INCORRECT`. A link without a password returns `{ grant: null }`.
- A correct password returns `{ grant: { token, expiresAt } }`. The grant is `g1.{exp}.{mac}`, valid for 15 minutes with 60 seconds of clock skew. The HMAC-SHA256 covers the artifact id, the share token hash, a SHA-256 fingerprint of the stored password hash, and the expiry. Its key is HKDF over `SHARE_TOKEN_KEY`, or `BETTER_AUTH_SECRET` when that is unset. A new password, including setting the same one again, has a new salt and fingerprint. Removing the password, revoking, or re-sharing changes the scope, and rotating the key changes the key. Existing grants stop working in all of these cases.
- Grant transport: the browser stores the grant in `sessionStorage` on the web origin, keyed by artifact id and bound to the token, and sends it in the `X-Factrove-Share-Grant` header on the credentials-omitted detail request. It is not a cookie, so it cannot ride along with other requests, and it is not in a URL, so it does not reach history, logs, or referrers. A new tab asks for the password again.
- The iframe cannot send headers. A granted detail therefore returns `contentUrl` with `?ticket=t1.{exp}.{nonce}.{mac}`, scoped like the grant, valid for 60 seconds, and redeemed at most 3 times per API process (preflight, a development double render, the frame load). The sandboxed document can read that ticket from its own URL, but the ticket expires within a minute and opens only the content that document already has. The document runs on the API origin without `allow-same-origin`, so it cannot read the parent's storage or the grant.
- Public CORS allows `POST, OPTIONS` on the unlock path and `GET, HEAD, OPTIONS` elsewhere, with credentials omitted and the grant header allowed.
- CLI: `share <id> --password` prompts twice on a terminal without echoing. `--password-stdin` reads stdin and removes one trailing newline. `--remove-password` removes it. A value given as an argument, such as `--password=secret`, is rejected. The password flags conflict with each other and with `--revoke`. No output includes the password.
- Web: the Public link panel shows the password state, with Add, Change, and Remove password. The input has a show and hide toggle and validates 8 to 128 characters. The visitor page shows the factrove wordmark and a lock card. A wrong password shakes the form, sets `aria-invalid`, and shows an alert. A correct one lifts the shackle and reveals the artifact. Motion is skipped under `prefers-reduced-motion`. An expired or invalidated grant returns the visitor to the form with a note.

## Verification

Unit tests cover the KDF (PHC format, salts, wrong passwords, tampered and out-of-bounds hashes), both throttle buckets, grant scope (artifact, token, password fingerprint, key, expiry, tampering), tickets, and the redemption ledger. HTTP tests cover protect and unlock, invalidation by change, removal, revoke, and key rotation, throttling, owner validation, CORS, and 404 versus 401 behavior. CLI tests cover stdin, the TTY requirement, inline-value rejection, conflicts, and removal. Web tests cover the password page versus the 404 notice, the wrong-password state, grant storage and reuse, throttling, and the owner controls. `pnpm e2e` sets a password through the CLI, checks the stored Argon2id hash, opens the link without a cookie, enters a wrong password and then the right one, checks that the grant is absent from the iframe URL and unreadable from the frame, exhausts a ticket, changes the password in the web UI, checks that the old grant fails, removes the password, re-protects the link, and revokes it to a 404.

## Exclusions

No per-recipient passwords, no expiring links, no password recovery or hint, no lockout notification, and no shared throttle across API processes. The object key stays `{artifactId}.html`.
