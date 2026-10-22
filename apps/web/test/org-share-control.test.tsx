/**
 * @vitest-environment happy-dom
 */
import { act } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

import { toast } from "sonner";
import type { ArtifactDto } from "@factrove/contracts";
import { OrgShareControl } from "../src/components/org-share-control";

const id = "123e4567-e89b-42d3-a456-426614174000";
const artifact: ArtifactDto = {
  id,
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "org_shared",
  filename: `${id}.html`,
  name: "Launch notes",
  mimeType: "text/html",
  sizeBytes: 12,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:05:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: `http://localhost:3000/artifacts/${id}`,
  contentUrl: `http://localhost:3001/api/v1/artifacts/${id}/content`,
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(name));
  if (!found) {
    throw new Error(`button ${name} missing`);
  }
  return found;
}

async function renderControl(onShared = vi.fn()) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <>
        <span id={`artifact-access-${id}`} tabIndex={-1}>
          Private
        </span>
        <OrgShareControl artifactId={id} organizationName="Local Organization" onShared={onShared} />
      </>
    );
  });
  return onShared;
}

describe("organization share control", () => {
  it("confirms, then patches org_shared and reports the returned artifact", async () => {
    const calls: Array<{ url: string; method: string; body: string | null; credentials: RequestCredentials | undefined }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
        credentials: init?.credentials
      });
      return new Response(JSON.stringify({ artifact }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const onShared = await renderControl();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      buttonNamed("Share with Local Organization").click();
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.textContent).toContain(
      "Members of Local Organization will be able to view this artifact. This can't be undone from the UI yet."
    );
    expect(document.activeElement?.textContent).toContain("Cancel");

    await act(async () => {
      buttonNamed("Cancel").click();
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(calls).toHaveLength(0);

    await act(async () => {
      buttonNamed("Share with Local Organization").click();
    });
    const confirm = [...document.querySelectorAll("button")].filter((candidate) =>
      candidate.textContent?.includes("Share with Local Organization")
    );
    await act(async () => {
      confirm[1]?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(calls).toEqual([
      {
        url: `http://localhost:3001/api/v1/artifacts/${id}`,
        method: "PATCH",
        body: JSON.stringify({ accessType: "org_shared" }),
        credentials: "include"
      }
    ]);
    expect(onShared).toHaveBeenCalledWith(artifact);
    expect(toast.success).toHaveBeenCalledWith("Shared with Local Organization");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the dialog open and shows the API message when sharing fails", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: { code: "ORGANIZATION_REQUIRED", message: "Organization sharing requires membership in an organization." } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );
    const onShared = await renderControl();
    await act(async () => {
      buttonNamed("Share with Local Organization").click();
    });
    const confirm = [...document.querySelectorAll("button")].filter((candidate) =>
      candidate.textContent?.includes("Share with Local Organization")
    );
    await act(async () => {
      confirm[1]?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Organization sharing requires membership in an organization."
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onShared).not.toHaveBeenCalled();
  });
});
