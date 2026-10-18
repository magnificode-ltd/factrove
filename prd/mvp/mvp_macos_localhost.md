# macOS localhost check

## Status

Not started. Task 08 verified the local stack on Linux. This check stays open until someone runs it on a Mac.

## Check

Confirm a fresh clone on macOS with the pinned Node and pnpm versions and a documented container runtime (`docker compose`).

`localhost` can resolve to `::1` while the API and web app bind `127.0.0.1`. Confirm both of these still reach the API:

- The browser opens `http://localhost:3000` and the library can call the API.
- Node `fetch("http://localhost:3001/api/v1/health")` returns status `ok`.

Record the macOS version, architecture, Node version, pnpm version, and container runtime in this file, then check the macOS item in [the task index](../README.md).
