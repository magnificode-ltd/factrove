/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("<Toaster />");
    const screens = [
      "src/library/library-screen.tsx",
      "src/viewer/viewer-screen.tsx",
      "src/app/account/api-keys/page.tsx"
    ];
    for (const screen of screens) {
      const source = readFileSync(join(process.cwd(), screen), "utf8");
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
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(document.body.textContent).toContain("API key created");
  });
});
