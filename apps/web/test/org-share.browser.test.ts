import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const screenshotDir = process.env.FACTROVE_SCREENSHOT_DIR;

describe("organization share control", () => {
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
      esbuild: { jsx: "automatic" },
      define: {
        "process.env.NEXT_PUBLIC_API_URL": JSON.stringify("http://localhost:3001"),
        "process.env.NODE_ENV": JSON.stringify("test")
      }
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("Organization share harness did not start");
    }
    pageOrigin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
  });

  it("confirms from the keyboard and updates the access label without a reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    try {
      await page.goto(`${pageOrigin}/org-share.html`);
      const header = page.locator("header");
      const trigger = header.getByRole("button", { name: "Share with Local Organization" });
      await trigger.waitFor({ timeout: 10_000 });
      expect(await header.getByTestId("artifact-access").innerText()).toBe("Private");
      await page.frameLocator("iframe").locator("p").waitFor({ timeout: 8_000 });

      const library = page.getByTestId("library-row");
      expect(await library.getByRole("button", { name: "Share with Local Organization" }).count()).toBe(1);
      expect(await library.getByText("Organization shared").count()).toBe(1);
      expect(await page.getByRole("button", { name: "Share with Local Organization" }).count()).toBe(2);

      await saveShot(page, "org-share-owner-private.png");
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Share with Local Organization" });
      await dialog.waitFor();
      expect(await dialog.innerText()).toContain(
        "Members of Local Organization will be able to view this artifact. This can't be undone from the UI yet."
      );
      expect(await focusedText(page)).toContain("Cancel");
      await saveShot(page, "org-share-confirmation.png");

      await page.keyboard.press("Escape");
      expect(await dialog.count()).toBe(0);
      expect(await focusedText(page)).toContain("Share with Local Organization");

      await page.keyboard.press("Enter");
      await dialog.waitFor();
      await page.keyboard.press("Tab");
      expect(await focusedText(page)).toContain("Share with Local Organization");
      expect(await dialog.getByRole("button", { name: "Share with Local Organization" }).evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "hidden", timeout: 5_000 });
      expect(await header.getByTestId("artifact-access").innerText()).toBe("Organization shared");
      expect(await header.getByTestId("artifact-access").evaluate((element) => element === document.activeElement)).toBe(true);
      expect(await header.getByRole("button", { name: "Share with Local Organization" }).count()).toBe(0);
      await page.getByText("Shared with Local Organization").waitFor();
      await saveShot(page, "org-share-after.png");

      const rowTrigger = library.getByRole("button", { name: "Share with Local Organization" });
      await rowTrigger.click();
      await page.getByRole("dialog").getByRole("button", { name: "Share with Local Organization" }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect(await library.getByRole("button", { name: "Share with Local Organization" }).count()).toBe(0);
      expect(await library.getByTestId("artifact-access").first().innerText()).toBe("Organization shared");
    } finally {
      await page.close();
    }
  }, 45_000);
});

async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.textContent ?? "");
}

async function saveShot(page: Page, name: string): Promise<void> {
  if (!screenshotDir) {
    return;
  }
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}/${name}` });
}
