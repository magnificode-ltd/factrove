# Factrove documentation

User-facing guides and references live in `docs/`. This file is the maintainer guide for regenerating and previewing them. Mintlify reads the `docs/` folder. Point the docs site at that folder. Nothing here signs up, deploys, or publishes a site.

`docs/docs.json` is the current Mintlify config (`$schema`: `https://mintlify.com/docs.json`). Hand-written pages live next to generated CLI MDX and `docs/api-reference/openapi.json`.

Navigation is tabs: Overview, Self-host, Factrove Cloud, CLI reference, and API reference. Overview holds the introduction, concepts, and the shared guides. Self-host holds the quickstart, the deploy guide, and configuration. Factrove Cloud holds its quickstart. `docs.json` redirects `/quickstart` to `/self-host/quickstart` and `/guides/self-hosting` to `/self-host/deploy`. There is no `docs/.mintignore` in this repository. The CLI reference tab must stay named `CLI reference`, because `pnpm docs:cli` rewrites that tab's groups.

Product requirements live in [prd/README.md](prd/README.md), not in `docs/`.

## Regenerate references

From the repository root, after you change HTTP contracts or CLI command specs:

```bash
pnpm docs:openapi
pnpm docs:cli
```

`pnpm docs:openapi` builds `@factrove/contracts` and writes `docs/api-reference/openapi.json` from the Zod schemas and `packages/contracts/src/http.ts`.

Publishing the CLI is [RELEASING.md](RELEASING.md), outside the docs site. That workflow is manual. It does not run from these doc commands.

`pnpm docs:cli` builds the CLI and writes the exact `factrove --help` page plus one MDX page per command in `docs/cli-reference/`. It also writes the CLI navigation group inline into `docs/docs.json`. The generator only reads `apps/cli/src/command-spec.ts`. After a CLI help or flag change, update that spec and re-run the script. Do not edit the generated pages by hand.

`pnpm docs:check` fails when the committed OpenAPI spec, CLI pages, or `docs.json` CLI group differ from a fresh generation, when a stale generated page is left behind, when `docs.json` is missing the CLI reference tab or has more than one, or when a relative link in repo markdown outside `docs/` points at a missing file. Extra hand-written pages are allowed. `pnpm test` includes that check.

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
