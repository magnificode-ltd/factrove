import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  apiEntry,
  apiEnvFile,
  effectiveApiSetting,
  legacyRootEnvWarning,
  missingApiSettings,
  readDotEnv,
  repoRoot,
  restoreFileSnapshot,
  snapshotFile,
  webAppDir,
  webDevArgs,
  webDevBin,
  webLaunchEnv,
  workspaceBuildArgs,
} from "./local-runtime.mjs";
import { supervise } from "./supervise.mjs";

const legacyEnv = legacyRootEnvWarning(join(repoRoot, ".env"));
if (legacyEnv.length > 0) {
  process.stderr.write(legacyEnv);
}

const fileEnv = readDotEnv(apiEnvFile);
const missing = missingApiSettings(fileEnv, process.env);
if (missing.length > 0) {
  process.stderr.write(
    `The API environment is missing ${missing.join(", ")}. Copy apps/api/.env.example to apps/api/.env and set the database URL, S3 bucket, and S3 region.\n`,
  );
  process.exit(1);
}

if (effectiveApiSetting(fileEnv, process.env, "S3_BUCKET") === "your-bucket") {
  process.stderr.write(
    "S3_BUCKET is still the placeholder from an older apps/api/.env. The API can start, and uploads fail until that file names the local Garage bucket or an existing AWS bucket.\n",
  );
}

process.stderr.write("Building the API, CLI, and shared packages.\n");
const build = spawnSync("pnpm", workspaceBuildArgs, { cwd: repoRoot, stdio: "inherit" });
if (build.error) {
  process.stderr.write(`${build.error.message}\n`);
  process.exit(1);
}
if ((build.status ?? 1) !== 0) {
  process.exit(build.status ?? 1);
}

const webEnv = webLaunchEnv(process.env, fileEnv);
const nextEnvPath = join(webAppDir, "next-env.d.ts");
const nextEnvSnapshot = snapshotFile(nextEnvPath);

function failureHint(recent) {
  if (recent.includes("EADDRINUSE") || recent.includes("already in use")) {
    return "Port 3000 or 3001 is already in use. Stop the other process and run pnpm dev again.\n";
  }
  if (recent.includes("Seed the local identities")) {
    return "Run pnpm db:seed, then start pnpm dev again.\n";
  }
  return "";
}

process.stderr.write("Starting the API on http://127.0.0.1:3001 and the web app on http://localhost:3000.\n");
process.stderr.write("This command does not migrate or seed. Stop with Ctrl+C.\n");

supervise(
  [
    { name: "api", command: process.execPath, args: [apiEntry], cwd: repoRoot, env: process.env },
    { name: "web", command: webDevBin, args: webDevArgs, cwd: webAppDir, env: webEnv },
  ],
  {
    beforeStop(recent) {
      const hint = failureHint(recent);
      if (hint.length > 0) {
        process.stderr.write(hint);
      }
    },
    onExit() {
      restoreFileSnapshot(nextEnvPath, nextEnvSnapshot);
    },
  },
);
