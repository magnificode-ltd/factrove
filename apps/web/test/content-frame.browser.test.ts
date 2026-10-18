import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HTML_DOCUMENT = "<!doctype html><html><body><p>Hello from Factrove</p></body></html>";
const NOT_FOUND = { error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } };
const UNAVAILABLE = { error: { code: "STORAGE_UNAVAILABLE", message: "Object storage is unavailable." } };

describe("artifact content frame", () => {
  let browser: Browser;
  let vite: ViteDevServer;
  let content: ContentServer;
  let pageOrigin: string;

  beforeAll(async () => {
    vite = await createViteServer({
      configFile: false,
      root: fileURLToPath(new URL("./browser", import.meta.url)),
      server: { host: "127.0.0.1", port: 0, strictPort: false },
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
      throw new Error("Viewer test server did not start");
    }
    pageOrigin = `http://127.0.0.1:${address.port}`;
    content = await startContentServer(pageOrigin);
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await content?.close();
    await vite?.close();
  });

  it("renders confirmed HTML in the sandboxed iframe", async () => {
    content.reset();
    const page = await openViewer(browser, pageOrigin, content.url("ok"));
    try {
      const frame = page.locator("iframe");
      await frame.waitFor({ timeout: 15_000 });
      expect(await frame.getAttribute("sandbox")).toBe("allow-scripts");
      expect(await frame.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(await frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
      expect(await page.locator("#root").innerHTML()).not.toContain("Hello from Factrove");
      expect(await page.frameLocator("iframe").locator("p").innerText()).toBe("Hello from Factrove");
    } finally {
      await page.close();
    }
  }, 30_000);

  it("shows a retry state when metadata succeeds and content is missing", async () => {
    content.reset();
    const page = await openViewer(browser, pageOrigin, content.url("not-found"));
    try {
      await expectFailure(page, "Artifact was not found.");
    } finally {
      await page.close();
    }
  }, 30_000);

  it("shows a retry state for unavailable content and renders HTML after retry", async () => {
    content.reset();
    const page = await openViewer(browser, pageOrigin, content.url("recovers"));
    try {
      await expectFailure(page, "Object storage is unavailable.");
      await page.getByRole("button", { name: "Try again" }).click();
      await page.locator("iframe").waitFor({ timeout: 15_000 });
      expect(await page.frameLocator("iframe").locator("p").innerText()).toBe("Hello from Factrove");
      expect(await page.locator("#root").innerHTML()).not.toContain("Hello from Factrove");
    } finally {
      await page.close();
    }
  }, 30_000);
});

async function openViewer(browser: Browser, pageOrigin: string, contentUrl: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${pageOrigin}/?contentUrl=${encodeURIComponent(contentUrl)}`);
  return page;
}

async function expectFailure(page: Page, hiddenMessage: string): Promise<void> {
  const alert = page.getByRole("alert");
  await alert.waitFor({ timeout: 15_000 });
  expect(await alert.innerText()).toContain("The artifact content could not be loaded. Refresh to try again.");
  expect(await page.getByRole("button", { name: "Try again" }).count()).toBe(1);
  expect(await page.locator("iframe").count()).toBe(0);
  const html = await page.content();
  expect(html).not.toContain(hiddenMessage);
  expect(html).not.toContain("STORAGE_UNAVAILABLE");
  expect(html).not.toContain("ARTIFACT_NOT_FOUND");
}

type Outcome = "ok" | "not-found" | "recovers";

type ContentServer = {
  url: (outcome: Outcome) => string;
  reset: () => void;
  close: () => Promise<void>;
};

function startContentServer(pageOrigin: string): Promise<ContentServer> {
  let hits = 0;
  const server: Server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", pageOrigin);
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const outcome = url.searchParams.get("outcome");
    hits += 1;
    if (outcome === "not-found") {
      sendJson(response, 404, NOT_FOUND);
      return;
    }
    if (outcome === "recovers" && hits === 1) {
      sendJson(response, 503, UNAVAILABLE);
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(HTML_DOCUMENT);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        throw new Error("Content test server did not start");
      }
      const origin = `http://127.0.0.1:${address.port}`;
      resolve({
        url: (outcome) => `${origin}/api/v1/artifacts/123e4567-e89b-42d3-a456-426614174000/content?outcome=${outcome}`,
        reset: () => {
          hits = 0;
        },
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          })
      });
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
