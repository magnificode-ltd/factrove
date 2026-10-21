import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildOpenApiDocument } from "../packages/contracts/dist/openapi.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(repoRoot, "docs", "api-reference", "openapi.json");

export function openApiJson() {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}

export async function writeOpenApiDocument() {
  await mkdir(dirname(outputPath), { recursive: true });
  const json = openApiJson();
  await writeFile(outputPath, json);
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeOpenApiDocument();
}
