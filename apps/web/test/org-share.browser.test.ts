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
      await page.waitForFunction(
        () => document.body.textContent?.includes("Shared with \u2068Local Organization\u2069") ?? false
      );
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

  it("keeps focus inside the dialog while the share is pending", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    try {
      await page.goto(`${pageOrigin}/org-share.html`);
      await page.evaluate(() => {
        (window as Window & { __holdOrgShare?: boolean }).__holdOrgShare = true;
      });
      const trigger = page.locator("header").getByRole("button", { name: "Share with Local Organization" });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.body.dataset.patchPending === "1");
      const confirm = dialog.getByRole("button", { name: "Sharing…" });
      expect(await confirm.evaluate((element) => element === document.activeElement)).toBe(true);
      expect(await confirm.evaluate((element) => element.hasAttribute("disabled"))).toBe(false);
      for (let step = 0; step < 8; step += 1) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.querySelector("[data-testid='org-share-dialog']")?.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("org-share-trigger");
      await page.evaluate(() => {
        (window as Window & { __releaseOrgShare?: () => void }).__releaseOrgShare?.();
      });
    } finally {
      await page.close();
    }
  }, 45_000);

  it("keeps a long organization name inside a 390px viewport", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    try {
      await page.goto(`${pageOrigin}/org-share.html?long=1`);
      const name = "Share with Magnificode Software Development Organization";
      const trigger = page.locator("header").getByRole("button", { name });
      await trigger.waitFor({ timeout: 10_000 });
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox).toBeTruthy();
      expect(triggerBox!.x).toBeGreaterThanOrEqual(0);
      expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(390);
      expect(await trigger.evaluate((element) => element.textContent ?? "")).toContain(
        "Magnificode Software Development Organization"
      );
      await trigger.click();
      const dialog = page.getByRole("dialog", { name });
      await dialog.waitFor();
      const confirm = dialog.getByRole("button", { name });
      const confirmBox = await confirm.boundingBox();
      expect(confirmBox).toBeTruthy();
      expect(confirmBox!.x).toBeGreaterThanOrEqual(0);
      expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(390);
      expect(await dialog.innerText()).toContain(
        "Members of Magnificode Software Development Organization will be able to view this artifact."
      );
      await saveShot(page, "org-share-long-name-390.png");
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
