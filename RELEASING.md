# Release the CLI

Maintainer notes for publishing the `factrove` npm package. This file is not part of the public docs site.

The public npm package is `factrove`. It installs two commands, `factrove` and `ftrv`. They run the same program. npm rejected a separate `ftrv` package name, so `ftrv` is only a bin alias.

The workspace package stays `@factrove/cli` and private. The repository root is also named `factrove`, and pnpm will not accept a second workspace package with that name. `node scripts/pack-cli.mjs` writes `apps/cli/npm/` with the public manifest, bundles `@factrove/api-client` and `@factrove/contracts` into `dist/cli.js`, and leaves NestJS, `reflect-metadata`, `rxjs`, and `zod` as normal dependencies. That directory is gitignored. `npm publish` runs there, not in `apps/cli`.

Publishing happens only when someone runs the [Publish CLI](https://github.com/magnificode-ltd/factrove/actions/workflows/publish-cli.yml) workflow by hand from `main`. The workflow file is `.github/workflows/publish-cli.yml`. It has no `push` or `tag` trigger. A dispatch from any other branch is skipped, so it cannot publish.

## Add NPM_TOKEN

The workflow reads the `NPM_TOKEN` repository secret. It does not publish without that secret, and a dry run does not need it.

Create a granular access token on the npm account that owns the `factrove` package:

1. Open the Access Tokens page for that npm account and generate a **Granular Access Token**.
2. Name it for GitHub Actions, and set an expiration you will rotate.
3. Under packages, grant **read and write** only for the `factrove` package. Do not grant access to every package on the account.
4. Tick **Bypass two-factor authentication**. It is off by default. CI cannot publish until that box is ticked. The token is still a granular access token, scoped to read and write on `factrove` only.
5. In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `NPM_TOKEN` and paste the token.

Do not commit the token, and do not put it in the workflow file. The workflow writes it to `~/.npmrc` only for the publish step.

The publish command is `npm publish --access public`. It does not pass `--provenance`. The publish step sets `NPM_CONFIG_PROVENANCE` from repository visibility: provenance is on when the repository is public, and off when it is private. npm accepts a publish without provenance from a private repository. `id-token: write` is set so a public repository can sign provenance.

## Cut a release

### Set the version

The version in `apps/cli/package.json` is what gets published when the version input is empty. Bump that version in a commit on `main` before a real publish. The input overrides the tarball version without changing the file. Pass a semver such as `0.1.0`, with no leading `v`.

npm already has the placeholder `factrove@0.0.1`. Do not republish `0.0.1`. The first release from this repository is the version in `apps/cli/package.json` (`0.1.0` until that file changes).

### Dry-run

Open **Actions → Publish CLI → Run workflow** on `main`. Leave **Dry-run** checked. That is the default. Leave **Version** empty to use `package.json`, or type a version to pack that version instead.

The job installs dependencies, builds the CLI, runs the CLI tests, writes the publish directory, prints `npm pack --dry-run`, and fails if that version is already on npm. It then installs the tarball into a clean prefix and runs `factrove --help` and `ftrv --help`. It does not publish.

### Publish

Run the workflow again from `main` with **Dry-run** unchecked. The same checks run, then `npm publish --access public`. Provenance is on when the repository is public and off when it is private. A missing `NPM_TOKEN` fails this step. A version that already exists fails before the smoke test, with an error that names the version.

`pnpm cli:pack` from a checkout writes the same `apps/cli/npm/` directory. It does not publish.

Contributors still run `pnpm factrove` from the repository root. That launcher is not the published package. Install instructions for the published commands are in [CLI](docs/guides/cli.mdx) and [CLI overview](docs/cli-reference/overview.mdx).
