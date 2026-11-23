/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactroveApiError } from "@factrove/api-client";

const previewInvitation = vi.fn();
const acceptInvitation = vi.fn();
const getSession = vi.fn();
const signOut = vi.fn(() => Promise.resolve());

vi.mock("@/api/client", () => ({
  createWebClient: () => ({
    previewInvitation,
    acceptInvitation,
  }),
}));

vi.mock("@/auth/client", () => ({
  authClient: {
    getSession: () => getSession(),
    signOut: () => signOut(),
  },
}));

import { AcceptInvite } from "../src/components/accept-invite";

let root: Root | undefined;

const preview = {
  organization: { name: "Analytical Engines" },
  inviter: { name: "Ada Owner" },
  email: "bea@example.com",
  expiresAt: "2026-12-01T15:04:00.000Z",
};

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  previewInvitation.mockReset();
  acceptInvitation.mockReset();
  getSession.mockReset();
  signOut.mockClear();
  document.cookie = "factrove-invite-next=; Path=/; Max-Age=0";
});

describe("Accept invitation", () => {
  it("offers sign-in and signup without saying whether the email has an account", async () => {
    previewInvitation.mockResolvedValue(preview);
    getSession.mockResolvedValue({ data: null, error: null });
    const container = await render(<AcceptInvite token="invite-token" />);
    await flush();
    expect(container.textContent).toContain("Join Analytical Engines");
    expect(container.textContent).toContain("Ada Owner invited bea@example.com");
    expect(container.textContent).not.toContain("invite-token");
    const signup = container.querySelector('a[href*="/signup?"]');
    const login = container.querySelector('a[href*="/login?"]');
    expect(signup?.textContent).toBe("Create an account");
    expect(login?.getAttribute("href")).toContain(encodeURIComponent("/invites/accept?token=invite-token"));
    expect(signup?.getAttribute("href")).toContain("email=bea%40example.com");
    expect(container.textContent).not.toContain("already has an account");
    expect(decodeURIComponent(document.cookie)).toContain("/invites/accept?token=invite-token");
  });

  it("joins when the signed-in email matches and is verified", async () => {
    previewInvitation.mockResolvedValue(preview);
    getSession.mockResolvedValue({
      data: { user: { id: "user-bea", email: "Bea@example.com", name: "Bea", emailVerified: true } },
      error: null,
    });
    acceptInvitation.mockResolvedValue({ organization: { id: "org", name: "Analytical Engines" } });
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const container = await render(<AcceptInvite token="invite-token" />);
    await flush();
    const join = [...container.querySelectorAll("button")].find((button) => button.textContent === "Join organization");
    await act(async () => {
      join?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(acceptInvitation).toHaveBeenCalledWith("invite-token");
    expect(assigned).toHaveBeenCalledWith("/");
    expect(decodeURIComponent(document.cookie)).not.toContain("invite-token");
    assigned.mockRestore();
  });

  it("keeps the invitation and asks for the invited email", async () => {
    previewInvitation.mockResolvedValue(preview);
    getSession.mockResolvedValue({
      data: { user: { id: "user-ada", email: "ada@example.com", name: "Ada", emailVerified: true } },
      error: null,
    });
    const container = await render(<AcceptInvite token="invite-token" />);
    await flush();
    expect(container.textContent).toContain("Sign in with bea@example.com");
    expect(container.textContent).not.toContain("Join organization");
  });

  it("asks an unverified matching account to confirm before joining", async () => {
    previewInvitation.mockResolvedValue(preview);
    getSession.mockResolvedValue({
      data: { user: { id: "user-bea", email: "bea@example.com", name: "Bea", emailVerified: false } },
      error: null,
    });
    const container = await render(<AcceptInvite token="invite-token" />);
    await flush();
    expect(container.textContent).toContain("Confirm bea@example.com before joining");
  });

  it("uses one message when the link is not valid", async () => {
    previewInvitation.mockRejectedValue(new FactroveApiError("This invitation link is not valid.", {
      status: 404,
      code: "INVITATION_INVALID",
    }));
    getSession.mockResolvedValue({ data: null, error: null });
    const container = await render(<AcceptInvite token="dead-token" />);
    await flush();
    expect(container.textContent).toContain("This invitation link is not valid");
    expect(container.textContent).not.toContain("expired");
    expect(container.textContent).not.toContain("dead-token");
  });

  it("clears a stored invitation when the link is not valid and leaves for the library", async () => {
    document.cookie = `factrove-invite-next=${encodeURIComponent("/invites/accept?token=dead-token")}; Path=/`;
    let resolvePreview: (value: never) => void = () => undefined;
    previewInvitation.mockReturnValue(new Promise((_resolve, reject) => {
      resolvePreview = reject;
    }));
    getSession.mockResolvedValue({ data: null, error: null });
    const container = await render(<AcceptInvite token="dead-token" />);
    expect(decodeURIComponent(document.cookie)).toContain("/invites/accept?token=dead-token");
    await act(async () => {
      resolvePreview(new FactroveApiError("This invitation link is not valid.", {
        status: 404,
        code: "INVITATION_INVALID",
      }) as never);
    });
    await flush();
    expect(container.textContent).toContain("This invitation link is not valid");
    expect(decodeURIComponent(document.cookie)).not.toContain("dead-token");
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const exit = [...container.querySelectorAll("a")].find((link) => link.textContent === "Go to Factrove");
    await act(async () => {
      exit?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(assigned).toHaveBeenCalledWith("/");
    expect(decodeURIComponent(document.cookie)).not.toContain("dead-token");
    assigned.mockRestore();
  });

  it("forgets the return path when joining is no longer possible", async () => {
    document.cookie = `factrove-invite-next=${encodeURIComponent("/invites/accept?token=invite-token")}; Path=/`;
    previewInvitation.mockResolvedValue(preview);
    getSession.mockResolvedValue({
      data: { user: { id: "user-bea", email: "bea@example.com", name: "Bea", emailVerified: true } },
      error: null,
    });
    acceptInvitation.mockRejectedValue(new FactroveApiError("You already belong to an organization.", {
      status: 409,
      code: "ORGANIZATION_EXISTS",
    }));
    const container = await render(<AcceptInvite token="invite-token" />);
    await flush();
    const join = [...container.querySelectorAll("button")].find((button) => button.textContent === "Join organization");
    await act(async () => {
      join?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(container.textContent).toContain("You already belong to an organization.");
    expect(decodeURIComponent(document.cookie)).not.toContain("invite-token");
  });

  it("remembers the invitation only after the preview, and only until it expires", async () => {
    const writes: string[] = [];
    const proto = Object.getPrototypeOf(document);
    const desc = Object.getOwnPropertyDescriptor(proto, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => desc?.get?.call(document) ?? "",
      set: (value: string) => {
        writes.push(value);
        desc?.set?.call(document, value);
      },
    });
    try {
      let resolvePreview: (value: typeof preview) => void = () => undefined;
      previewInvitation.mockReturnValue(new Promise((resolve) => {
        resolvePreview = resolve;
      }));
      getSession.mockResolvedValue({ data: null, error: null });
      await render(<AcceptInvite token="invite-token" />);
      expect(writes.some((line) => line.includes("invite-token"))).toBe(false);
      const expiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      await act(async () => {
        resolvePreview({ ...preview, expiresAt });
      });
      await flush();
      const stored = writes.find((line) => line.includes("invite-token"));
      expect(decodeURIComponent(stored ?? "")).toContain("/invites/accept?token=invite-token");
      expect(stored).toContain("Max-Age=604800");
    } finally {
      if (desc) {
        Object.defineProperty(document, "cookie", desc);
      }
    }
  });
});

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
  });
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
