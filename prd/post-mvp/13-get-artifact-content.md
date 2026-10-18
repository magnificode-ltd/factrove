# Post-MVP 13 — Get artifact content as HTML or Markdown

## Goal

Read one artifact's content by id as HTML or Markdown. Factrove stores only the HTML. Markdown is converted from that HTML when the caller asks for it, and the conversion is not saved.

Read [the MVP end state](../../docs/MVP_END_STATE.md), [the project README](../../README.md), and [the shared contract](../mvp_contract.md). **Status: done — stub-verified, October 18, 2026.**

## Owns

The content format on `GET /api/v1/artifacts/{id}/content`, the shared contract and HTTP client, the CLI `get` command, and `apps/api/src/rendering/html-to-markdown.ts`. No database column, object key, or stored Markdown file.

## Behavior

- Omitted `format`, and `format=html`, return the original HTML bytes and the existing HTML headers. `Accept` does not select a format.
- `format=markdown` reads the stored HTML, strips scripts, styles, and unsafe URLs, and converts the document with `node-html-markdown` 2.0.0. The response is `text/markdown; charset=utf-8` with a CSP that does not allow scripts.
- Any other `format` is `400 INVALID_REQUEST`. Unknown ids stay `404 ARTIFACT_NOT_FOUND`. Storage failures stay `503 STORAGE_UNAVAILABLE`. Conversion failures, including documents over 10 MiB or nested deeply enough to overflow the converter, are `500 INTERNAL_ERROR` and leave the stored artifact unchanged.
- `contentUrl` remains the HTML URL. The viewer iframe is unchanged.
- The CLI command is `pnpm factrove get <id> [--format html|markdown] [--json] [--api-url <origin>]`. Plain output is the content. `--json` prints `{ format, mediaType, content }` on one line. Origin precedence, stderr errors, and exit behavior match `upload`.

## Verification

`pnpm --filter @factrove/api exec vitest run test/html-to-markdown.test.ts` covers headings, lists, tables, fenced code, links, the hello fixture, script/style/comment removal, unsafe URLs, malformed fragments, the size limit, and deep nesting.

HTTP coverage is in `apps/api/test/http.integration.test.ts` against PostgreSQL with `BLOB_STORE` overridden. It checks byte-identical HTML, an `Accept: text/markdown` request that still returns HTML, Markdown output and headers, invalid formats, a missing id, and a storage failure. The live S3 content test was not run. This environment has no AWS credential chain, and `S3_INTEGRATION` was unset, so `content.s3.integration.test.ts` stays skipped.

`packages/api-client/test/client.test.ts` checks the default HTML URL, the Markdown query, id encoding, error envelopes, and an unexpected content type.

`pnpm --filter @factrove/cli test` checks argument parsing and the compiled `get` command against a local HTTP stub, including plain and JSON output, origin precedence, API 404s, an unreachable API, a rejected id, and `pnpm factrove get` from the repository root.

The web viewer does not add a Copy as Markdown action. The viewer still embeds `contentUrl` in the sandboxed iframe, and a clipboard action would be a new client interaction. The same content endpoint is available for that later.

## Exclusions

No stored Markdown, no Markdown upload, no `Accept` negotiation, no change to the artifact row or object key, and no viewer clipboard control.
