import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BUNDLED_ENTRY, prepareCliPackage, publishManifest, PUBLISH_DIRECTORY, PUBLISHED_NAME } from "./pack-cli.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const cliPackage = {
  name: "@factrove/cli",
  version: "0.1.0",
  engines: { node: ">=24.7.0 <25" },
  dependencies: {
    "@factrove/api-client": "workspace:*",
    "@factrove/contracts": "workspace:*",
    "@nestjs/common": "11.1.9",
    "@nestjs/core": "11.1.9",
    "reflect-metadata": "0.2.2",
    rxjs: "7.8.2",
  },
};

const contractsPackage = {
  name: "@factrove/contracts",
  dependencies: { zod: "4.1.12" },
};

test("publish manifest is the public factrove package", () => {
  const manifest = publishManifest(cliPackage, contractsPackage);
  assert.equal(manifest.name, PUBLISHED_NAME);
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.license, "AGPL-3.0-or-later");
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.bin, { factrove: BUNDLED_ENTRY, ftrv: BUNDLED_ENTRY });
  assert.deepEqual(manifest.files, ["dist", "README.md", "LICENSE", "common-passwords.NOTICE.md"]);
  assert.deepEqual(manifest.engines, { node: ">=24.7.0 <25" });
  assert.equal(manifest.publishConfig.access, "public");
  assert.deepEqual(manifest.dependencies, {
    "@nestjs/common": "11.1.9",
    "@nestjs/core": "11.1.9",
    "reflect-metadata": "0.2.2",
    rxjs: "7.8.2",
    zod: "4.1.12",
  });
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal(JSON.stringify(manifest.dependencies).includes("@factrove/"), false);
  assert.equal(publishManifest(cliPackage, contractsPackage, "1.2.3-rc.1").version, "1.2.3-rc.1");
  assert.throws(() => publishManifest(cliPackage, contractsPackage, "v0.1.0"), /semver/);
  assert.throws(() => publishManifest(cliPackage, contractsPackage, "1.2"), /semver/);
});

test("packed CLI bundles workspace packages and runs --help", async () => {
  const prepared = await prepareCliPackage();
  assert.equal(prepared.directory, PUBLISH_DIRECTORY);
  assert.equal(prepared.manifest.name, PUBLISHED_NAME);
  const entry = join(prepared.directory, BUNDLED_ENTRY);
  const source = await readFile(entry, "utf8");
  assert.equal(source.startsWith("#!/usr/bin/env node\n"), true);
  assert.equal(source.includes("@factrove/"), false);
  assert.equal(source.includes("@nestjs/common"), true);
  assert.equal(source.includes("zod"), true);
  const info = await stat(entry);
  assert.equal(info.mode & 0o111, 0o111);
  await linkRuntimeDependencies(prepared.directory);

  const help = spawnSync(process.execPath, [entry, "--help"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: factrove /);
  assert.equal(help.stdout.includes("ftrv"), false);

  const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: prepared.directory,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const listing = JSON.parse(packed.stdout);
  assert.equal(listing[0].name, PUBLISHED_NAME);
  assert.equal(listing[0].filename, "factrove-0.1.0.tgz");
  const paths = listing[0].files.map((file) => file.path).sort();
  assert.deepEqual(paths, [
    "LICENSE",
    "README.md",
    "common-passwords.NOTICE.md",
    "dist/cli.js",
    "package.json",
  ]);
  const bin = listing[0].files.find((file) => file.path === "dist/cli.js");
  assert.equal(bin.mode & 0o111, 0o111);
});

async function linkRuntimeDependencies(directory) {
  const destination = join(directory, "node_modules");
  await mkdir(destination, { recursive: true });
  const cliRequire = createRequire(join(repoRoot, "apps/cli/package.json"));
  const contractsRequire = createRequire(join(repoRoot, "packages/contracts/package.json"));
  const links = {
    "@nestjs/common": packageRoot(cliRequire, "@nestjs/common"),
    "@nestjs/core": packageRoot(cliRequire, "@nestjs/core"),
    "reflect-metadata": packageRoot(cliRequire, "reflect-metadata"),
    rxjs: packageRoot(cliRequire, "rxjs"),
    zod: packageRoot(contractsRequire, "zod"),
  };
  for (const [name, target] of Object.entries(links)) {
    const link = join(destination, name);
    await mkdir(dirname(link), { recursive: true });
    await symlink(target, link);
  }
}

function packageRoot(resolver, name) {
  let directory = dirname(resolver.resolve(name));
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (manifest.name === name) {
        return directory;
      }
    } catch {
      // Keep walking until the package manifest matches.
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not find the package root for ${name}.`);
}
