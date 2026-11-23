# Auth

## Purpose

People sign in with email and password. The browser session is the credential for the web app. Agents and scripts use an API key, specified in [api-keys.md](api-keys.md). There is no SSO and no CLI login command.

## Current behavior

Better Auth is mounted at `/api/auth` with the official Prisma adapter for PostgreSQL. Email and password are enabled. `requireEmailVerification` is false, and `autoSignIn` is true. Sign-up creates a user and no organization membership. The next step is [organizations.md](organizations.md).

A successful sign-up sends one verification email to the new address. That message also welcomes the person. The link is `WEB_ORIGIN/verify-email?token=...` and lasts one hour. When sign-up started from an invitation, the link also carries `next` set to a same-origin `/invites/accept` path. `/verify-email` returns there after the address is confirmed, and the app does not ask that person to name an organization while that invitation still previews. A leftover path from an invitation that is no longer valid does not follow an ordinary sign-up. An off-site or protocol-relative callback is dropped, and the link stays token-only. Sign-in is allowed before the address is confirmed, and existing accounts are not emailed. Resend is limited to 3 requests per 60 seconds. A resend from the invitation keeps the same return path. A duplicate address does not send another message.

Forgot password sends one reset email when the address exists. The link is `WEB_ORIGIN/reset-password?token=...` and lasts one hour. The web confirmation is the same when the address is missing. The new password is 8 to 128 characters and must not be a common password. A successful reset deletes every existing session for that account. Requesting a reset is limited to 3 per 60 seconds. Submitting a reset is limited to 10 per 60 seconds. The sender is not awaited, so a slow provider does not change the response time between an address that exists and one that does not. The stored verification identifier is a hash of `reset-password:` plus the token, so `verification.identifier` does not contain the token. Migration `20261122120000_delete_plaintext_password_reset_tokens` deletes older plaintext reset-password rows, and those links stop working.

Signup can require a Cloudflare Turnstile token. `TURNSTILE_SECRET_KEY` on the API turns the check on. Unset or blank skips it, and a `turnstileToken` in the body is ignored. When the secret is set, `POST /api/auth/sign-up/email` reads that field and posts `secret`, `response`, and `remoteip` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. `remoteip` is the client address already stored in `x-factrove-client-ip`, and it is omitted when that address is missing. The call times out after 5 seconds and does not follow redirects. A missing, blank, oversized, or rejected token is `400` with code `CAPTCHA_FAILED`. A timeout, a network error, a non-JSON body, an HTTP error, or Siteverify `internal-error` is `503` with code `CAPTCHA_UNAVAILABLE` and `Retry-After: 1`. The secret is not logged. Sign-in, password reset, and invitation accept do not call Siteverify. An invitation that creates an account uses this same signup route, so the token is required there too when the secret is set. `TURNSTILE_SITE_KEY` is the public site key. The web process reads it when it renders `/signup`. Unset or invalid, the form does not show a widget and does not send a token.

The stored address is lower case and keeps a plus tag. Sign-in and sign-up allow 10 requests per 60 seconds in every environment. Before routing, the API deletes any incoming `x-factrove-client-ip` and sets that header from the socket address. Public paths are classified from the URL pathname, so an absolute-form request target is included. Better Auth reads only that header. When the peer matches `TRUSTED_PROXIES` (comma-separated IP addresses or CIDR ranges), the header is the right-most untrusted hop of `X-Forwarded-For`. Any other peer is the client, and `X-Forwarded-For` is ignored. Leave `TRUSTED_PROXIES` unset when clients connect directly.

`EMAIL_TRANSPORT` selects `log`, `smtp`, or `brevo`. Unset transport logs the message and does not send it. `smtp` uses the configured SMTP server. `brevo` posts to the Brevo HTTP API. `EMAIL_FROM_ADDRESS` is required for `smtp` and `brevo`. With `log`, an unset address uses `no-reply@localhost`. The from name defaults to Factrove. The footer link uses `WEB_ORIGIN`. The log transport redacts the link query unless `EMAIL_LOG_LINKS=full` and `NODE_ENV` is not `production`.

`BETTER_AUTH_SECRET` is required and must be at least 32 characters. It signs session cookies. Content grants use a separate HMAC subkey derived from it. Share-token encryption uses `SHARE_TOKEN_KEY` or a different derivation of the same secret. See [sharing.md](sharing.md).

The session cookie is host-only unless `AUTH_COOKIE_DOMAIN` is set. The browser then sends that cookie to every subdomain of the value, so the value is the narrowest parent that covers the hosts. Startup rejects an IP address, a public suffix, and a domain that is not the host of both `WEB_ORIGIN` and `API_PUBLIC_ORIGIN` or a parent of both. Leave it unset on localhost. `localhost` and `127.0.0.1` are different hosts, and a cookie domain cannot cover either, so `WEB_ORIGIN` and `PUBLIC_BASE_URL` use the same one. When `PUBLIC_BASE_URL` is a different domain from `WEB_ORIGIN`, startup requires `AUTH_COOKIE_DOMAIN` to cover `WEB_ORIGIN`, `API_PUBLIC_ORIGIN`, and `PUBLIC_BASE_URL`. The web server forwards the browser `Cookie` header to the API.

A write that authenticates with a session cookie requires `Origin` to be `WEB_ORIGIN` or `PUBLIC_BASE_URL`. When `Origin` is absent, the `Referer` origin is used. A missing or different origin is `403 FORBIDDEN`. A request that sends `Authorization` is not cookie-authenticated and skips this check.

Product routes accept the session cookie or `Authorization: Bearer`. They do not accept `x-api-key` as a credential. A present `Authorization` or `x-api-key` header disables the content grant. `GET /api/v1/health` is public. `GET /api/v1/context` returns the signed-in user and the current organization, or null when the caller has none.

## Decisions

The welcome email is a welcome email. It is not an organization invitation. There is no organization-member invite route.

The API does not impersonate a configured local user. The seeded `local-user` row has no password and cannot sign in. See [self-host.md](self-host.md).

Better Auth telemetry is off.
