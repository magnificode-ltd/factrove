/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { act } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { toast } from "sonner";
import { Toaster } from "../src/components/ui/sonner";

describe("Toaster", () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    toast.dismiss();
  });

  it("is mounted once from the root layout", () => {
    const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("<Toaster />");
    const screens = [
      "../src/library/library-screen.tsx",
      "../src/viewer/viewer-screen.tsx",
      "../src/app/account/api-keys/page.tsx"
    ];
    for (const screen of screens) {
      const source = readFileSync(new URL(screen, import.meta.url), "utf8");
      expect(source).not.toContain("<Toaster");
    }
  });

  it("renders a toast from the real Toaster", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Toaster />);
    });

    await act(async () => {
      toast.success("API key created");
    });

    expect(document.body.textContent).toContain("API key created");
  });
});
