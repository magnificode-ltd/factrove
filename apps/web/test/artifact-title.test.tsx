/**
 * @vitest-environment happy-dom
 */
import { act } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const renameArtifact = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

vi.mock("@/api/client", () => ({
  createWebClient: () => ({ renameArtifact })
}));

import type { ArtifactDto } from "@factrove/contracts";
import { ArtifactCard } from "../src/components/artifact-card";
import { ViewerScreen } from "../src/viewer/viewer-screen";

const id = "123e4567-e89b-42d3-a456-426614174000";
const artifact: ArtifactDto = {
  id,
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "private",
  filename: `${id}.html`,
  name: "Launch notes",
  mimeType: "text/html",
  sizeBytes: 12,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:05:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: `http://localhost:3000/artifacts/${id}`,
  contentUrl: "file:///artifact.html",
  shared: false,
  passwordProtected: false
};

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  renameArtifact.mockReset();
});

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`button ${name} missing`);
  }
  return found;
}

async function openRowMenu(scope: ParentNode) {
  const trigger = [...scope.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "More actions");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error("row menu missing");
  }
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
}

async function chooseMenuItem(name: string) {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((candidate) => candidate.textContent?.includes(name));
  if (!(item instanceof HTMLElement)) {
    throw new Error(`menu item ${name} missing`);
  }
  await act(async () => {
    item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function fillName(next: string) {
  const input = document.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("name input missing");
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    buttonNamed("Save name").click();
  });
}

describe("artifact title", () => {
  it("shows a renamed library title immediately and keeps copy id on the id", async () => {
    renameArtifact.mockResolvedValue({ artifact: { ...artifact, name: "Calendar" } });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ArtifactCard
          artifact={artifact}
          now={Date.parse("2026-10-11T10:02:00.000Z")}
          canShare
          organization={{ id: "local-org", name: "Local Organization" }}
        />
      );
    });

    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Launch notes");
    expect(link?.getAttribute("title")).toBe("Launch notes");
    expect(container.querySelector("code")?.textContent).toBe(id.slice(0, 8));
    expect(container.querySelector("code")?.getAttribute("title")).toBe(id);
    await openRowMenu(container);
    expect(document.body.textContent).toContain("Rename");
    expect(document.body.textContent).toContain("Copy ID");
    await chooseMenuItem("Rename");
    await fillName("Calendar");
    expect(renameArtifact).toHaveBeenCalledWith(id, "Calendar");
    expect(container.querySelector("a")?.textContent).toBe("Calendar");
    expect(container.querySelector("code")?.textContent).toBe(id.slice(0, 8));
    const copyId = [...container.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Copy ID");
    expect(copyId).toBeTruthy();
  });

  it("shows a renamed viewer title immediately", async () => {
    renameArtifact.mockResolvedValue({ artifact: { ...artifact, name: "Calendar" } });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <ViewerScreen
          state={{
            status: "ready",
            artifact,
            share: { shared: false, shareUrl: null, passwordProtected: false },
            organization: { id: "local-org", name: "Local Organization" },
            owner: true
          }}
        />
      );
    });

    expect(container.querySelector("h1")?.textContent).toBe("Launch notes");
    expect(container.querySelector("h1")?.getAttribute("title")).toBe("Launch notes");
    await openRowMenu(container);
    await chooseMenuItem("Rename");
    await fillName("Calendar");
    expect(container.querySelector("h1")?.textContent).toBe("Calendar");
    expect(container.querySelector("h1")?.getAttribute("title")).toBe("Calendar");
    expect(container.querySelector("code")?.textContent).toBe(id.slice(0, 8));
    expect(container.querySelector("code")?.getAttribute("title")).toBe(id);
  });
});
