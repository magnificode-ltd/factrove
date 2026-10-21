# Factrove documentation

Mintlify reads the `docs/` folder. Point the docs site at that folder. Nothing here signs up, deploys, or publishes a site.

`docs/docs.json` is the current Mintlify config (`$schema`: `https://mintlify.com/docs.json`). Hand-written pages live next to generated CLI MDX and `docs/api-reference/openapi.json`.

Product planning lives in [prd/MVP_END_STATE.md](prd/MVP_END_STATE.md), not in `docs/`.

## Regenerate references

From the repository root, after you change HTTP contracts or CLI command specs:

```bash
pnpm docs:openapi
pnpm docs:cli
```

`pnpm docs:openapi` builds `@factrove/contracts` and writes `docs/api-reference/openapi.json` from the Zod schemas and `packages/contracts/src/http.ts`.

`pnpm docs:cli` builds the CLI and writes one MDX page per command in `docs/cli-reference/`. It also writes the CLI navigation group inline into `docs/docs.json`. The generator only reads `apps/cli/src/command-spec.ts`. After a CLI rename (for example `cp` and `--endpoint-url`), update that spec and re-run the script. Do not edit the generated pages by hand.

`pnpm docs:check` fails when the committed OpenAPI spec, CLI pages, or `docs.json` CLI group differ from a fresh generation, and when a stale generated page is left behind. `pnpm test` includes that check.

## Preview locally

Install the [Mintlify CLI](https://www.mintlify.com/docs/installation) (`mint`), then from `docs/`:

```bash
mint dev
```

From the repository root:

```bash
pnpm docs:dev
```

That runs `pnpm dlx mint@latest dev` with `docs/` as the working directory. It needs network to download the CLI the first time. It does not deploy.

Useful checks, if your `mint` build supports them:

```bash
mint validate
mint broken-links
```

Mintlify also hosts `/llms.txt` from page titles and frontmatter descriptions once the site is built.
