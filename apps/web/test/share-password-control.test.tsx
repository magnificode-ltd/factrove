/**
 * @vitest-environment happy-dom
 */
import { act } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

import { toast } from "sonner";
import { ShareControl } from "../src/components/share-control";

const id = "123e4567-e89b-42d3-a456-426614174000";
const shareUrl = `https://factrove.app/share/${id}/${"a".repeat(43)}`;
let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

type Call = { url: string; method: string; credentials: RequestCredentials | undefined; body: string | null };

function ownerApi() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input),
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      body: typeof init?.body === "string" ? init.body : null
    };
    calls.push(call);
    const passwordProtected = call.method === "POST" && call.body !== null;
    return new Response(JSON.stringify({ share: { shared: true, shareUrl, passwordProtected } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  return calls;
}

async function renderControl(passwordProtected: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<ShareControl artifactId={id} initial={{ shared: true, shareUrl, passwordProtected }} />);
  });
  return container;
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!found) throw new Error(`button ${name} missing`);
  return found;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(input: HTMLInputElement) {
  await act(async () => {
    input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("share password controls", () => {
  it("validates, then sets a password with the owner session", async () => {
    const calls = ownerApi();
    const container = await renderControl(false);
    const section = container.querySelector('[data-testid="share-password"]');
    expect(section?.getAttribute("data-protected")).toBe("false");
    expect(section?.textContent).toContain("No password");

    await act(async () => {
      button(container, "Add password").click();
    });
    const input = container.querySelector<HTMLInputElement>('input[name="share-password"]');
    if (!input) throw new Error("password field missing");
    expect(input.type).toBe("password");
    expect(document.activeElement).toBe(input);

    await type(input, "short");
    await submit(input);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Use at least 8 characters.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(calls).toHaveLength(0);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Show password"]')?.click();
    });
    expect(input.type).toBe("text");

    await type(input, "open sesame 42");
    await submit(input);
    expect(calls).toEqual([
      {
        url: `http://localhost:3001/api/v1/artifacts/${id}/share`,
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ password: "open sesame 42" })
      }
    ]);
    expect(toast.success).toHaveBeenCalledWith("Password set", expect.anything());
    expect(section?.getAttribute("data-protected")).toBe("true");
    expect(section?.textContent).toContain("Password protected");
    expect(container.querySelector('input[name="share-password"]')).toBeNull();
    expect(container.textContent).not.toContain("open sesame 42");
    expect(container.textContent).toContain("Anyone with this link and its password");
  });

  it("changes and removes an existing password", async () => {
    const calls = ownerApi();
    const container = await renderControl(true);
    await act(async () => {
      button(container, "Change password").click();
    });
    const input = container.querySelector<HTMLInputElement>('input[name="share-password"]');
    if (!input) throw new Error("password field missing");
    await type(input, "a brand new one");
    await submit(input);
    expect(toast.success).toHaveBeenCalledWith("Password changed", expect.anything());

    await act(async () => {
      button(container, "Remove password").click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(calls.at(-1)).toMatchObject({
      url: `http://localhost:3001/api/v1/artifacts/${id}/share/password`,
      method: "DELETE"
    });
    expect(toast.success).toHaveBeenCalledWith("Password removed");
    expect(container.querySelector('[data-testid="share-password"]')?.getAttribute("data-protected")).toBe("false");
  });
});
