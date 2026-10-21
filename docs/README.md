# Factrove docs

Mintlify reads this folder. Tom creates the Mintlify account and points `docs.factrove.app` at it. Nothing here signs up, deploys, or publishes a site.

`docs.json` is the current Mintlify config (`$schema`: `https://mintlify.com/docs.json`). Hand-written pages live next to generated CLI MDX and `api-reference/openapi.json`.

`MVP_END_STATE.md` is internal product planning. It is not in the Mintlify navigation.

## Regenerate references

From the repository root, after you change HTTP contracts or CLI command specs:

```bash
pnpm docs:openapi
pnpm docs:cli
```

`pnpm docs:openapi` builds `@factrove/contracts` and writes `api-reference/openapi.json` from the Zod schemas and `packages/contracts/src/http.ts`.

`pnpm docs:cli` builds the CLI and writes one MDX page per command in `cli-reference/`, plus `cli-reference/pages.json` for navigation. The generator only reads `apps/cli/src/command-spec.ts`. After a CLI rename (for example `cp` and `--endpoint-url`), update that spec and re-run the script. Do not edit the generated pages by hand.

`pnpm docs:check` fails when the committed files differ from a fresh generation. `pnpm test` includes that check.

## Preview locally

Install the [Mintlify CLI](https://www.mintlify.com/docs/installation) (`mint`), then from this folder:

```bash
mint dev
```

From the repository root:

```bash
pnpm docs:dev
```

That runs `pnpm dlx mint@latest dev` with this folder as the working directory. It needs network to download the CLI the first time. It does not deploy.

Useful offline-ish checks, if your `mint` build supports them:

```bash
mint validate
mint broken-links
```

Mintlify also hosts `/llms.txt` from page titles and frontmatter descriptions once the site is built.
