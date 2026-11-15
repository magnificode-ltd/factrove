# Organizations before billing

Status: Tom decided on November 15, 2026 ([FCT-81](https://linear.app/magnificode/issue/FCT-81/organizations-every-signed-in-user-belongs-to-an-org-before-billing)). This document is the build plan. It blocks [FCT-79](https://linear.app/magnificode/issue/FCT-79/paddle-billing-integration-for-factrove-cloud-in-ee-folder). Billing stays deferred until this ships.

This work is in the AGPL core (`apps/api`, `apps/web`, `apps/cli`, `packages/contracts`, `docs/`). It does not add `ee/`, Paddle, or a feature flag. A self-host install gets the same organization requirement as Factrove Cloud. Cloud billing will later attach to the organization this work creates.

## Decisions

1. Signup and sign-in stay as they are. A signed-in user with no organization must create and name one before any product route works. The guard returns `403 ORGANIZATION_SETUP_REQUIRED` until then.
2. A data migration creates one organization for every existing user who has none, named after the user, with that user as owner, and sets it active on their sessions. Skip `local-user`. The slug is server-generated, unique, and immutable.
3. API keys belong to an organization. Record the creating user for audit. The API-key migration deletes every existing key. Old keys stop working and must be recreated.
4. First organization only. The owner can rename the display name. No invites, members page, switcher, or delete. The schema still allows several memberships.
5. The owner will manage billing later. Admin will manage members later. A member will use the product. This work writes a single role, `owner`.
6. The user does not type a slug.
7. `artifact.organization_id` is required on every new write, including private. The backfill fills old nulls from the creator's organization. `creator_user_id` stays the person.
8. `claim-local-artifacts` points claimed artifacts at the destination account's only organization and adds no membership.
9. The guard still applies to a session with no resolvable active organization.

## What main does today

Before this work:

- Better Auth 1.7.7. Email and password at `/api/auth`. `requireEmailVerification` is false. `autoSignIn` is true. Signup sends the existing welcome email and does not create a membership. That email is not an organization invitation.
- The organization plugin is in `auth-schema.config.ts` only. Runtime `create-auth.ts` does not mount it. `session.activeOrganizationId` is a server-only extra field. The column already exists. The first pull request mounts the plugin and removes that duplicate field.
- `ActorService` returns an organization when the session's active id is a real membership, otherwise when the user has exactly one membership. Zero memberships, or more than one with no valid active id, yield `organization: null`. API keys pass no active id, so they use the single-membership rule. `apikey.referenceId` is the user id.
- There is no `factrove login`. The CLI stores a key from `factrove configure`. Keys are created in the browser.
- `artifact.organization_id` is nullable. Upload writes the current organization id or null. `org_shared` requires an id. Private artifacts with an id stay out of the organization list. Rename and delete stay creator-only.
- `member.userId` is not unique. `pnpm db:seed` upserts `local-user` (no password) and `local-org` (slug `local`) and does not insert a membership. `pnpm db:claim-local-artifacts` moves that user's artifacts onto a real account and adds a `member` row for each organization those artifacts already reference.
- The share update re-checks the current organization in SQL. That SQL has to stay aligned with `ActorService`.
- Product routes return 401 when nobody is signed in. They do not reject a signed-in user who has no organization, except `org_shared` upload and the share PATCH, which return `400 ORGANIZATION_REQUIRED`. Health and `/api/v1/public/*` do not need an actor.

## 1. Signup and the create-organization step

`/signup` stays name, email, and password. `POST /api/auth/sign-up/email` stays that body. `/login` stays email and password. `autoSignIn` stays true. Email verification stays off. The welcome email stays a welcome email. Do not register `sendInvitationEmail`.

A signed-in user with no membership can open the app only as far as a create-organization page. That page posts the organization name to a new endpoint, `POST /api/v1/onboarding/organization`, with the session cookie.

The endpoint:

- Requires a session. A caller who already has a membership gets `409` and no second organization.
- Body is `{ "name" }` only. No slug, role, or logo.
- Validates the name, generates a unique slug, inserts the organization and one `member` row with role `owner`, and sets `session.activeOrganizationId` to that organization.
- Rate limit: 10 requests per 60 seconds per client IP, matching sign-up. The existing cookie origin check applies.

The plugin route `POST /api/auth/organization/create` stays rejected. It takes a client slug. The Factrove endpoint is the only create path.

`GET /api/auth/get-session` and sign-out keep working with zero memberships, so the page can show who is signed in and the person can leave.

## 2. Guard

The API is the authority. The page redirect only gets the person to the form.

After the caller is authenticated, every `/api/v1` route except `GET /api/v1/health` and `/api/v1/public/*` checks the current organization:

| Resolved organization | Response |
| --- | --- |
| One current organization | The route runs |
| Authenticated, zero memberships | `403 ORGANIZATION_SETUP_REQUIRED` |
| Authenticated, more than one membership, and no active id that matches a membership | `409 ORGANIZATION_SELECTION_REQUIRED` |

`400 ORGANIZATION_REQUIRED` keeps its current meaning: an `org_shared` write whose current organization disappeared between the guard and the update.

`POST /api/v1/onboarding/organization` is the authenticated exception to the 403. Key create, list, and delete require a current organization, on top of the existing rule that a bearer token cannot manage keys.

The library, the viewer, and `/account/api-keys` send that 403 to the create-organization page. A signed-out visitor still sees the library sign-in state. Public share pages do not use this guard.

A session whose `activeOrganizationId` is missing or is not a membership resolves like today: the only membership counts as current; several memberships do not. Do not pick the oldest. Sign-in of a user with exactly one membership sets `activeOrganizationId` to it, so the single-membership fallback is for a session the repair migration has not rewritten.

## 3. Backfill

One Prisma migration inserts the missing organizations. It does not ask the person for a name.

For each user who has zero memberships and whose id is not `local-user`:

- Create an organization. The display name is `{user.name}'s organization` after trim. If the name is empty, use the email local part (the text before `@`). The same name validation as the create endpoint applies. If that still fails, use `Organization`.
- Slug: server-generated, unique, and never updated. See section 9.
- Insert a `member` row, role `owner`.
- Set `session.activeOrganizationId` to that organization where the user's sessions have it null or empty.

`local-user` gets no membership. It cannot sign in. Seed already created `local-org`.

Then fill artifacts:

- Where `organization_id` is null and the creator has exactly one membership, set it to that organization.
- Where `organization_id` is null and the creator is `local-user`, set it to `local-org`. That does not give `local-user` a membership. It gives the column a value so the constraint below can land. `local-org` already exists from seed.
- Do not change an `organization_id` that is already set.
- If a creator has several memberships and a null artifact, the migration raises. Do not guess. That state should not exist on Cloud. Fix it by hand and run the migration again.

If no null `organization_id` remains, the same migration sets the column `NOT NULL` and the Prisma field becomes required. If any null remains, stop before the constraint and leave the follow-up migration for after those rows are assigned. Do not use a conditional `ALTER` that can differ between databases. New writes require the id in application code either way.

The migration does not delete API keys. Deleting them before replacements are organization-owned would let a person create another user-owned key. Key deletion is the migration in the API-key pull request.

`claim-local-artifacts` changes in the backfill pull request. It sets claimed artifacts' `organization_id` to the destination account's only organization and inserts no `member` row. It refuses an account that does not have exactly one membership. It still refuses `local-user`, an account with no password, and an unknown or ambiguous email. A second run still does nothing. Memberships an earlier claim already inserted stay in place.

## 4. Organization plugin

The first pull request mounts `organization()` in `create-auth.ts` and removes the hand-written `session.additionalFields.activeOrganizationId`. The plugin owns that field (`input: false`). Run `pnpm --filter @factrove/api db:generate-schema` and commit a schema diff only if the generator emits one. Expect none: `auth-schema.config.ts` already generates with the plugin. Do not add a unique on `member.userId`. If the generator adds a unique pair on `(organizationId, userId)`, take it only after checking for duplicate pairs. Teams and dynamic access control stay off.

Closed for the whole project, not only the first pull request:

- `POST /organization/create` (the Factrove endpoint replaces it)
- invite, accept, reject, cancel
- remove member, update role, leave
- delete (`disableOrganizationDeletion: true` as well)
- `POST /organization/set-active`, for every body. A membership id, a slug, an omitted id, and a non-member id are all rejected before the plugin runs, so the stored active organization does not change.
- `GET /organization/get-organization` and `GET /organization/get-full-organization`. A non-member id or slug on those reads clears the active organization inside the plugin, including from a cross-site navigation, because GET is not covered by the origin check.
- any update that changes `slug`, `logo`, or `metadata`

`allowUserToCreateOrganization` is false, so a signed-in user cannot create a second organization through the plugin. Do not set `organizationLimit: 1`. A later invite must be able to add a membership without a schema change.

`check-slug` and list stay mounted. The UI does not call `check-slug`.

Rename of the display name is a later pull request. Until that lands, `beforeUpdateOrganization` rejects every update, including a name change.

`creatorRole` is `owner`.

## 5. Active organization

`session.activeOrganizationId` is the current organization for a browser session.

On session create, when the user has exactly one membership, set the column to it. The backfill migration does the same for sessions that already exist.

The client cannot send the field. `set-active` is rejected for every body and does not change the stored session. There is no switcher in this work. Several memberships and no valid active id stay a 409 from the guard. That response is not cleared by calling `set-active`.

## 6. API keys

Keys belong to the organization. `apikey.referenceId` becomes the organization id, so a key cannot move to another organization when the user switches later. Store the creating user id for audit. The plugin's metadata string can hold `{"createdByUserId":"<id>"}` if adding a column is avoidable. Confirm during that pull request that list and delete still work from the browser session: the session user's current organization is the scope, and the audit field is how the artifact creator is known.

On use, the actor's user is the creating user, and the actor's organization is the key's organization. The creating user must still be a member. If they are not, the key is `401`.

The migration in that pull request deletes every row in `apikey`. CLI docs, the quickstart, and the self-host guide say that keys created before this change stop working and must be created again at `/account/api-keys`. There is still no `factrove login` and no organization flag. A configured key means the organization it was created for.

`ActorService` and the share UPDATE's SQL use that same organization. The confirmed id in the share body still has to match it. The session branch keeps the single-membership fallback for a null or stale active id. The lock, the retry, and the conditional UPDATE stay as they are.

Creating a key requires the session's current organization. Ignore any organization id the client sends. A bearer token still cannot manage keys.

## 7. Roles and v1 scope

Better Auth's roles are `owner`, `admin`, and `member`. Several roles can be stored comma-separated. This work writes `owner` only.

Billing later is an owner action. When it is built, treat the role as owner if the comma-separated value contains `owner`.

| Capability | v1 |
| --- | --- |
| Create the first organization, named by the signed-in user, role `owner` | Yes |
| Second organization | No |
| Invites | No |
| Members page | No |
| Organization switcher | No. `set-active` is rejected and does not change the session |
| Rename display name | Yes, owner only, in its own pull request |
| Change slug, logo, metadata | No |
| Delete organization | No. Artifacts reference the organization with `ON DELETE RESTRICT` |
| Several memberships in the schema | Yes. `member.userId` stays non-unique |

## 8. Artifacts

Every new upload writes `actor.organization.id`, including private artifacts. The guard makes a missing organization unreachable for that call.

`creator_user_id` stays the person who uploaded. Rename, delete, share-link management, and the private-to-`org_shared` switch stay creator-only. An organization admin who is not the creator still gets `404 ARTIFACT_NOT_FOUND`. The organization list still shows `org_shared` rows only.

Existing ids that are already set stay set. Nulls are filled by the backfill in section 3. The client still does not send an organization id on upload. The share PATCH still sends the id the page confirmed.

## 9. Name and slug

Shared by the create endpoint, the backfill, and later rename of the display name:

- Unicode NFC.
- Reject U+0000–U+001F, U+007F–U+009F, U+2028, and U+2029.
- Trim. The trimmed value is 1 to 80 code points.
- The display name is not unique.

Slug, server-side only, never accepted from the client, never updated:

- NFKD, drop combining marks, lower case.
- Replace runs outside `[a-z0-9]` with a single hyphen. Trim hyphens. Cap at 48 characters.
- If that is empty, use `org` plus a short random suffix.
- Reserve `local`, `admin`, `api`, `app`, and `www`.
- On unique conflict, append `-2`, `-3`, and so on, with a small bound. Past the bound, fail the request and leave no organization behind.

New error codes in `@factrove/contracts` when the guard lands:

| Code | HTTP | When |
| --- | --- | --- |
| `ORGANIZATION_SETUP_REQUIRED` | 403 | Authenticated, no membership |
| `ORGANIZATION_SELECTION_REQUIRED` | 409 | Authenticated, several memberships, no valid active organization |

## 10. Tests

First pull request (this one):

- Signup without an organization name still returns a session and no membership.
- Create, update, delete, invite, accept, reject, cancel, remove member, role change, leave, and every `set-active` body return 403 with `This organization action is not available.`
- Against a session whose active organization is already set, `set-active` with an organization id, a slug, an omitted body, and a non-member id returns 403 and leaves that stored id unchanged.
- `GET /organization/get-organization` and `GET /organization/get-full-organization`, including `?organizationSlug=outsider`, return 403 and leave the stored active id unchanged.
- `check-slug` is not that 403. Listing organizations after a rejected create still returns an empty list.

Create-organization pull request:

- The endpoint with a session and a valid name creates one owner membership and sets `activeOrganizationId`.
- A second call returns 409 and does not insert another organization.
- A missing session is 401. An invalid name writes nothing.
- Plugin `POST /organization/create` stays 403.

Guard pull request:

- Zero memberships: list, get, upload, replace, rename, delete, share, context, and API-key create return `403 ORGANIZATION_SETUP_REQUIRED`.
- Health, a public share, `get-session`, and sign-out still succeed.
- Two memberships and a null active id return 409 on a product route. That pull request does not call `set-active`.

Backfill pull request:

- A user with no membership gets one organization, an owner row, and the active id on their sessions. The name uses the user's name, then the email local part.
- `local-user` gains no membership. A null artifact of `local-user` points at `local-org`.
- Other null artifacts point at the creator's only organization. An existing organization id is unchanged.
- Claim adds no membership and refuses an account that does not have exactly one.

API-key pull request:

- After the migration, `apikey` has no rows.
- A new key's `referenceId` is the active organization, and the audit field is the session user, even if the client sends another id.
- Upload through that key stores that organization id and that creating user as `creator_user_id`.
- Removing the creating user's membership makes the key 401.
- The share PATCH still returns `409 ORGANIZATION_CHANGED` and `401` for a dead session. The API-key branch of that SQL uses the key's organization. Re-run the lock-order cases.

Rename pull request:

- The owner can change the display name. A slug in the body is rejected. A non-owner, inserted directly, cannot rename.

## 11. Docs

With the pull request that changes the behavior:

- This plan, `AGENTS.md`, and `prd/mvp_contract.md` stay aligned with which routes are mounted. The first pull request updates them for the mount. `prd/mvp/done/` and `prd/post-mvp/20-login-accounts-api-keys.md` stay the record of the earlier work.
- `docs/concepts.mdx` when membership, the guard, or key ownership changes. The first pull request only corrects the "routes stay unmounted" sentences.
- Create-organization: quickstart and the self-host signup section. The signup curl stays name, email, and password. Say that the next step is naming the organization.
- Guard: OpenAPI via `pnpm docs:openapi` when the error codes land in `@factrove/contracts`.
- Keys: `docs/guides/cli.mdx`, `apps/cli/src/command-spec.ts`, quickstart, self-host, and README. Say that keys from before this change stop working and must be created again. No new command and no new flag. Regenerate with `pnpm docs:cli`.
- Claim: README and the concepts paragraph for `db:claim-local-artifacts`.

Do not document Paddle, seats, or prices.

## 12. Pull requests

Merge in order. Each one leaves `pnpm test` green. Deploy the stack through the guard before telling people the product requires an organization. The mount pull request does not change signup.

1. Mount the organization plugin, remove the duplicate session field, and reject the management routes this work does not ship. Signup and sign-in stay as they are. Includes this plan.
2. Create-organization page and `POST /api/v1/onboarding/organization` for a signed-in user with no organization. Server-generated slug, owner role, active organization set.
3. Guard. Product routes return `403 ORGANIZATION_SETUP_REQUIRED` or `409 ORGANIZATION_SELECTION_REQUIRED`. Web sends the 403 to the create-organization page.
4. Backfill migration: one organization per user who has none, except `local-user`; active session; fill null `artifact.organization_id`; `NOT NULL` when no nulls remain. Claim writes that organization and adds no membership.
5. Organization-owned API keys. The migration deletes every existing key. CLI docs say old keys must be recreated. Actor resolution and the share SQL follow the key's organization.
6. The owner can rename the display name. The slug does not change.

Follow-ups, not this stack: `NOT NULL` if the backfill has to leave it off; invites and a members page; a switcher; organization delete; email verification; billing against the organization.

## 13. Decision record

Decided November 15, 2026. These are closed.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where does the organization name sit? | After sign-in. Signup and sign-in stay as they are. A signed-in user with no organization must name one before product routes work. The guard is `403 ORGANIZATION_SETUP_REQUIRED`. |
| 2 | How are existing users backfilled? | Data migration. One organization per user who has none, named `{name}'s organization`, or the email local part when the name is empty. That user is owner. Set it active on their sessions. Skip `local-user`. |
| 3 | Who owns an API key? | The organization. Record the creating user for audit. The API-key migration deletes every existing key. Docs say old keys must be recreated. |
| 4 | What else ships in v1? | The first organization, and rename of its display name by the owner. No invites, members page, switcher, or delete. The schema still allows several memberships. |
| 5 | Who manages billing later? | The owner. |
| 6 | Does the user type a slug? | No. The server generates it. It stays unique and is not changed. |
| 7 | Is `artifact.organization_id` required? | Yes on every new write, including private. The backfill fills old nulls from the creator's organization, then adds `NOT NULL` when that leaves zero nulls. |
| 8 | What does claim do? | Point the artifacts at the account's only organization. Add no membership. |
| 9 | What if a session has no active organization? | The guard covers it. Zero memberships is 403. Several memberships and no valid active id is 409. One membership still counts as current. |
