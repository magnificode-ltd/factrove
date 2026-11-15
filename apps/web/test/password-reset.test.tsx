/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const requestPasswordReset = vi.fn();
const resetPassword = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("next=/artifacts/123")
}));

vi.mock("@/auth/client", () => ({
  authClient: {
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
    resetPassword: (...args: unknown[]) => resetPassword(...args)
  }
}));

import { ForgotPasswordForm } from "../src/components/forgot-password-form";
import { ResetPasswordForm } from "../src/components/reset-password-form";
import LoginPage from "../src/app/(browse)/login/page";

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  requestPasswordReset.mockReset();
  resetPassword.mockReset();
});

describe("forgot password", () => {
  it("links to forgot password from sign in and keeps the return path", () => {
    const html = renderToStaticMarkup(<LoginPage />);
    expect(html).toContain('href="/forgot-password?next=%2Fartifacts%2F123"');
    expect(html).toContain("Forgot password?");
    expect(html).toContain("focus-visible:outline-peri-d");
  });

  it("shows the same confirmation when the account exists and when it does not", async () => {
    requestPasswordReset.mockResolvedValueOnce({ error: null });
    const container = await render(<ForgotPasswordForm next="/" />);
    await submitEmail(container, "ada@example.com");
    expect(requestPasswordReset).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(container.querySelector('[data-testid="forgot-password-sent"]')?.textContent).toContain(
      "If an account exists for that address"
    );

    requestPasswordReset.mockResolvedValueOnce({
      error: { status: 404, message: "User not found" }
    });
    const missing = await render(<ForgotPasswordForm next="/" />);
    await submitEmail(missing, "missing@example.com");
    expect(missing.querySelector('[data-testid="forgot-password-sent"]')?.textContent).toContain(
      "If an account exists for that address"
    );
    expect(missing.textContent).not.toContain("User not found");
  });

  it("keeps a rate-limit failure on the form", async () => {
    requestPasswordReset.mockResolvedValueOnce({
      error: { status: 429, message: "Too many requests. Please try again later." }
    });
    const container = await render(<ForgotPasswordForm next="/" />);
    await submitEmail(container, "ada@example.com");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Too many requests");
    expect(container.querySelector('[data-testid="forgot-password-sent"]')).toBeNull();
  });
});

describe("reset password", () => {
  it("asks for a new link when the token is missing", async () => {
    const container = await render(<ResetPasswordForm token={null} next="/artifacts/123" />);
    expect(container.querySelector('[data-testid="reset-password-expired"]')).not.toBeNull();
    expect(container.textContent).toContain("This reset link is not valid");
    expect(href(container, "Request a new link")).toBe("/forgot-password?next=%2Fartifacts%2F123");
    expect(container.querySelector('input[name="password"]')).toBeNull();
  });

  it("checks the password rules before calling the API", async () => {
    const container = await render(<ResetPasswordForm token="reset-token" next="/" />);
    expect(container.textContent).toContain("8 to 128 characters");
    expect(container.querySelector('input[name="password"]')?.getAttribute("type")).toBe("password");
    await submitPasswords(container, "password123", "password123");
    expect(resetPassword).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Choose a less common password.");

    await submitPasswords(container, "canyon-lantern-48", "canyon-lantern-49");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter the same password again.");
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("shows success, and an expired state when the token is rejected", async () => {
    resetPassword.mockResolvedValueOnce({ error: null });
    const container = await render(<ResetPasswordForm token="reset-token" next="/" />);
    await submitPasswords(container, "canyon-lantern-48", "canyon-lantern-48");
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: "canyon-lantern-48", token: "reset-token" });
    expect(container.querySelector('[data-testid="reset-password-success"]')).not.toBeNull();

    resetPassword.mockResolvedValueOnce({ error: { status: 400, message: "Invalid token", code: "INVALID_TOKEN" } });
    const expired = await render(<ResetPasswordForm token="used-token" next="/" />);
    await submitPasswords(expired, "canyon-lantern-48", "canyon-lantern-48");
    expect(expired.querySelector('[data-testid="reset-password-expired"]')).not.toBeNull();
  });
});

async function render(node: ReactNode): Promise<HTMLElement> {
  act(() => {
    root?.unmount();
  });
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

async function submitEmail(container: HTMLElement, email: string) {
  const input = container.querySelector<HTMLInputElement>('input[name="email"]');
  if (!input) throw new Error("email field missing");
  await type(input, email);
  await act(async () => {
    input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function submitPasswords(container: HTMLElement, password: string, confirm: string) {
  const first = container.querySelector<HTMLInputElement>('input[name="password"]');
  const second = container.querySelector<HTMLInputElement>('input[name="confirm"]');
  if (!first || !second) throw new Error("password fields missing");
  await type(first, password);
  await type(second, confirm);
  await act(async () => {
    first.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function href(container: HTMLElement, label: string): string {
  const anchor = [...container.querySelectorAll("a")].find((item) => item.textContent?.trim() === label);
  return anchor?.getAttribute("href") ?? "";
}
