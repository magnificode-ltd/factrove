# Task 03 — Backend-local S3 storage

## Goal

Store and retrieve HTML bytes through one S3 implementation aimed at a configured AWS bucket.

Read [the MVP end state](../../../docs/MVP_END_STATE.md), [the project README](../../../README.md) and [the shared MVP contract](../../mvp_contract.md). **Status: done — October 11, 2026.** Depends on task 01's baseline.

## Owns

apps/api/src/storage/** and storage tests. The operator supplies an existing AWS bucket. Task 07 does not create it.

## Deliverables

- Follow the [README backend directory structure](../../../README.md#backend-directory-structure): module/interface/exports under `src/storage/`, S3 implementation under `src/storage/providers/`.
- Export StorageModule, BLOB_STORE, and the BlobStore interface from the shared contract.
- Implement put/get/delete with the AWS S3 SDK for the configured bucket and region. Do not accept a custom endpoint or path-style addressing.
- Use one configured dedicated bucket. Do not create buckets or change bucket policies during ordinary API requests.
- Keep provider SDK classes, request types, credentials, and errors inside this module.
- Preserve bytes and content type; expose reads as an async byte stream.
- Distinguish missing-object errors from storage outages/configuration failures. Deleting a missing object succeeds.
- Keep private storage access through the backend; no public bucket policy, presigned upload flow, or direct browser S3 access.
- Do not invent prefixes, extensions, or artifact IDs; object naming belongs to the API.
- Document the real AWS bucket and region used for verification.

## Acceptance

Against the configured AWS bucket:

- Put a fixture at a flat UUID.html key, read it back, and compare bytes.
- Delete it; verify missing-object behavior and repeated deletion.
- Verify a credentials failure is not reported as a missing object.
- Confirm bucket settings are not returned to clients. Live checks require `S3_INTEGRATION=1`.
- Hand module exports and normalized error contracts to task 04.

## Exclusions

No filesystem adapter, Azure/GCP stubs, multi-store registry, content rendering, database operations, background cleanup service, or production bucket provisioning.

## Verification

Real AWS on 11 Oct 2026, bucket `factrove-dev-uploads` in `eu-central-1`, using a role with `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:ListBucket`:

- Put and get preserved the HTML fixture bytes and `text/html; charset=utf-8`.
- Put and get preserved non-text bytes.
- Delete succeeded, including a repeated delete of a missing key.
- Get of a missing key is `BLOB_NOT_FOUND`. `s3:ListBucket` on the bucket is what makes S3 return `NoSuchKey` instead of `AccessDenied`.
- Bad credentials were `BLOB_STORE_UNAVAILABLE`. Those error messages did not include the bucket or secret.
