import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cliReferenceFiles } from "./docs-cli.mjs";
import { openApiJson } from "./docs-openapi.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function checkGeneratedDocs() {
  const mismatches = [];
  const expectedOpenApi = openApiJson();
  const openApiPath = join(repoRoot, "docs", "api-reference", "openapi.json");
  const actualOpenApi = await readOptional(openApiPath);
  if (actualOpenApi !== expectedOpenApi) {
    mismatches.push(relative(openApiPath));
  }

  for (const file of cliReferenceFiles()) {
    const actual = await readOptional(file.path);
    if (actual !== file.contents) {
      mismatches.push(relative(file.path));
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Generated docs are out of date:\n${mismatches.map((path) => `  ${path}`).join("\n")}\nRun: pnpm docs:openapi && pnpm docs:cli`,
    );
  }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function relative(path) {
  return path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkGeneratedDocs();
}
