/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const create = vi.fn();
const remove = vi.fn();

vi.mock("@/auth/client", () => ({
  authClient: {
    apiKey: {
      list: () => list(),
      create: (input: { name: string }) => create(input),
      delete: (input: { keyId: string }) => remove(input)
    }
  }
}));

import ApiKeysPage from "../src/app/(browse)/account/api-keys/page";

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  list.mockReset();
  create.mockReset();
  remove.mockReset();
});

describe("API keys page", () => {
  it("sends a signed-in user with no organization to onboarding", async () => {
    const assigned = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    list.mockResolvedValue({
      data: null,
      error: { status: 403, code: "ORGANIZATION_SETUP_REQUIRED", message: "Create an organization to continue." }
    });
    await render(<ApiKeysPage />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(assigned).toHaveBeenCalledWith("/onboarding");
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
  return container;
}
