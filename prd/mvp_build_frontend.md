# Task 05 — Next.js artifact library and HTML viewer

## Goal

Show uploaded artifacts in My artifacts / Organization artifacts, and render an artifact when clicked.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md) and [mvp_contract.md](mvp_contract.md). Status: not started. Depends on 01; may use contract fixtures before 04 is ready.

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
