# Factrove

Share HTML artifacts with humans. Reuse artifact context for future agents.

Coding agents produce HTML reports, plans, and previews. The people who need them often do not use the same agent, and a later agent has no copy of that work. Factrove stores the HTML, gives you a link a person can open, and lets an agent fetch the artifact again when it needs the context.

## Quickstart

### Factrove Cloud

[Factrove Cloud](https://app.factrove.app) is the hosted service.

### Self-host with Docker

From a clone of this repository, copy the example env file, replace the placeholders, and start the stack. Secrets, HTTPS, upgrades, and backups are in the [self-hosting guide](https://docs.factrove.app/self-host/deploy). The [self-host quickstart](https://docs.factrove.app/self-host/quickstart) creates the first user and an API key.

```sh
git clone https://github.com/magnificode-ltd/factrove.git
cd factrove
cp .env.docker.example .env.docker
docker compose --env-file .env.docker -f docker-compose.yml up --build
```

### CLI

Node.js must be at least 24.7.0 and below 25.

```sh
npm i -g factrove
factrove configure
factrove upload ./file.html
```

`ftrv` runs the same program. With no profile and no API URL, the CLI calls `https://api.factrove.app`. `factrove configure`, `--api-url`, and `FACTROVE_API_URL` point it at a server you run.

## How it works

- An upload stores one HTML file and returns an artifact id.
- The web app lists artifacts and opens the HTML in a viewer.
- `factrove share` prints a public link. Anyone with the link can open it without an account.
- A later agent can `factrove get` the artifact, including as Markdown, and reuse that context.
- Private artifacts stay with their owner. Organization-shared artifacts are visible to members of that organization.

## Docs

- [Documentation](https://docs.factrove.app)
- [CLI reference](https://docs.factrove.app/cli-reference/overview)
- [Self-hosting guide](https://docs.factrove.app/self-host/deploy)

## Contributing

Factrove is not accepting outside pull requests yet. Issues, bug reports, and ideas are welcome. The [contributor license agreement](CLA.md) will apply once contributions open. Signing steps are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright (C) 2026 Magnificode LTD. Factrove is released under the [GNU Affero General Public License v3.0](LICENSE) or any later version (`AGPL-3.0-or-later`). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
