# Task 05 — Next.js artifact library and HTML viewer

## Goal

Show uploaded artifacts in My artifacts / Organization artifacts, and render an artifact when clicked.

Read [the MVP end state](../../../docs/MVP_END_STATE.md), [the project README](../../../README.md) and [the shared MVP contract](../../mvp_contract.md). **Status: done — October 11, 2026.** Depends on 01; verified against the task 04 API.

## Owns

apps/web/** after the workspace scaffold handoff. Shared client/schema changes belong to task 01 or the integration owner.

## Deliverables

- Build a simple responsive library at /. Two clear tabs: My artifacts and Organization artifacts.
- Show filename, upload time, size, and private/org_shared classification. Use getContext for local user/org labels.
- Fetch the corresponding API list on tab selection and refresh. Include a visible refresh action; browser refresh must work too.
- Provide loading, empty, API-unavailable, and no-organization states.
- Link items to /artifacts/[id]. Viewer shows filename and a back-to-library action.
- Render contentUrl in an iframe using the shared sandbox/referrer policy. Do not fetch HTML and insert it into the application DOM.
- Show a useful state for missing metadata and content-load failures where observable; never silently render a broken or stale mock.
- Use the shared HTTP client and NEXT_PUBLIC_API_URL. No backend imports or direct DB/S3 access.
- Treat data as dynamic/no-store. A newly uploaded file must appear after refresh.
- Make the local, unauthenticated mode clear with a small label. Do not present the private badge as proven access control.

## Acceptance

- Against fixture responses, verify tab filtering requests, loading/empty/error states, and deep-linked viewer behavior.
- Against the real backend, a CLI upload appears after refresh and opens correctly.
- A file created by another fixture user in the current org appears only in the org tab when org_shared.
- Self-contained inline styling and scripts render inside the iframe while uploaded code cannot access the Next.js parent DOM.
- Verify desktop and narrow-screen layout without overflowing controls.

## Exclusions

No signup/login, API-key UI, user/org switcher, invitation flow, upload form, sharing editor, search, delete/rename, markdown renderer, elaborate design system, or fake artifacts in the final UI.

## Completion and handoff

The library is at `/`. `/?view=org` selects Organization artifacts; any other value, including a missing parameter, selects My artifacts. Each tab is a normal link, so selecting it loads that list from the API. Refresh is a link to the current tab URL. Browser reload does the same. Both library and viewer pages set `dynamic = "force-dynamic"`, and Next responses send `Cache-Control: no-store`. `createWebClient` passes `cache: "no-store"` into `@factrove/api-client`.

`NEXT_PUBLIC_API_URL` is the API origin. It defaults to `http://localhost:3001`. The web app does not import the API, Prisma, or storage code. It depends on `@factrove/api-client` and `@factrove/contracts`.

Rows show the stored filename, upload time in UTC, size, and `Private · list only` or `Organization shared · list only`. The page states that this build is local and unauthenticated, and that those labels are list classifications rather than access control. User and organization names come from `GET /context`. With no configured organization, the organization tab says so and does not render a list. An empty mine or organization list, a network failure, and an API error envelope each have their own message. Route `loading.tsx` files show the loading state while a page is pending.

`/artifacts/[id]` shows the filename and a back-to-library link. The content URL is the iframe `src`. The iframe uses `sandbox="allow-scripts"` and `referrerPolicy="no-referrer"`. The page does not fetch the HTML into the Next.js DOM. A 404 metadata response shows “Artifact not found” and no iframe. A non-HTTP content URL, or an iframe `error` event, shows a content-load failure instead of a placeholder document.

`pnpm --filter @factrove/web test` runs 14 Vitest tests against fixture responses. They cover mine versus org requests, ignored view values, empty and no-organization states, API failures, loading text, and the deep-linked viewer. `pnpm --filter @factrove/web typecheck` and `pnpm --filter @factrove/web build` pass. The library and viewer are dynamic routes.

Against the running API, an HTTP upload of `fixtures/hello.html` was absent until Refresh, then appeared only under My artifacts. Opening it rendered the fixture’s inline styles, and the inline script changed the status text to “Inline JavaScript ran successfully.” The parent page could not read the iframe document. A second upload that tried to set state on the parent showed “parent access blocked,” and the parent stayed unchanged. An unknown id showed the missing state. Desktop and 320px layouts did not overflow the tabs, refresh control, filenames, or iframe. The CLI is still task 06, so this check used the HTTP API rather than `pnpm factrove upload`.

The API used for that check has no configured organization, so the organization tab showed the no-organization state. A fixture test covers an org list that includes another creator’s `org_shared` artifact and a mine list that does not. Three private verification artifacts remain in that local library:

- `30778268-901f-4e5e-b3ea-9faa26819723`
- `798d7539-32d6-40c2-90fa-555d00dabbf0`
- `d78f8c31-3587-4524-bc89-41497539ba51`

Task 06 owns the CLI. Task 07 still owns the combined dev command and infrastructure scripts.
