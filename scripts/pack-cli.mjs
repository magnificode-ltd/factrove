import { access, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PUBLISH_DIRECTORY = join(repoRoot, "apps/cli/npm");
export const BUNDLED_ENTRY = "dist/cli.js";
export const PUBLISHED_NAME = "factrove";

const WORKSPACE_ENTRIES = {
  "@factrove/api-client": join(repoRoot, "packages/api-client/dist/index.js"),
  "@factrove/contracts": join(repoRoot, "packages/contracts/dist/index.js"),
};

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const RUNTIME_DEPENDENCIES = ["@nestjs/common", "@nestjs/core", "reflect-metadata", "rxjs"];

export function publishManifest(cliPackage, contractsPackage, version = cliPackage.version) {
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(`CLI publish version must be semver without a leading v. Received: ${String(version)}`);
  }
  if (cliPackage.engines?.node !== ">=24.7.0 <25") {
    throw new Error("apps/cli/package.json engines.node must be >=24.7.0 <25.");
  }
  const dependencies = {};
  for (const name of RUNTIME_DEPENDENCIES) {
    dependencies[name] = requiredDependency(cliPackage, name);
  }
  dependencies.zod = requiredDependency(contractsPackage, "zod");
  for (const [name, range] of Object.entries(dependencies)) {
    if (range.startsWith("workspace:")) {
      throw new Error(`Published dependency ${name} still uses a workspace range.`);
    }
  }
  return {
    name: PUBLISHED_NAME,
    version,
    description: "Command-line client for the Factrove artifact library.",
    license: "AGPL-3.0-or-later",
    type: "module",
    bin: {
      factrove: BUNDLED_ENTRY,
      ftrv: BUNDLED_ENTRY,
    },
    files: ["dist", "README.md", "LICENSE", "common-passwords.NOTICE.md"],
    engines: { node: cliPackage.engines.node },
    repository: {
      type: "git",
      url: "git+https://github.com/magnificode-ltd/factrove.git",
      directory: "apps/cli",
    },
    homepage: "https://github.com/magnificode-ltd/factrove/blob/main/docs/guides/cli.mdx",
    bugs: { url: "https://github.com/magnificode-ltd/factrove/issues" },
    author: "Magnificode LTD",
    publishConfig: { access: "public" },
    dependencies,
  };
}

export async function prepareCliPackage(options = {}) {
  const cliPackage = JSON.parse(await readFile(join(repoRoot, "apps/cli/package.json"), "utf8"));
  const contractsPackage = JSON.parse(await readFile(join(repoRoot, "packages/contracts/package.json"), "utf8"));
  const manifest = publishManifest(cliPackage, contractsPackage, options.version ?? cliPackage.version);
  const entry = join(repoRoot, "apps/cli/dist/main.js");
  await readable(entry, "Build the CLI before packing: pnpm --filter @factrove/cli... build");
  for (const [name, path] of Object.entries(WORKSPACE_ENTRIES)) {
    await readable(path, `Build ${name} before packing: pnpm --filter @factrove/cli... build`);
  }

  await rm(PUBLISH_DIRECTORY, { recursive: true, force: true });
  await mkdir(join(PUBLISH_DIRECTORY, "dist"), { recursive: true });
  await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    outfile: join(PUBLISH_DIRECTORY, BUNDLED_ENTRY),
    legalComments: "none",
    packages: "external",
    plugins: [
      {
        name: "bundle-factrove-workspace",
        setup(build) {
          build.onResolve({ filter: /^@factrove\/(api-client|contracts)$/ }, (args) => ({
            path: WORKSPACE_ENTRIES[args.path],
          }));
        },
      },
    ],
  });

  const outfile = join(PUBLISH_DIRECTORY, BUNDLED_ENTRY);
  const bundled = await readFile(outfile, "utf8");
  if (bundled.includes("@factrove/")) {
    throw new Error("Published CLI bundle still references a workspace package.");
  }
  const body = bundled.startsWith("#!") ? bundled.slice(bundled.indexOf("\n") + 1) : bundled;
  const withoutPathComments = body.replace(/^\/\/ (?:apps|packages)\/.*\n/gm, "");
  await writeFile(outfile, `#!/usr/bin/env node\n${withoutPathComments.startsWith("\n") ? withoutPathComments.slice(1) : withoutPathComments}`);
  await chmod(outfile, 0o755);
  await writeFile(join(PUBLISH_DIRECTORY, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(join(repoRoot, "apps/cli/README.md"), join(PUBLISH_DIRECTORY, "README.md"));
  await cp(join(repoRoot, "apps/cli/LICENSE"), join(PUBLISH_DIRECTORY, "LICENSE"));
  await cp(
    join(repoRoot, "packages/contracts/src/common-passwords.NOTICE.md"),
    join(PUBLISH_DIRECTORY, "common-passwords.NOTICE.md"),
  );
  return { directory: PUBLISH_DIRECTORY, manifest };
}

function requiredDependency(manifest, name) {
  const range = manifest.dependencies?.[name];
  if (typeof range !== "string" || range.length === 0) {
    throw new Error(`${manifest.name} is missing dependency ${name}.`);
  }
  return range;
}

async function readable(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

function versionFromArgv(argv) {
  const index = argv.indexOf("--version");
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error("Missing value for --version.");
  }
  return value;
}

function versionFromEnv() {
  const value = process.env.FACTROVE_PUBLISH_VERSION?.trim() ?? "";
  return value.length > 0 ? value : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fromArg = versionFromArgv(process.argv.slice(2));
  const fromEnv = versionFromEnv();
  if (fromArg !== undefined && fromEnv !== undefined && fromArg !== fromEnv) {
    throw new Error(`--version (${fromArg}) and FACTROVE_PUBLISH_VERSION (${fromEnv}) disagree.`);
  }
  const prepared = await prepareCliPackage({ version: fromArg ?? fromEnv });
  process.stdout.write(`${prepared.directory}\n${prepared.manifest.name}@${prepared.manifest.version}\n`);
}
