/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalyticsForTests } from "../src/analytics";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
}));
const imported = vi.hoisted(() => ({ count: 0 }));
const route = vi.hoisted(() => ({ pathname: "/login" }));

vi.mock("posthog-js", () => {
  imported.count += 1;
  return { default: posthog };
});

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}));

import { Analytics } from "../src/components/analytics";

const ARTIFACT_ID = "123e4567-e89b-42d3-a456-426614174000";
const SHARE_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABC";

let root: Root | undefined;

beforeEach(() => {
  imported.count = 0;
  posthog.init.mockClear();
  posthog.capture.mockClear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  delete window.__FACTROVE_PUBLIC__;
  resetAnalyticsForTests();
  route.pathname = "/login";
});

function render(node: ReactNode) {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() => {
    root?.render(node);
  });
}

describe("analytics client", () => {
  it("does not load posthog-js or send requests when no project key is configured", async () => {
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response());
    render(<Analytics />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(imported.count).toBe(0);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.querySelector("script[src*='posthog']")).toBeNull();
    fetchSpy.mockRestore();
  });

  it("records a sanitized pageview on load and on a route change", async () => {
    window.__FACTROVE_PUBLIC__ = { posthogKey: "phc_testkey123", posthogHost: "https://posthog.example.com" };
    route.pathname = `/share/${ARTIFACT_ID}/${SHARE_TOKEN}`;
    render(<Analytics />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(imported.count).toBe(1);
    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.init.mock.calls[0]?.[0]).toBe("phc_testkey123");
    expect(posthog.init.mock.calls[0]?.[1]).toMatchObject({
      api_host: "https://posthog.example.com",
      persistence: "memory",
      autocapture: false,
      disable_session_recording: true,
    });
    expect(posthog.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/share/:id/:id`,
      $pathname: "/share/:id/:id",
    });
    const sent = JSON.stringify(posthog.capture.mock.calls);
    expect(sent).not.toContain(ARTIFACT_ID);
    expect(sent).not.toContain(SHARE_TOKEN);
    route.pathname = "/account/api-keys";
    render(<Analytics />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(posthog.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/account/api-keys`,
      $pathname: "/account/api-keys",
    });
    expect(imported.count).toBe(1);
  });

  it("does not load posthog-js when Do Not Track is set", async () => {
    window.__FACTROVE_PUBLIC__ = { posthogKey: "phc_testkey123" };
    Object.defineProperty(window.navigator, "doNotTrack", { configurable: true, get: () => "1" });
    render(<Analytics />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(imported.count).toBe(0);
    expect(posthog.init).not.toHaveBeenCalled();
    Object.defineProperty(window.navigator, "doNotTrack", { configurable: true, get: () => null });
  });
});
