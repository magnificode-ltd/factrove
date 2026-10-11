# Task 03 — Backend-local S3 storage

## Goal

Store and retrieve HTML bytes through one S3 implementation that works with configured AWS S3 and a local development endpoint.

Read [the MVP end state](../docs/MVP_END_STATE.md), [../README.md](../README.md) and [mvp_contract.md](mvp_contract.md). Status: not started. Depends on task 01's baseline.

## Owns

apps/api/src/storage/** and storage tests. Task 07 owns compose and bucket initialization; agree on endpoint/credential configuration early.

## Deliverables

- Export StorageModule, BLOB_STORE, and the BlobStore interface from the shared contract.
- Implement put/get/delete with the AWS S3 SDK. Allow a configurable endpoint and path-style addressing for local development.
- Use one configured dedicated bucket. Do not create buckets or change bucket policies during ordinary API requests.
- Keep provider SDK classes, request types, credentials, and errors inside this module.
- Preserve bytes and content type; expose reads as an async byte stream.
- Distinguish missing-object errors from storage outages/configuration failures. Deleting a missing object succeeds.
- Keep private storage access through the backend; no public bucket policy, presigned upload flow, or direct browser S3 access.
- Do not invent prefixes, extensions, or artifact IDs; object naming belongs to the API.
- Document which behavior was tested on a local endpoint and, if available, real AWS. Do not claim real-AWS verification based on an emulator.

## Acceptance

Against task 07's local S3-compatible service:

- Put a fixture at a flat UUID.html key, read it back, and compare bytes.
- Delete it; verify missing-object behavior and repeated deletion.
- Verify a bad endpoint/credentials failure is not reported as a missing object.
- Confirm bucket and endpoint settings are not returned to clients.
- Hand module exports and normalized error contracts to task 04.

## Exclusions

No filesystem adapter, Azure/GCP stubs, multi-store registry, content rendering, database operations, background cleanup service, or production bucket provisioning.
