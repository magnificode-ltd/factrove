# Organizations

## Purpose

A signed-in person names one organization before they can use the product. Artifacts, API keys, and the organization library belong to that organization. Signup itself stays name, email, and password.

## Current behavior

User and Organization are Better Auth models. Membership is a row in `member`. The organization plugin is mounted, and `session.activeOrganizationId` is the plugin field with `input: false`. The client cannot set it. On session create, a user with exactly one membership gets that organization as the active one.

`POST /api/v1/onboarding/organization` is the create path. It requires a browser session and a JSON body `{ "name" }`. The name is NFC, one line of 1 to 80 characters, with the same control-character rejection as an artifact name. The server generates the slug: NFKD, lower case, runs outside `[a-z0-9]` become one hyphen, capped at 48 characters. Empty results use `org` plus a suffix. `local`, `admin`, `api`, `app`, and `www` are reserved. A unique conflict tries `-2` through `-8`, then a short random suffix. The slug is never accepted from the client and is never updated. The user becomes `owner`, and the session's active organization is set to the new row. A second membership is `409 ORGANIZATION_EXISTS`. An API key is `401`. The route is limited to 10 requests per 60 seconds per client address and uses the cookie-origin check. The plugin route `POST /organization/create` stays rejected because it takes a client slug.

Until the user has an organization, product routes return `403 ORGANIZATION_SETUP_REQUIRED` with message `Create an organization to continue.` The web app sends that response to `/onboarding`. A user who already has an organization is sent home from that page. Health, public share pages, get-session, and sign-out stay available. `POST /api/v1/onboarding/organization` is the authenticated exception to the 403.

The current organization for a session is the active organization when the user is a member of it. Otherwise it is the user's only membership. Several memberships and no active organization that matches a membership resolve to none. The API does not pick the oldest row. That caller receives `409 ORGANIZATION_SELECTION_REQUIRED` with message `Choose an organization to continue.` An API key does not use the single-membership fallback. It acts in the organization that owns the key. See [api-keys.md](api-keys.md).

These plugin routes return 403 with `This organization action is not available.` and do not change the stored session:

- create, update, and delete organization
- invite, cancel, accept, and reject
- remove member, update role, and leave
- `set-active`, for every body
- `GET /organization/get-organization` and `GET /organization/get-full-organization`

The get routes are rejected because a non-member id clears the active organization inside the plugin, and GET is outside the origin check. `allowUserToCreateOrganization` is false. `disableOrganizationDeletion` is true. `organizationLimit` is not set, so the schema can hold another membership later. `check-slug` and list stay mounted. The UI does not call `check-slug`.

`artifact.organization_id` is required and uses `ON DELETE RESTRICT`. New uploads write the caller's current organization, including private artifacts. The organization list still shows `org_shared` rows only. Creator-only actions stay creator-only. An organization role does not grant rename, delete, replace, or share management.

`pnpm db:seed` upserts `local-user` (no password, no membership) and `local-org` (slug `local`). `pnpm db:claim-local-artifacts -- --email …` moves artifacts whose creator is `local-user` onto an account that can already sign in. That account must have a password and exactly one organization. Artifact ids stay the same. Their organization becomes that membership's organization. The command adds no membership, refuses `local-user`, and does nothing on a second run.

Roles stored by this product are `owner` only. Better Auth's `admin` and `member` roles exist in the access-control map. Any member of the active organization can create, list, and delete its API keys.

`invitation` keeps the email, role, status, expiry, inviter, and timestamps from Better Auth. `tokenHash` is the SHA-256 hex digest of a 32-byte base64url secret and is unique. The invitation id is a management id, not that secret. `lastSentAt` is when a secret was last issued. A pending row has a hash. Accepted, canceled, and expired rows do not. Those are the only statuses. A pending row whose `expiresAt` is at or before the database clock is expired, and that update clears the hash. Accepting or revoking a pending row clears the hash too. The address is trimmed and stored in lower case, and a plus tag is kept. One pending invitation is allowed for an organization and that lowercased email.

`member` has at most one row for a user in one organization. `member.userId` stays non-unique, so the schema can still hold memberships in more than one organization. Migration `20261123140000_invitation_tokens_and_api_key_creator` stops when a user already has two rows in one organization and names those member ids and roles. It does not pick a role. It cancels pending invitations that have no token hash. Organizations and artifacts stay where they are. The plugin invite, accept, reject, and cancel routes stay rejected. There is no product route that creates an invitation yet.

## Decisions

Signup does not collect an organization name and does not insert a `member` row. The guard is the API. The page redirect only gets the person to the form.

`member.userId` is not unique. A user may have several membership rows, in different organizations. One user has at most one row in a single organization. This product does not offer a way to create the second organization.

Display name is not unique. Slug is unique and immutable. The user does not type a slug.

`400 ORGANIZATION_REQUIRED` keeps its meaning: an `org_shared` write whose current organization disappeared between the guard and the update.

## Open items

The owner cannot rename the display name. Every organization update is rejected. Invites, a members page, switching the active organization, and deleting an organization are not available.
