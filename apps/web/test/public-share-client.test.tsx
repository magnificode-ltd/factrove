/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
 */
import { createElement } from "react";
import { act } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicBrowserClient } from "../src/api/client";
import { PublicShareLoader } from "../src/share/public-share-loader";
import { readShareGrant, saveShareGrant } from "../src/share/share-grant-store";

const id = "123e4567-e89b-42d3-a456-426614174000";
const token = "a".repeat(43);
let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("public share page", () => {
  it("loads the artifact in the browser without a session cookie", async () => {
    const calls: Array<{ url: string; credentials: RequestCredentials | undefined; cookie: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        credentials: init?.credentials,
        cookie: headers.get("cookie")
      });
      return new Response(
        JSON.stringify({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    };

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(PublicShareLoader, { id, token, fetchImpl }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.credentials).toBe("omit");
    expect(calls[0]?.cookie).toBeNull();
    expect(calls[0]?.url).toBe(`http://localhost:3001/api/v1/public/artifacts/${id}/${token}`);
    expect(container.textContent).toContain("This artifact does not exist.");
    expect(container.textContent).not.toContain("Back to library");
  });

  it("strips cookies from a caller-supplied fetch", async () => {
    let credentials: RequestCredentials | undefined;
    let cookie: string | null = "present";
    const client = createPublicBrowserClient(async (_input, init) => {
      credentials = init?.credentials;
      cookie = new Headers(init?.headers).get("cookie");
      return new Response(JSON.stringify({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    });
    await expect(client.getPublicArtifact(id, token)).rejects.toMatchObject({ status: 404, code: "ARTIFACT_NOT_FOUND" });
    expect(credentials).toBe("omit");
    expect(cookie).toBeNull();
  });
});

type Call = { url: string; method: string; credentials: RequestCredentials | undefined; grant: string | null; body: string | null };

const apiBase = `http://localhost:3001/api/v1/public/artifacts/${id}/${token}`;
const grant = { token: `g1.${"z".repeat(6)}.${"q".repeat(43)}`, expiresAt: "2099-01-01T00:00:00.000Z" };
const unlockedArtifact = {
  id,
  filename: "secret-plan.html",
  mimeType: "text/html",
  sizeBytes: 42,
  uploadedAt: "2026-10-18T12:00:00.000Z",
  contentUrl: `${apiBase}/content?ticket=t1.abc.nonce.mac`,
  passwordProtected: true
};

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders }
  });
}

function passwordRequired(): Response {
  return json({ error: { code: "PASSWORD_REQUIRED", message: "This link needs a password." } }, 401);
}

function lockedApi(options: { password?: string; throttle?: boolean; busy?: boolean; retryAfter?: string } = {}) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      grant: headers.get("x-factrove-share-grant"),
      body: typeof init?.body === "string" ? init.body : null
    };
    calls.push(call);
    if (call.url === `${apiBase}/unlock`) {
      const retryAfter = options.retryAfter === undefined ? undefined : { "retry-after": options.retryAfter };
      if (options.busy) {
        return json(
          { error: { code: "UNLOCK_UNAVAILABLE", message: "Password verification is busy. Try again." } },
          503,
          retryAfter
        );
      }
      if (options.throttle) {
        return json(
          { error: { code: "RATE_LIMITED", message: "Too many password attempts. Try again later." } },
          429,
          retryAfter
        );
      }
      const sent = JSON.parse(call.body ?? "{}") as { password?: string };
      if (sent.password !== (options.password ?? "correct horse")) {
        return json({ error: { code: "PASSWORD_INCORRECT", message: "That password is not right." } }, 401);
      }
      return json({ grant });
    }
    if (call.url === apiBase && call.grant === grant.token) {
      return json({ artifact: unlockedArtifact });
    }
    return passwordRequired();
  };
  return { calls, fetchImpl };
}

async function render(fetchImpl: typeof fetch) {
  const frameRequests: Array<{ url: string; credentials: RequestCredentials | undefined }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    frameRequests.push({ url: String(input), credentials: init?.credentials });
    return new Response("<p>ok</p>", { status: 200, headers: { "content-type": "text/html" } });
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {}
  }));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PublicShareLoader, { id, token, fetchImpl }));
  });
  await settle();
  return { container, frameRequests };
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function submitPassword(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('input[name="password"]');
  if (!input) throw new Error("password field missing");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
  return input;
}

