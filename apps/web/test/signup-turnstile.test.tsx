/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ value: "" }));
const signUpEmail = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(query.value),
}));

vi.mock("@/auth/client", () => ({
  authClient: {
    signUp: {
      email: (...args: unknown[]) => signUpEmail(...args),
    },
  },
}));

import SignupPage from "../src/app/(browse)/signup/page";

const TEST_SITE_KEY = "1x00000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const invitePath = "/invites/accept?token=invite-token";

let root: Root | undefined;
const reset = vi.fn();

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  document.cookie = "factrove-invite-next=; Path=/; Max-Age=0";
  query.value = "";
  signUpEmail.mockReset();
  reset.mockReset();
  delete window.turnstile;
  delete process.env.TURNSTILE_SITE_KEY;
});

describe("signup Turnstile widget", () => {
  it("renders nothing and sends the same payload when no site key is set", async () => {
    signUpEmail.mockResolvedValue({ error: null });
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const container = await render(<SignupPage />);
    expect(container.querySelector("[data-turnstile]")).toBeNull();
    expect(document.querySelector("script[src*='turnstile']")).toBeNull();
    await submit(container);
    expect(signUpEmail).toHaveBeenCalledWith({
      name: "Bea",
      email: "bea@example.com",
      password: "password-123",
    });
    assigned.mockRestore();
  });

  it("sends the token with an invitation signup", async () => {
    process.env.TURNSTILE_SITE_KEY = TEST_SITE_KEY;
    stubTurnstile(DUMMY_TOKEN);
    query.value = `next=${encodeURIComponent(invitePath)}&email=bea@example.com`;
    signUpEmail.mockResolvedValue({ error: null });
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const container = await render(<SignupPage />);
    expect(container.querySelector("[data-turnstile]")).not.toBeNull();
    await submit(container);
    expect(signUpEmail).toHaveBeenCalledWith({
      name: "Bea",
      email: "bea@example.com",
      password: "password-123",
      callbackURL: invitePath,
      turnstileToken: DUMMY_TOKEN,
    });
    expect(assigned).toHaveBeenCalledWith(invitePath);
    assigned.mockRestore();
  });

  it("asks for the check before calling signup when the token is missing", async () => {
    process.env.TURNSTILE_SITE_KEY = TEST_SITE_KEY;
    stubTurnstile(null);
    const container = await render(<SignupPage />);
    await submit(container);
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Complete the check and try again.");
  });

  it("shows a retryable failure and resets the widget", async () => {
    process.env.TURNSTILE_SITE_KEY = TEST_SITE_KEY;
    stubTurnstile(DUMMY_TOKEN);
    signUpEmail.mockResolvedValue({
      error: { code: "CAPTCHA_UNAVAILABLE", message: "raw" },
    });
    const container = await render(<SignupPage />);
    await submit(container);
    expect(container.querySelector("[role='alert']")?.textContent).toBe(
      "The signup check could not be completed. Try again.",
    );
    expect(reset).toHaveBeenCalled();
  });

  it("shows the failed-check message for an invalid token", async () => {
    process.env.TURNSTILE_SITE_KEY = TEST_SITE_KEY;
    stubTurnstile(DUMMY_TOKEN);
    signUpEmail.mockResolvedValue({
      error: { code: "CAPTCHA_FAILED", message: "nope" },
    });
    const container = await render(<SignupPage />);
    await submit(container);
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Complete the check and try again.");
    expect(reset).toHaveBeenCalled();
  });

  it("leaves the widget off when the site key is not a Turnstile key", async () => {
    process.env.TURNSTILE_SITE_KEY = "not a key";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const container = await render(<SignupPage />);
    expect(container.querySelector("[data-turnstile]")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

function stubTurnstile(token: string | null): void {
  window.turnstile = {
    render: (_element, options) => {
      if (token) {
        options.callback(token);
      }
      return "widget-1";
    },
    remove: () => undefined,
    reset,
  };
}

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

async function submit(container: HTMLElement): Promise<void> {
  for (const [name, value] of [["name", "Bea"], ["email", "bea@example.com"], ["password", "password-123"]] as const) {
    const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) {
      throw new Error(`${name} missing`);
    }
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
