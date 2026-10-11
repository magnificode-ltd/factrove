# Task 07 — Self-hosted macOS runtime and end-to-end integration

## Goal

Make the full upload → refresh → view loop runnable from a fresh checkout on the owner's Mac.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md), [mvp_contract.md](mvp_contract.md), and [README.md](README.md) in this directory. Status: not started. Can prepare runtime after 01; depends on 02–06 for completion.

## Owns

compose.yaml, .env.example, local infrastructure initialization, setup scripts/docs, final root command wiring, shared lockfile reconciliation, and end-to-end checks. Coordinate changes in other task directories with their owners.

## Deliverables

- Provide persistent PostgreSQL and one S3-compatible development service using containers. Select and pin images compatible with the target Mac architecture.
- Bind host ports to loopback. Initialize a dedicated bucket idempotently and supply non-production development credentials.
- Use the real S3 provider with endpoint overrides; no filesystem substitute.
- Document Node/pnpm and container-runtime prerequisites, environment setup, first migration/seed, and FE/BE startup.
- Implement/verify the root commands listed in the shared contract. pnpm dev should start frontend/backend with visible logs and clean shutdown; CLI runs separately.
- Keep migrations and local seed explicit before startup. An API restart must not reset data.
- Make infra:down preserve volumes; any destructive reset must be separately named/documented and never part of normal setup.
- Ensure only the API receives database/storage secrets. Web/CLI receive HTTP origins.
- Integrate the independently developed tasks and reconcile shared dependencies/lockfile.
- Update root README to distinguish implemented behavior from future plans and include commands verified on the actual checkout.
- Provide a short troubleshooting path for unavailable containers, missing seed, missing bucket, port conflicts, and backend URL errors.

## End-to-end acceptance

Run against the real local stack, not mocks:

1. Install from the committed lockfile, start infrastructure, apply migrations to an empty database, seed twice.
2. Start FE/BE. Verify the seeded context and initially empty library.
3. Upload fixtures/hello.html via CLI --json. Parse stdout as JSON and assert the viewer URL uses the configured web origin.
4. Refresh My artifacts and open the new artifact. Verify visible source content and inline script behavior.
5. Confirm the private artifact is absent from Organization artifacts.
6. Upload a second file with --access org_shared. Confirm it appears in both tabs.
7. Using isolated test fixtures, create another user's org_shared/private artifacts. Confirm the list semantics without adding a user switcher.
8. Verify the raw content endpoint sends sandbox/CSP headers and the iframe cannot access the parent DOM or make external requests.
9. Stop and restart applications/infrastructure without deleting volumes. Confirm metadata and bytes remain viewable.
10. Run workspace build/typecheck and targeted tests, then record actual results.

Use a browser check for visible rendering; HTTP status alone is insufficient. Do not claim full MVP completion if the UI, CLI, or persistence was only tested with mocks.

## Completion report

List verified setup commands, relevant test results, known local-only limitations, and any unresolved blockers. Document that private/org_shared are list classifications without authentication. Mark the task index checklist based on evidence; do not mark unrun checks complete.

## Exclusions

No cloud deployment, AWS account provisioning, paid resources, production TLS setup, authentication, CI/CD platform, multi-host orchestration, or product features beyond upload/list/view.
