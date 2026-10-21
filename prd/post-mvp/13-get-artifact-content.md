# Post-MVP 13 — Get artifact content as HTML or Markdown

## Goal

Read one artifact's content by id as HTML or Markdown. Factrove stores only the HTML. Markdown is converted from that HTML when the caller asks for it, and the conversion is not saved.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), and [the shared contract](../mvp_contract.md). **Status: done, October 18, 2026.** Live content reads were verified against local Garage. Real AWS was not tested.

## Owns

The content format on `GET /api/v1/artifacts/{id}/content`, the shared contract and HTTP client, the CLI `get` command, and `apps/api/src/rendering/html-to-markdown.ts`. No database column, object key, or stored Markdown file.

## Behavior

- Omitted `format`, and `format=html`, return the original HTML bytes and the existing HTML headers. `Accept` does not select a format. A leading UTF-8 BOM stays in the HTML body. `getArtifactContent` decodes that body with the BOM preserved, and `pnpm factrove get` writes those bytes to stdout.
- `format=markdown` reads the stored HTML and converts it in a worker thread. The converter parses with `parse5` and emits CommonMark in one pass. `node-html-markdown` is not used: its translator is quadratic and emitted decoded text as raw Markdown, so escaped HTML and `<javascript:…>` became live markup. The response is `text/markdown; charset=utf-8` with a CSP that does not allow scripts.
- Text keeps `&`, `<`, and `>` as entities and backslash-escapes Markdown punctuation, including line-leading `#`, `-`, `+`, `=`, and ordered-list markers. Code is not escaped. Code fences are longer than any backtick run in the code. Destinations allow `http`, `https`, `mailto`, and relative URLs. `javascript:`, `vbscript:`, `data:`, and other schemes are removed. Remote `https` images are kept, so another renderer may fetch them.
- Nesting deeper than 100 levels is flattened. Output is capped at 16 MiB. Each worker is limited to 5 seconds and 256 MiB of old-generation heap. At most `MARKDOWN_CONVERSION_CONCURRENCY` workers run at once (default 2, clamped to 1–4), and `MARKDOWN_CONVERSION_QUEUE` further conversions may wait (default 2, clamped to 0–8). A full queue is `503 CONVERSION_UNAVAILABLE`. A stored object above the 10 MiB HTML limit is `413 CONTENT_TOO_LARGE`. Time, memory, and output limits are `422 CONTENT_TOO_COMPLEX`. Invalid UTF-8 is `400 INVALID_REQUEST`. An unexpected converter failure is `500 INTERNAL_ERROR`. The stored artifact is unchanged.
- Any other `format` is `400 INVALID_REQUEST`. Unknown ids stay `404 ARTIFACT_NOT_FOUND`. Storage failures stay `503 STORAGE_UNAVAILABLE`.
- `contentUrl` remains the HTML URL. The viewer iframe is unchanged.
- The CLI command is `pnpm factrove get <id> [--format html|markdown] [--json] [--api-url <origin>]`. Plain output is the content. `--json` prints `{ format, mediaType, content }` on one line. Origin precedence, stderr errors, and exit behavior match `upload`. The command reference is [docs/CLI.md](../../docs/CLI.md).

## Verification

`pnpm --filter @factrove/api exec vitest run test/html-to-markdown.test.ts` covers headings, lists, tables, fenced code, links, ordered-list start, multi-paragraph items, the hello fixture, script and unsafe-URL removal, malformed fragments, the size and output limits, deep lists and blockquotes, a large flat document, and worker responsiveness. Safety cases, including link syntax, image syntax, and reference definitions in ordinary text, emphasis, table cells, and link text, are rendered with `marked` and `markdown-it` (`html: true`) and must not produce a script, an event-handler attribute, an iframe, or a `javascript:`, `vbscript:`, or `data:text` URL. Literal `#`, `1.`, `-`, and `>` stay text. The same file checks that a saturated pool fails fast with `limit: "busy"`.

HTTP coverage is in `apps/api/test/http.integration.test.ts` against PostgreSQL with `BLOB_STORE` overridden. It checks byte-identical HTML, a leading BOM, an `Accept: text/markdown` request that still returns HTML, Markdown output and headers, invalid formats, a missing id, a storage failure, `422 CONTENT_TOO_COMPLEX` when Markdown output exceeds 16 MiB, and `503 CONVERSION_UNAVAILABLE` when the conversion pool is full. PR #8's final verification ran `content.s3.integration.test.ts` with `S3_INTEGRATION=1` against local Garage (1 passed) and `pnpm e2e` with the Garage storage and content tests (4 passed). Real AWS was not tested.

`packages/api-client/test/client.test.ts` checks the default HTML URL, the Markdown query, id encoding, a preserved BOM, error envelopes, and an unexpected content type.

`pnpm --filter @factrove/cli test` checks argument parsing and the compiled `get` command against a local HTTP stub, including plain and JSON output, a leading BOM, origin precedence, API 404s, an unreachable API, a rejected id, and `pnpm factrove get` from the repository root.

The web viewer does not add a Copy as Markdown action. The viewer still embeds `contentUrl` in the sandboxed iframe, and a clipboard action would be a new client interaction. The same content endpoint is available for that later.

## Exclusions

No stored Markdown, no Markdown upload, no `Accept` negotiation, no change to the artifact row or object key, and no viewer clipboard control.
