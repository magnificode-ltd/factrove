/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(() => Promise.resolve());
const assign = vi.fn();

vi.mock("@/auth/client", () => ({
  authClient: {
    signOut: () => signOut()
  }
}));

import { AccountMenu } from "../src/components/account-menu";

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  signOut.mockClear();
  assign.mockClear();
});

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(node);
  });
  return container;
}

function openMenu() {
  const trigger = document.querySelector("button");
  if (!trigger) {
    throw new Error("Missing account menu trigger");
  }
  act(() => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
}

describe("Account menu", () => {
  it("shows the account, organization, API keys, and sign out", () => {
    render(<AccountMenu name="Local User" organization={null} />);
    const trigger = document.querySelector("button");
    expect(trigger?.getAttribute("aria-label")).toBe("Account menu for Local User");
    expect(trigger?.textContent).toBe("LU");
    expect(document.body.textContent).not.toContain("Sign out");

    openMenu();

    expect(document.body.textContent).toContain("Local User");
    expect(document.body.textContent).toContain("No organization");
    const keys = document.querySelector('a[href="/account/api-keys"]');
    expect(keys?.textContent).toBe("API keys");
    expect(document.body.textContent).toContain("Sign out");

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.body.textContent).not.toContain("Sign out");
  });

  it("signs out and returns home", () => {
    vi.spyOn(window.location, "assign").mockImplementation(assign);
    render(<AccountMenu name="Ada Lovelace" organization="Analytical Engines" />);
    expect(document.querySelector("button")?.textContent).toBe("AL");
    openMenu();
    const signOutItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === "Sign out");
    expect(signOutItem).toBeTruthy();
    act(() => {
      signOutItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(signOut).toHaveBeenCalledOnce();
    return signOut.mock.results[0]?.value.then(() => {
      expect(assign).toHaveBeenCalledWith("/");
    });
  });
});
