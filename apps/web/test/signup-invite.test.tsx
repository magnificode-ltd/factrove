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

const invitePath = "/invites/accept?token=invite-token";

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  document.cookie = "factrove-invite-next=; Path=/; Max-Age=0";
  query.value = "";
  signUpEmail.mockReset();
});

describe("invitation signup", () => {
  it("sends the accept path as the verification callback and returns there", async () => {
    query.value = `next=${encodeURIComponent(invitePath)}&email=bea@example.com`;
    signUpEmail.mockResolvedValue({ error: null });
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const container = await render(<SignupPage />);
    expect(container.querySelector<HTMLInputElement>('input[name="email"]')?.defaultValue).toBe("bea@example.com");
    expect(decodeURIComponent(document.cookie)).toContain(invitePath);
    await submit(container);
    expect(signUpEmail).toHaveBeenCalledWith({
      name: "Bea",
      email: "bea@example.com",
      password: "password-123",
      callbackURL: invitePath,
    });
    expect(assigned).toHaveBeenCalledWith(invitePath);
    assigned.mockRestore();
  });

  it("does not send an off-site return path", async () => {
    query.value = `next=${encodeURIComponent("https://evil.example/steal")}`;
    signUpEmail.mockResolvedValue({ error: null });
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const container = await render(<SignupPage />);
    await submit(container);
    expect(signUpEmail).toHaveBeenCalledWith({
      name: "Bea",
      email: "bea@example.com",
      password: "password-123",
    });
    expect(assigned).toHaveBeenCalledWith("/");
    expect(document.cookie).not.toContain("evil.example");
    assigned.mockRestore();
  });

  it("drops a leftover invitation before an ordinary signup", async () => {
    document.cookie = `factrove-invite-next=${encodeURIComponent(invitePath)}; Path=/`;
    query.value = "";
    signUpEmail.mockResolvedValue({ error: null });
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    const container = await render(<SignupPage />);
    expect(decodeURIComponent(document.cookie)).not.toContain("invite-token");
    await submit(container);
    expect(signUpEmail).toHaveBeenCalledWith({
      name: "Bea",
      email: "bea@example.com",
      password: "password-123",
    });
    expect(assigned).toHaveBeenCalledWith("/");
    assigned.mockRestore();
  });
});

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
