# Artifacts

## Purpose

An artifact is one HTML document. PostgreSQL stores its metadata. Object storage stores the bytes. The web library lists artifacts, and the viewer renders the HTML in a sandboxed iframe. The CLI and the HTTP API create and change artifacts. The web app does not upload files.

## Current behavior

A caller needs a session or an API key, and a current organization, before product routes run. Health and public share routes stay open. See [organizations.md](organizations.md) and [auth.md](auth.md).

`POST /api/v1/artifacts` accepts one non-empty `.html` or `.htm` file, case-insensitively, up to 10,485,760 bytes. The body is UTF-8 HTML, including a fragment. The API assigns `text/html` and ignores the multipart MIME type. A missing file, an extra file, malformed UTF-8, or an invalid name is `400 INVALID_REQUEST`. A larger file is `413 FILE_TOO_LARGE`. Any other extension is `415 UNSUPPORTED_FILE_TYPE`.

`accessType` is `private` or `org_shared`, and it defaults to `private`. `private` is readable by the creator. `org_shared` is readable by the creator and by members of `artifact.organizationId`. The organization list contains `org_shared` rows for the caller's current organization. A private artifact can still record that organization and stays out of the organization list. `view=mine` for a session is every artifact that user created. `view=mine` for an API key is those artifacts in the key's organization. A key can read or change an artifact only when the artifact belongs to that organization. Sort is `created_at` descending, then `id` descending. The response is the full list.

Every new artifact stores the caller's current organization id, including a private upload. The client does not send a creator id or an organization id on create. `org_shared` without a current organization is `403 ORGANIZATION_SETUP_REQUIRED` when the caller has no membership, and `400 ORGANIZATION_REQUIRED` when that organization disappears before the row is saved.

The library name is optional, one line of 1 to 120 characters after NFC normalization. Control characters, including line breaks, are rejected. When create omits `name`, the stored name is the uploaded file name with `.html` or `.htm` removed, when that stem passes the same rule. An unusable stem stores null and the upload still succeeds. The public filename is always `{artifactId}.html`.

`PUT /api/v1/artifacts/{id}/content` replaces the HTML and keeps the id, access, and share token. An optional `name` is written in the same update. Omitting it leaves the current name, including null. `accessType` on replace is rejected. `PATCH /api/v1/artifacts/{id}/name` changes the name only. There is no request that clears a name. `DELETE /api/v1/artifacts/{id}` returns `204` and removes the row, the current object, and any public link. The object is deleted first. A missing object still deletes the row. `503 STORAGE_UNAVAILABLE` means storage failed before the row delete, and the row is kept. A replace that lands during delete is retried against the new revision, up to 8 attempts, then `409 CONTENT_CONFLICT`.

`PATCH /api/v1/artifacts/{id}` with `{ "accessType": "org_shared", "organizationId": "<current organization id>" }` is the only access change. It moves a private artifact to `org_shared` in the organization the caller confirmed. The caller must be the creator. A different organization id is `409 ORGANIZATION_CHANGED` and does not write. An artifact that is already `org_shared` returns 200 and does not move. There is no route back to `private`.

Rename, delete, replace, share management, and the access change are creator-only. Another member who can read an `org_shared` artifact receives the same `404 ARTIFACT_NOT_FOUND` body as an unknown id. A missing session or key on a product route is `401 UNAUTHENTICATED`. A present `Authorization` header that is not a valid key does not fall back to a session cookie.

`GET /api/v1/artifacts/{id}/content` returns the stored HTML. `format=markdown` converts that HTML on a worker and does not save the result. `Accept` does not select the format. Input over the stored HTML limit is `413 CONTENT_TOO_LARGE`. Output over 16 MiB, a conversion past 5 seconds, a worker that runs out of memory, or HTML the converter cannot finish is `422 CONTENT_TOO_COMPLEX`. Nesting deeper than 100 levels is flattened. `MARKDOWN_CONVERSION_CONCURRENCY` (default 2, clamped to 1–4) and `MARKDOWN_CONVERSION_QUEUE` (default 2, clamped to 0–8) bound the pool. A full queue is `503 CONVERSION_UNAVAILABLE`. The public content route does not offer Markdown.

The viewer is `/artifacts/{id}`. It loads `contentUrl` in an iframe with `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`. The HTML response is `text/html; charset=utf-8`, `no-store`, `nosniff`, `no-referrer`, and a CSP that allows inline scripts and styles, `data:` and `blob:` images and fonts, and framing by `PUBLIC_BASE_URL` and by `WEB_ORIGIN` when that origin differs. The policy blocks network connections, external resources, forms, objects, nested frames, base-URL changes, and top-level navigation. Uploaded markup is not inserted into the application DOM. A session detail response appends `?access=<grant>` so the iframe can load HTML without cookies or `allow-same-origin`. The grant is an HMAC of the artifact id, the issuing user id, the issuing session id, the content revision, and the expiry. It lasts five minutes and applies only to HTML for that id when the request has neither `Authorization` nor `x-api-key`. On redeem the API checks that the session is still live, that the user can still read the artifact, and that the content revision is unchanged.

## Decisions

The artifact row is inserted only after the object is stored. A failed create leaves no row. `created_at`, `updated_at`, and `uploaded_at` are set together on insert. `uploaded_at` is the time of the current content. A failed upload has no row, so lists and viewers return stored artifacts only.

The API generates the object key. Clients never send it, and HTTP responses omit it. New writes use `{artifactId}/{contentId}.html`. Rows from before that scheme keep `{artifactId}.html`. A blank key means that legacy object. The row stores `object_key`, `size_bytes`, and `content_revision` together. A replace reads the revision, writes a new object, then updates the row only while that revision is unchanged. One replace of a given revision wins. The loser is `409 CONTENT_CONFLICT` and its new object is deleted. The previous object is deleted after a successful commit. That delete is best-effort. A lost acknowledgement can leave the new object in place until a following read shows whether the commit landed. Unreferenced objects are not swept.

`contentUrl` on list and upload responses has no query. Viewer URLs are `PUBLIC_BASE_URL` plus `/artifacts/{id}`. An unset `PUBLIC_BASE_URL` uses `WEB_ORIGIN`. The API builds those URLs from configuration.

Cookie-authenticated writes require `Origin` or `Referer` to be `WEB_ORIGIN` or `PUBLIC_BASE_URL`. A request that sends `Authorization` skips that check. `x-api-key` does not authenticate and does not skip it. A rejected origin is `403 FORBIDDEN`.

Identity tables come from Better Auth. Artifact is Factrove's model and references User and Organization. `organization_id` is required. Organization delete is restricted by that foreign key. There is no separate content, revision, or upload-operation table.

## Open items

Factrove keeps the current HTML only. Older bytes are not listed or returned. Pagination, search, grouping, a web upload form, and storing Markdown or another source format are not part of this feature.
