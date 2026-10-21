import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { artifactDtoSchema, publicArtifactSchema } from "../packages/contracts/dist/index.js";
import { buildOpenApiDocument } from "../packages/contracts/dist/openapi.js";

const helloBytes = readFileSync(new URL("../fixtures/hello.html", import.meta.url)).byteLength;

test("generated upload samples and error examples match the running API", () => {
  const doc = buildOpenApiDocument();
  const upload = doc.paths["/api/v1/artifacts"].post;
  const replace = doc.paths["/api/v1/artifacts/{id}/content"].put;

  for (const operation of [upload, replace]) {
    const samples = operation["x-codeSamples"].map((sample) => sample.source).join("\n");
    assert.match(samples, /fixtures\/hello\.html/);
    assert.match(samples, /form\.append\("file", htmlBlob, "hello\.html"\)/);
    assert.match(samples, /-F "file=@\.\/fixtures\/hello\.html"/);
    assert.doesNotMatch(samples, /<string>/);
    assert.doesNotMatch(samples, /example-file/);
  }

  assert.equal(upload.responses["201"].content["application/json"].example.artifact.sizeBytes, helloBytes);
  assert.equal(artifactDtoSchema.safeParse(upload.responses["201"].content["application/json"].example.artifact).success, true);
  assert.equal(
    artifactDtoSchema.safeParse(replace.responses["200"].content["application/json"].example.artifact).success,
    true,
  );
  assert.equal(
    artifactDtoSchema.safeParse(doc.paths["/api/v1/artifacts"].get.responses["200"].content["application/json"].example.items[0]).success,
    true,
  );
  const publicArtifact = doc.paths["/api/v1/public/artifacts/{id}/{token}"].get.responses["200"].content["application/json"].example.artifact;
  assert.equal(publicArtifactSchema.safeParse(publicArtifact).success, true);
  assert.equal(replace.responses["400"].content["application/json"].example.error.code, "INVALID_REQUEST");
  assert.equal(
    replace.responses["400"].content["application/json"].example.error.message,
    "accessType cannot be changed when replacing content.",
  );
  const upload400 = upload.responses["400"].content["application/json"];
  assert.equal(upload400.example, undefined);
  assert.ok(upload400.examples.INVALID_REQUEST);
  assert.ok(upload400.examples.ORGANIZATION_REQUIRED);
  const content503 = doc.paths["/api/v1/artifacts/{id}/content"].get.responses["503"].content["application/json"];
  assert.equal(content503.example, undefined);
  assert.ok(content503.examples.STORAGE_UNAVAILABLE);
  assert.ok(content503.examples.CONVERSION_UNAVAILABLE);
  const upload401 = upload.responses["401"].content["application/json"];
  assert.equal(upload401.examples, undefined);
  assert.equal(upload401.example.error.code, "UNAUTHENTICATED");
  assert.equal(upload.responses["401"].content["application/json"].example.error.message, "Sign in to continue.");
  assert.equal(replace.responses["409"].content["application/json"].example.error.code, "CONTENT_CONFLICT");

  const file = doc.components.schemas.UploadForm.properties.file;
  assert.equal(file.contentMediaType, "application/octet-stream");
  assert.equal(file.format, "binary");

  const createKey = doc.paths["/api/auth/api-key/create"].post;
  const bash = createKey["x-codeSamples"].find((sample) => sample.lang === "bash").source;
  assert.match(bash, /Origin: \$origin/);
  assert.match(bash, /api-key\/create/);
  assert.doesNotMatch(bash, /Authorization/);
  assert.equal(createKey.responses["403"].content["application/json"].example.error.code, "FORBIDDEN");
  assert.equal(
    createKey.responses["403"].content["application/json"].example.error.message,
    "This request origin is not allowed.",
  );
});
