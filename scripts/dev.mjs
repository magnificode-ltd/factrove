import { spawn, spawnSync } from "node:child_process";
import {
  apiEntry,
  apiEnvFile,
  effectiveApiSetting,
  missingApiSettings,
  readDotEnv,
  repoRoot,
  rootEnvFile,
  signalProcessGroup,
  webAppDir,
  webDevArgs,
  webDevBin,
  webLaunchEnv,
  workspaceBuildArgs,
} from "./local-runtime.mjs";

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
    "S3_BUCKET is still the example placeholder. The API can start, and uploads fail until apps/api/.env names an existing AWS bucket.\n",
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

const rootEnv = readDotEnv(rootEnvFile);
const webEnv = webLaunchEnv(process.env, rootEnv);
const children = [];
let recent = "";
let shuttingDown = false;
let exitCode = 0;

function note(name, line) {
  recent = `${recent}[${name}] ${line}\n`.slice(-4000);
  process.stderr.write(`[${name}] ${line}\n`);
}

function prefix(name, stream) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        note(name, line);
      }
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      note(name, buffer);
    }
  });
}

function failureHint() {
  if (recent.includes("EADDRINUSE") || recent.includes("already in use")) {
    return "Port 3000 or 3001 is already in use. Stop the other process and run pnpm dev again.\n";
  }
  if (recent.includes("Seed the local identities")) {
    return "Run pnpm db:seed, then start pnpm dev again.\n";
  }
  return "";
}

function allClosed() {
  return children.length > 0 && children.every((child) => child.exitCode !== null || child.signalCode !== null);
}

function shutdown(signal, code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  exitCode = code;
  const hint = failureHint();
  if (hint.length > 0) {
    process.stderr.write(hint);
  }
  process.stderr.write("Stopping the API and web app.\n");
  for (const child of children) {
    signalProcessGroup(child, signal);
  }
  setTimeout(() => {
    for (const child of children) {
      signalProcessGroup(child, "SIGKILL");
    }
  }, 5000);
}

function finishIfDone() {
  if (allClosed()) {
    process.exit(exitCode);
  }
}

function start(name, command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  if (child.stdout) {
    prefix(name, child.stdout);
  }
  if (child.stderr) {
    prefix(name, child.stderr);
  }
  child.on("error", (error) => {
    note(name, error.message);
    shutdown("SIGTERM", 1);
    finishIfDone();
  });
  child.on("close", (code, signal) => {
    if (!shuttingDown && (code !== 0 || signal)) {
      note(name, `exited (${signal ?? code})`);
      shutdown("SIGTERM", code ?? 1);
    }
    finishIfDone();
  });
}

process.stderr.write("Starting the API on http://127.0.0.1:3001 and the web app on http://localhost:3000.\n");
process.stderr.write("This command does not migrate or seed. Stop with Ctrl+C.\n");

start("api", process.execPath, [apiEntry], { cwd: repoRoot, env: process.env });
start("web", webDevBin, webDevArgs, { cwd: webAppDir, env: webEnv });

process.on("SIGINT", () => {
  shutdown("SIGINT", 0);
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM", 0);
});
