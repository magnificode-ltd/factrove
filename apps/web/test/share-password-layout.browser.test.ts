import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 812 },
  { name: "narrow", width: 320, height: 700 }
] as const;

describe("share password layout", () => {
  let browser: Browser;
  let vite: ViteDevServer;
  let pageOrigin: string;

  beforeAll(async () => {
    vite = await createViteServer({
      configFile: false,
      root: fileURLToPath(new URL("./browser", import.meta.url)),
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      css: { postcss: fileURLToPath(new URL("../postcss.config.mjs", import.meta.url)) },
      resolve: {
        alias: {
          "@": fileURLToPath(new URL("../src", import.meta.url))
        }
      },
      esbuild: { jsx: "automatic" }
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Share popover harness did not start");
    }
    pageOrigin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
  });

  it("lets protected copy use the row and keeps the buttons below it", async () => {
    for (const viewport of viewports) {
      const page = await openPopover(browser, pageOrigin, viewport);
      try {
        const copy = page.getByTestId("share-password-copy");
        const actions = page.getByTestId("share-password-actions");
        const copyBox = await copy.boundingBox();
        const actionsBox = await actions.boundingBox();
        if (!copyBox || !actionsBox) {
          throw new Error(`missing boxes at ${viewport.name}`);
        }

        expect(copyBox.width, viewport.name).toBeGreaterThan(160);
        expect(actionsBox.y, viewport.name).toBeGreaterThanOrEqual(copyBox.y + copyBox.height - 2);
        expect(actionsBox.x, viewport.name).toBeGreaterThanOrEqual(copyBox.x - 2);
        expect(await copy.innerText()).toContain("Visitors unlock it once per tab. Access lasts 15 minutes.");
        expect(await copyIsClipped(page), viewport.name).toBe(false);
        expect(overlaps(copyBox, actionsBox), viewport.name).toBe(false);
      } finally {
        await page.close();
      }
    }
  }, 30_000);

  it("keeps unlocked password actions on the same wrapping row at desktop width", async () => {
    const page = await openPopover(browser, pageOrigin, viewports[0], false);
    try {
      const layout = page.getByTestId("share-password-layout");
      const copy = page.getByTestId("share-password-copy");
      const actions = page.getByTestId("share-password-actions");
      const layoutClass = (await layout.getAttribute("class")) ?? "";
      expect(layoutClass).toContain("flex-wrap");
      expect(layoutClass).not.toContain("grid-cols-[auto_minmax(0,1fr)]");
      const copyBox = await copy.boundingBox();
      const actionsBox = await actions.boundingBox();
      if (!copyBox || !actionsBox) {
        throw new Error("missing unlocked boxes");
      }
      expect(actionsBox.y).toBeLessThan(copyBox.y + copyBox.height);
      expect(actionsBox.x).toBeGreaterThan(copyBox.x + copyBox.width - 8);
    } finally {
      await page.close();
    }
  }, 15_000);
});

async function openPopover(
  browser: Browser,
  pageOrigin: string,
  viewport: { width: number; height: number },
  passwordProtected = true
): Promise<Page> {
  const page = await browser.newPage({ viewport });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const query = passwordProtected ? "" : "?password=off";
  await page.goto(`${pageOrigin}/share-popover.html${query}`);
  await page.getByRole("button", { name: /Sharing/ }).click();
  await page.getByRole("region", { name: "Public link" }).waitFor();
  return page;
}

async function copyIsClipped(page: Page): Promise<boolean> {
  return page.getByTestId("share-password-copy").evaluate((element) => {
    return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
  });
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
