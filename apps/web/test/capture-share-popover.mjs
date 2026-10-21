import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(here, "share-popover-shots");
const prefix = process.argv[3] || "share-popover";

const vite = await createViteServer({
  configFile: false,
  root: join(here, "browser"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  css: { postcss: join(here, "../postcss.config.mjs") },
  resolve: {
    alias: {
      "@": join(here, "../src")
    }
  },
  esbuild: { jsx: "automatic" }
});

await vite.listen();
const address = vite.httpServer?.address();
if (typeof address !== "object" || address === null) {
  throw new Error("Share popover harness did not start");
}
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(outDir, { recursive: true });
  for (const [name, viewport] of [
    ["desktop", { width: 1280, height: 800 }],
    ["mobile", { width: 375, height: 812 }]
  ]) {
    const page = await browser.newPage({ viewport });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/share-popover.html`);
    await page.getByRole("button", { name: /Sharing/ }).click();
    const popover = page.getByRole("region", { name: "Public link" });
    await popover.waitFor();
    await page.waitForTimeout(200);
    const path = join(outDir, `${prefix}-${name}.png`);
    await popover.screenshot({ path, animations: "disabled" });
    process.stdout.write(`${path}\n`);
    await page.close();
  }
} finally {
  await browser.close();
  await vite.close();
}
