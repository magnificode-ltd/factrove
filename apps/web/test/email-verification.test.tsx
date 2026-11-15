/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const sendVerificationEmail = vi.fn();
const verifyEmail = vi.fn();

vi.mock("@/auth/client", () => ({
  authClient: {
    getSession: () => getSession(),
    sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
    verifyEmail: (...args: unknown[]) => verifyEmail(...args)
  }
}));

import { VerifyEmailNotice } from "../src/components/verify-email-notice";
import { VerifyEmailScreen } from "../src/components/verify-email-screen";

const user = { id: "user-1", email: "ada@example.com", name: "Ada", emailVerified: false };

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  getSession.mockReset();
  sendVerificationEmail.mockReset();
  verifyEmail.mockReset();
});

describe("verify email notice", () => {
  it("shows a resend action for a signed-in unverified person and hides it after dismiss", async () => {
    getSession.mockResolvedValue({ data: { user }, error: null });
    sendVerificationEmail.mockResolvedValue({ error: null });
    const container = await render(<VerifyEmailNotice />);
    expect(container.textContent).toContain("Verify your email.");
    const resend = button(container, "Resend");
    await act(async () => {
      resend.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith({ email: "ada@example.com" });
    expect(container.textContent).toContain("Sent. The link expires in one hour.");

    await act(async () => {
      button(container, "Dismiss email reminder").click();
    });
    expect(container.textContent).not.toContain("Verify your email.");
    expect(window.sessionStorage.getItem("factrove.verify-dismissed.user-1")).toBe("1");
  });

  it("stays quiet for a verified person and for someone signed out", async () => {
    getSession.mockResolvedValueOnce({
      data: { user: { ...user, emailVerified: true } },
      error: null
    });
    const verified = await render(<VerifyEmailNotice />);
    expect(verified.textContent).not.toContain("Verify your email.");

    getSession.mockResolvedValueOnce({ data: null, error: null });
    const signedOut = await render(<VerifyEmailNotice />);
    expect(signedOut.textContent).not.toContain("Verify your email.");
  });

  it("explains a rate limit without sending a second request", async () => {
    getSession.mockResolvedValue({ data: { user }, error: null });
    sendVerificationEmail.mockResolvedValue({ error: { status: 429, message: "Too many requests" } });
    const container = await render(<VerifyEmailNotice />);
    await act(async () => {
      button(container, "Resend").click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Too many emails");
  });
});

describe("verify email page", () => {
  it("confirms a valid token and shows an expired link without one", async () => {
    verifyEmail.mockResolvedValueOnce({ error: null });
    const container = await render(<VerifyEmailScreen token="good-token" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(verifyEmail).toHaveBeenCalledWith({ query: { token: "good-token" } });
    expect(container.querySelector('[data-testid="verify-email-success"]')).not.toBeNull();

    const expired = await render(<VerifyEmailScreen token={null} />);
    expect(expired.querySelector('[data-testid="verify-email-expired"]')).not.toBeNull();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });

  it("shows the expired state when the token is rejected", async () => {
    verifyEmail.mockResolvedValueOnce({ error: { status: 401, code: "TOKEN_EXPIRED", message: "Token expired" } });
    const container = await render(<VerifyEmailScreen token="old-token" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-testid="verify-email-expired"]')).not.toBeNull();
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => {
    return candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name;
  });
  if (!found) {
    throw new Error(`button ${name} missing`);
  }
  return found;
}
