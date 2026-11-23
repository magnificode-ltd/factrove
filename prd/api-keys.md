# API keys

## Purpose

An API key lets the CLI and other clients call the product API as a member of one organization. The secret is shown once. The browser session is what creates and deletes keys.

## Current behavior

Keys use `@better-auth/api-key` at the same Better Auth version as the rest of auth. `apikey.referenceId` is the organization id. Metadata stores `{ "createdByUserId", "createdByMemberId" }`. `createdByUserId` is the session user. `createdByMemberId` is that user's `member.id` in the active organization at creation. The server writes both. A client-supplied organization id, user id, or membership id is ignored, and an update cannot change the metadata. The migration `20261115200000_org_owned_api_keys` deletes every key that existed before that ownership change. Those secrets no longer work. Migration `20261123140000_invitation_tokens_and_api_key_creator` writes `createdByMemberId` only when that field is absent and `createdByUserId` has exactly one membership in the key's organization. A stored membership id stays as it is while that row is still the creator's membership in the key's organization. When the stored id does not match that pair, the key is invalidated: `enabled` is false and the stored digest is replaced, so the secret no longer authenticates. A membership created later does not receive that digest, including when the migration runs again.

Create, list, and delete are `POST /api/auth/api-key/create`, `GET /api/auth/api-key/list`, and `POST /api/auth/api-key/delete`. They require a browser session in an organization. A request that also sends `Authorization` is `401` with message `API key management requires a browser session.` and does not use the session cookie. A missing organization is `403 ORGANIZATION_SETUP_REQUIRED`. Several memberships and no active organization is `409 ORGANIZATION_SELECTION_REQUIRED`. Any member of the active organization can list, create, and delete its keys. A key owned by another organization is `404`.

The create body is `{ "name" }`. The name is required, 1 to 32 characters. The secret is returned once in `key`, prefixed `ftrv_`. List responses include the name and the starting characters, not the secret. The plugin stores a SHA-256 digest as unpadded base64url. Keys do not expire, and a caller cannot set an expiry. The plugin's own per-key rate limit is off, so a CLI session is not capped at ten requests per day.

Product routes accept `Authorization: Bearer <key>`. They do not accept `x-api-key`. On use, the actor's user is the creating user, and the actor's organization is the key's organization. When `createdByMemberId` is present, it must still be that user's row in that organization. When it is absent, which is how a key created by the previous process during rollout is stored, the actor writes the creator's single current membership in the key's organization and then requires that row. The write happens only while the field is absent. Zero memberships or more than one leaves the metadata unchanged and the request is `401 UNAUTHENTICATED`. A stored id that does not match that row is also `401 UNAUTHENTICATED`, and the actor does not replace it with a newer membership. Deleting the membership and inserting a new one does not revive the key, because the new row has a new id. Upload through the key stores that organization id and that creating user as `creator_user_id`. The key can list, read, and change artifacts only in that organization. A session can still use an artifact that person created in any organization they belong to.

The web page is `/account/api-keys`. `factrove configure` stores a key the person already created. There is no organization flag on the CLI. A configured key means the organization it was created for.

## Decisions

A key cannot follow the user into another organization. `referenceId` stays the organization that owned it at creation. `createdByMemberId` stays the membership that created it. Deleting a key makes it fail closed. Managing keys is a browser-session action so the secret is not accepted as its own management credential.
