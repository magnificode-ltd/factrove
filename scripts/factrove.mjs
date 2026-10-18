import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cliLaunch, readDotEnv, rootEnvFile } from "./local-runtime.mjs";

const entry = fileURLToPath(new URL("../apps/cli/dist/main.js", import.meta.url));

if (!existsSync(entry)) {
  process.stderr.write("The CLI is not built. From the repository root, run: pnpm --filter @factrove/cli build\n");
  process.exit(1);
}

const launch = cliLaunch(process.env, process.cwd(), readDotEnv(rootEnvFile));
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: launch.cwd,
  env: launch.env,
  stdio: "inherit",
});

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
