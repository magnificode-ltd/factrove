/**
 * @vitest-environment happy-dom
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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
  document.cookie = "factrove-invite-next=; Path=/; Max-Age=0";
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
  it("keeps the confirmation page outside the browse notice", () => {
    const appRoot = path.resolve(process.cwd(), "src/app");
    expect(existsSync(path.join(appRoot, "verify-email/page.tsx"))).toBe(true);
    expect(existsSync(path.join(appRoot, "(browse)/verify-email/page.tsx"))).toBe(false);
    const layout = readFileSync(path.join(appRoot, "(browse)/layout.tsx"), "utf8");
    expect(layout).toContain("VerifyEmailNotice");
  });

  it("confirms a valid token and shows an expired link without one", async () => {
    verifyEmail.mockResolvedValueOnce({ error: null });
    const container = await render(<VerifyEmailScreen token="good-token" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(verifyEmail).toHaveBeenCalledWith({ query: { token: "good-token" } });
    const success = container.querySelector('[data-testid="verify-email-success"]');
    expect(success).not.toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).toContain("Email confirmed");
    expect(container.textContent).toContain("This address is verified. You can keep using Factrove.");
    expect(container.textContent).not.toContain("You can close this page");
    expect(container.textContent).not.toContain("Verify your email");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

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

  it("returns a confirmed invitation to the accept page without showing the token", async () => {
    const page = readFileSync(path.resolve(process.cwd(), "src/app/verify-email/page.tsx"), "utf8");
    expect(page).toContain('referrer: "no-referrer"');
    expect(page).toContain("index: false");
    const returnTo = "/invites/accept?token=invite-token";
    verifyEmail.mockResolvedValueOnce({ error: null });
    const container = await render(<VerifyEmailScreen token="good-token" returnTo={returnTo} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const link = container.querySelector(`a[href="${returnTo}"]`);
    expect(link?.textContent).toBe("Continue");
    expect(link?.getAttribute("href")).toBe(returnTo);
    expect(container.textContent).toContain("Continue to join the organization.");
    expect(container.textContent).not.toContain("invite-token");
    expect(container.textContent).not.toContain("Back to the library");

    document.cookie = `factrove-invite-next=${encodeURIComponent(returnTo)}; Path=/`;
    getSession.mockResolvedValue({ data: { user }, error: null });
    sendVerificationEmail.mockResolvedValue({ error: null });
    const notice = await render(<VerifyEmailNotice />);
    await act(async () => {
      button(notice, "Resend").click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith({ email: "ada@example.com", callbackURL: returnTo });
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
