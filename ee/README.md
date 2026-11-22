# `ee/`

Cloud-only Factrove code lives in this directory. The open-source core is AGPL-3.0-or-later and does not import this tree. Self-host installs leave `FACTROVE_EE` unset. They have no billing and no usage limits.

No license is set on this directory. Do not add `AGPL-3.0-or-later` here. Tom chooses the license.

This directory is not a pnpm workspace package. `pnpm-workspace.yaml` lists `apps/*` and `packages/*` only. `.dockerignore` excludes `ee`, so the self-host API and web images do not contain it.

`ee/api` and `ee/web` are private package manifests with no dependencies yet. Install `ee/api` on its own, when it has dependencies, with:

```sh
pnpm --dir ee/api install --ignore-workspace --frozen-lockfile
```

`--ignore-workspace` keeps that install out of the root lockfile.

The billing plan for this boundary is FCT-79. This scaffold does not include a Paddle client, checkout, webhooks, or prices.
