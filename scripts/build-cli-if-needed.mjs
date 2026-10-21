import { spawn } from "node:child_process";
import { open, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Root `pnpm test` builds the CLI once, then sets this so package tests do not rewrite dist while they run.
if (process.env.FACTROVE_CLI_ALREADY_BUILT === "1") {
  process.exit(0);
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const lockPath = join(tmpdir(), "factrove-cli-build.lock");
const staleMs = 120_000;
const waitMs = 180_000;

const handle = await acquire();
let code = 1;
try {
  code = await run("pnpm", ["--filter", "@factrove/cli...", "build"], repoRoot);
} finally {
  await handle.close();
  await unlink(lockPath).catch(() => undefined);
}
process.exit(code);

async function acquire() {
  const started = Date.now();
  for (;;) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (!isAlreadyThere(error)) {
        throw error;
      }
      let age = 0;
      try {
        const info = await stat(lockPath);
        age = Date.now() - info.mtimeMs;
      } catch {
        continue;
      }
      if (age > staleMs) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() - started > waitMs) {
        throw new Error("Timed out waiting to build the CLI.");
      }
      await delay(200);
    }
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function isAlreadyThere(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
