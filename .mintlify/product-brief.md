# Product brief

## Description

Factrove stores HTML artifacts. People and agents upload files, a web app lists them, and a viewer opens the stored HTML. The same web app, HTTP API, and CLI run in two setups: a server the reader operates (self-host) and Factrove Cloud, the hosted service.

## Primary audience

Someone uploading HTML, from a terminal or from an agent, who needs to know which setup they are talking to. A second reader operates the server: Compose or a from-source process, origins, secrets, and the first account.

## Jobs to be done

- Tell self-host and Factrove Cloud apart, and open the matching quickstart.
- Self-host: install the published `factrove` CLI, start the server, create the first user and an API key, and save a CLI profile for that API origin.
- Factrove Cloud: sign up, create an API key, install the same CLI, and save a profile for `https://api.factrove.app`.
- Look up CLI and API behavior that is shared, with a note where the API origin or the public base URL differs.

## Motivation

Readers could not tell which pages applied to a server they run and which applied to the hosted service. The docs site now leads with that choice.

## Assumptions

- The CLI default API origin is `https://api.factrove.app` (`DEFAULT_API_URL`). That is the Factrove Cloud API. Confirmed in `apps/cli/src/parse-args.ts`.
- The hosted web origin is not configured in this repository. Cloud pages use `https://cloud.factrove.example` as a placeholder and say so. Auth email footers link to `WEB_ORIGIN`. It is not documented here as the Cloud signup origin.
- No pricing or billing is documented. Confirmed by the absence of billing in this repository and by the docs instruction not to invent it.
- `ftrv` is a bin of the `factrove` npm package. There is no separate `ftrv` package. The npx package name is `factrove`.