describe("password-protected public share page", () => {
  it("shows a password page with no content for a protected link, and a 404 notice for a bad one", async () => {
    const { container, frameRequests } = await render(lockedApi().fetchImpl);
    expect(container.textContent).toContain("This artifact is locked");
    expect(container.querySelector('input[name="password"]')?.getAttribute("type")).toBe("password");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("secret-plan.html");
    expect(container.textContent).not.toContain("This artifact does not exist.");
    expect(frameRequests).toHaveLength(0);

    act(() => root?.unmount());
    document.body.innerHTML = "";
    const missing = await render(async () =>
      json({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }, 404)
    );
    expect(missing.container.textContent).toContain("This artifact does not exist.");
    expect(missing.container.querySelector('input[name="password"]')).toBeNull();
  });

  it("keeps the artifact hidden and flags the field after a wrong password", async () => {
    const api = lockedApi();
    const { container } = await render(api.fetchImpl);
    const input = await submitPassword(container, "wrong guess");

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "That password didn't work. Check it and try again."
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("form")?.className).toContain("ft-shake");
    expect(container.querySelector("iframe")).toBeNull();
    expect(readShareGrant(id, token)).toBeNull();
    const unlock = api.calls.find((call) => call.url.endsWith("/unlock"));
    expect(unlock).toMatchObject({ method: "POST", credentials: "omit" });
    expect(JSON.parse(unlock?.body ?? "{}")).toEqual({ password: "wrong guess" });
    expect(api.calls.every((call) => !call.url.includes("wrong"))).toBe(true);
  });

  it("unlocks, keeps the grant out of every URL, and reuses it after a reload", async () => {
    const api = lockedApi();
    const { container, frameRequests } = await render(api.fetchImpl);
    await submitPassword(container, "correct horse");
    await settle();

    expect(readShareGrant(id, token)).toBe(grant.token);
    const detail = api.calls.filter((call) => call.url === apiBase);
    expect(detail.at(-1)).toMatchObject({ grant: grant.token, credentials: "omit" });
    expect(container.textContent).toContain("secret-plan.html");
    expect(container.textContent).toContain("Unlocked with password");
    expect(container.querySelector('[data-testid="share-content"]')).not.toBeNull();
    expect(frameRequests).toEqual([{ url: unlockedArtifact.contentUrl, credentials: "omit" }]);
    for (const call of [...api.calls, ...frameRequests]) {
      expect(call.url).not.toContain(grant.token);
      expect(call.url).not.toContain("correct");
    }
    expect(container.innerHTML).not.toContain(grant.token);

    act(() => root?.unmount());
    document.body.innerHTML = "";
    const reload = lockedApi();
    const again = await render(reload.fetchImpl);
    expect(reload.calls).toHaveLength(1);
    expect(reload.calls[0]?.grant).toBe(grant.token);
    expect(again.container.textContent).toContain("secret-plan.html");
  });

  it("drops a grant the API rejects and asks for the password again", async () => {
    saveShareGrant(id, token, { token: "g1.stale.grant", expiresAt: "2099-01-01T00:00:00.000Z" });
    const { container } = await render(lockedApi().fetchImpl);
    expect(container.textContent).toContain("Your access expired or the password changed.");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("ignores stored grants that expired or belong to another link", () => {
    saveShareGrant(id, token, { token: "g1.old", expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(readShareGrant(id, token)).toBeNull();
    saveShareGrant(id, "b".repeat(43), grant);
    expect(readShareGrant(id, token)).toBeNull();
  });

  it("explains throttling without marking the password wrong", async () => {
    const { container } = await render(lockedApi({ throttle: true }).fetchImpl);
    const input = await submitPassword(container, "anything at all");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Too many attempts. Wait a few minutes, then try again."
    );
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("shows how long to wait when Retry-After is present", async () => {
    const { container } = await render(lockedApi({ throttle: true, retryAfter: "12" }).fetchImpl);
    const input = await submitPassword(container, "anything at all");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Too many attempts. Try again in 12s.");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("retries a busy unlock and then tells the visitor to try again", async () => {
    const { container } = await render(lockedApi({ busy: true, retryAfter: "0" }).fetchImpl);
    await submitPassword(container, "anything at all");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (container.querySelector('[role="alert"]')?.textContent === "Busy, try again shortly.") {
        break;
      }
      await settle();
    }
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Busy, try again shortly.");
  });
});
