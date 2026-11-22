import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { repoRoot } from "./local-runtime.mjs";

const forbidden = [
  /@factrove\/ee-/,
  /@paddle\//,
  /paddle-node-sdk/,
  /(?:from|import)\s*\(?\s*["'][^"']*\/ee\//,
];

const skipDirectories = new Set(["node_modules", "dist", ".next", "coverage"]);
const scannedExtensions = new Set([".mjs", ".js", ".cjs", ".ts", ".tsx", ".json", ".yml", ".yaml"]);

describe("ee boundary", () => {
  it("keeps ee out of the workspace and the self-host image context", () => {
    const workspace = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    assert.doesNotMatch(workspace, /^\s*-\s*ee/m);
    const ignore = readFileSync(join(repoRoot, ".dockerignore"), "utf8");
    assert.match(ignore, /^ee$/m);
  });

  it("does not let core source reference the ee packages or Paddle", () => {
    const hits = [];
    for (const name of ["apps", "packages", "scripts"]) {
      walk(join(repoRoot, name), hits);
    }
    assert.deepEqual(hits, []);
  });
});

function walk(directory, hits) {
  for (const name of readdirSync(directory)) {
    if (skipDirectories.has(name)) {
      continue;
    }
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      walk(path, hits);
      continue;
    }
    const rel = relative(repoRoot, path);
    if (rel === "scripts/ee-boundary.test.mjs") {
      continue;
    }
    const extension = path.slice(path.lastIndexOf("."));
    if (!scannedExtensions.has(extension)) {
      continue;
    }
    const text = readFileSync(path, "utf8");
    if (forbidden.some((pattern) => pattern.test(text))) {
      hits.push(rel);
    }
  }
}
