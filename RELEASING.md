# Release the CLI

Maintainer notes for publishing the `factrove` npm package. This file is not part of the public docs site.

The public npm package is `factrove`. It installs two commands, `factrove` and `ftrv`. They run the same program. npm rejected a separate `ftrv` package name, so `ftrv` is only a bin alias.

The workspace package stays `@factrove/cli` and private. The repository root is also named `factrove`, and pnpm will not accept a second workspace package with that name. `node scripts/pack-cli.mjs` writes `apps/cli/npm/` with the public manifest, bundles `@factrove/api-client` and `@factrove/contracts` into `dist/cli.js`, and leaves NestJS, `reflect-metadata`, `rxjs`, and `zod` as normal dependencies. That directory is gitignored. `npm publish` runs there, not in `apps/cli`.

Publishing happens only when someone runs the [Publish CLI](https://github.com/magnificode-ltd/factrove/actions/workflows/publish-cli.yml) workflow by hand from `main`. The workflow file is `.github/workflows/publish-cli.yml`. It has no `push` or `tag` trigger. A dispatch from any other branch is skipped, so it cannot publish.

## Configure trusted publishing

Publishing authenticates with npm Trusted Publishing. GitHub Actions provides a short-lived OIDC token to this workflow. A dry run needs no credentials.

One-time setup on npmjs.com, for the `factrove` package: **Settings → Trusted Publisher → GitHub Actions**.

1. Organization or user: `magnificode-ltd`.
2. Repository: `factrove`.
3. Workflow filename: `publish-cli.yml`.
4. Leave the environment empty. This workflow has no GitHub environment.
5. Allow this publisher to run `npm publish`. The workflow publishes with that command.

The publish job sets `id-token: write` and `contents: read`. The runner uses Node 24 from `.nvmrc`. Before a real publish, the job installs `npm@latest` so npm is 11.5.1 or newer. Trusted publishing requires that npm on Node 22.14 or newer, or on Node 24.

The publish command is `npm publish --access public`. Provenance is generated automatically when the repository and the package are public. A private repository publishes without a provenance attestation.

Complete the first successful publish within two days of creating the trusted publisher. npm expires an unused configuration after that.

After that publish works, the package setting can be changed to disallow token publishing. On the `factrove` package, open **Settings → Publishing access** and select **Require two-factor authentication and disallow tokens**. Trusted publishing keeps working. Revoke any npm automation token for this package, and delete the `NPM_TOKEN` repository secret if it is still there.

## Cut a release

### Set the version

The version in `apps/cli/package.json` is what gets published when the version input is empty. Bump that version in a commit on `main` before a real publish. The input overrides the tarball version without changing the file. Pass a semver such as `0.1.0`, with no leading `v`.

npm already has the placeholder `factrove@0.0.1`. Do not republish `0.0.1`. The first release from this repository is the version in `apps/cli/package.json` (`0.1.0` until that file changes).

### Dry-run

Open **Actions → Publish CLI → Run workflow** on `main`. Leave **Dry-run** checked. That is the default. Leave **Version** empty to use `package.json`, or type a version to pack that version instead.

The job installs dependencies, builds the CLI, runs the CLI tests, writes the publish directory, prints `npm pack --dry-run`, and fails if that version is already on npm. It then installs the tarball into a clean prefix and runs `factrove --help` and `ftrv --help`. It does not publish.

### Publish

Run the workflow again from `main` with **Dry-run** unchecked. The same checks run, then the job installs a current npm and runs `npm publish --access public`. npm signs in through the trusted publisher. Provenance is included when the repository is public. A version that already exists fails before the smoke test, with an error that names the version.

`pnpm cli:pack` from a checkout writes the same `apps/cli/npm/` directory. It does not publish.

Contributors still run `pnpm factrove` from the repository root. That launcher is not the published package. Install instructions for the published commands are in [CLI](docs/guides/cli.mdx) and [CLI overview](docs/cli-reference/overview.mdx).
