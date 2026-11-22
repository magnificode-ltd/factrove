# factrove

Command-line client for [Factrove](https://github.com/magnificode-ltd/factrove). `factrove` and `ftrv` are the same program.

The CLI uploads an HTML file, lists artifacts, prints content, and manages public links. It talks to an HTTP API. It does not open a database or object storage itself.

## Install

Node.js must be at least 24.7.0 and below 25.

```sh
npm install --global factrove
factrove --help
ftrv --help
```

Without a global install:

```sh
npx factrove --help
```

## API origin

With no profile and no API URL, the CLI calls `https://api.factrove.app`.

These override that origin, in order:

1. `--api-url` or `--endpoint-url`
2. `FACTROVE_API_URL`
3. `FACTROVE_ENDPOINT_URL`
4. `api_url` in the selected profile, or `endpoint_url` when `api_url` is absent
5. a URL from `apps/cli/.env`, only for `pnpm factrove` in a checkout of this repository

`factrove configure` saves an API key and an API URL for a profile. A self-hosted API needs its own origin:

```sh
factrove configure --api-url http://localhost:3001
factrove upload ./plan.html
```

Create the key in the web app at `/account/api-keys`. The secret is shown once. Omit `--api-key` so the key stays out of shell history.

## Develop from this repository

From a checkout, `pnpm factrove` runs the CLI in this repository. That command is not the published package. Install, flags, and config precedence are in the [CLI guide](https://github.com/magnificode-ltd/factrove/blob/main/docs/guides/cli.mdx). Publishing is a manual GitHub Actions dispatch: [Release the CLI](https://github.com/magnificode-ltd/factrove/blob/main/RELEASING.md).

## Contributing

Factrove is not accepting outside pull requests yet. Issues, bug reports, and ideas are welcome. See [CONTRIBUTING.md](https://github.com/magnificode-ltd/factrove/blob/main/CONTRIBUTING.md).

## License

Copyright (C) 2026 Magnificode LTD. Released under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The bundled common-password list is MIT, from SecLists. The published package includes `common-passwords.NOTICE.md` beside this file. The same notice is in the repository at [packages/contracts/src/common-passwords.NOTICE.md](https://github.com/magnificode-ltd/factrove/blob/main/packages/contracts/src/common-passwords.NOTICE.md).
