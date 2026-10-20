import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cliEnvFilePath, cliLaunch, launcherSkipsEnvFile, launcherWantsJson, readCliEnvFile } from "./local-runtime.mjs";

const entry = fileURLToPath(new URL("../apps/cli/dist/main.js", import.meta.url));

if (!existsSync(entry)) {
  process.stderr.write("The CLI is not built. From the repository root, run: pnpm --filter @factrove/cli build\n");
  process.exit(1);
}

const argv = process.argv.slice(2);
const fileValues = launcherSkipsEnvFile(argv) ? {} : loadDevEnv(argv);
const launch = cliLaunch(process.env, process.cwd(), fileValues);
const child = spawn(process.execPath, [entry, ...argv], {
  cwd: launch.cwd,
  env: launch.env,
  stdio: "inherit",
});

function loadDevEnv(args) {
  const loaded = readCliEnvFile(cliEnvFilePath(process.env));
  if (loaded.ok) {
    return loaded.values;
  }
  const message = loaded.message;
  if (launcherWantsJson(args)) {
    process.stderr.write(`${JSON.stringify({ error: { code: "INVALID_INPUT", message } })}\n`);
  } else {
    process.stderr.write(`INVALID_INPUT: ${message}\n`);
  }
  process.exit(1);
}

function forward(signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill(signal);
}

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 1);
});
