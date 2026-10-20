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
import { CopyButton } from "../src/components/copy-button";

describe("CopyButton", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("copies the value, swaps to the check, and clears the reset timer on unmount", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<CopyButton value="artifact-id" label="Copy ID" message="Artifact ID copied" />);
    });
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Copy ID");
    expect(button?.querySelector("[data-copied='false']")).not.toBeNull();

    await act(async () => {
      button?.click();
    });

    expect(writeText).toHaveBeenCalledWith("artifact-id");
    expect(toast.success).toHaveBeenCalledWith("Artifact ID copied");
    expect(button?.textContent).toContain("Copied");
    expect(button?.querySelector("[data-copied='true']")).not.toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns to the idle label after the reset delay", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<CopyButton value="plan" label="Copy command" />);
    });
    const button = container.querySelector("button");
    await act(async () => {
      button?.click();
    });
    expect(button?.textContent).toContain("Copied");

    await act(async () => {
      vi.advanceTimersByTime(1800);
    });
    expect(button?.textContent).toContain("Copy command");
    expect(button?.textContent).not.toContain("Copied");
  });

  it("reports a clipboard failure and leaves the idle label", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<CopyButton value="artifact-id" label="Copy ID" />);
    });
    const button = container.querySelector("button");

    await act(async () => {
      button?.click();
    });

    expect(writeText).toHaveBeenCalledWith("artifact-id");
    expect(toast.error).toHaveBeenCalledWith("Could not copy. Select the text and copy it manually.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(button?.textContent).toContain("Copy ID");
    expect(button?.textContent).not.toContain("Copied");
    expect(button?.querySelector("[data-copied='false']")).not.toBeNull();
  });
});
