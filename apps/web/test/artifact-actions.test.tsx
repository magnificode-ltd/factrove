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
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import { ArtifactActions } from "../src/components/artifact-actions";

const id = "123e4567-e89b-42d3-a456-426614174000";
const artifact: ArtifactDto = {
  id,
  creatorUserId: "local-user",
  organizationId: null,
  accessType: "private",
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
  vi.clearAllMocks();
});

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`button ${name} missing`);
  }
  return found;
}

async function renderActions(client: {
  renameArtifact: (id: string, name: string) => Promise<{ artifact: ArtifactDto }>;
  deleteArtifact: (id: string) => Promise<void>;
}) {
  const onRenamed = vi.fn();
  const onDeleted = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <ArtifactActions
        artifactId={id}
        name="Launch notes"
        client={client as unknown as FactroveClient}
        onRenamed={onRenamed}
        onDeleted={onDeleted}
      />
    );
  });
  return { onRenamed, onDeleted };
}

describe("artifact rename and delete", () => {
  it("asks before deleting and leaves the artifact when cancelled", async () => {
    const client = {
      renameArtifact: vi.fn(),
      deleteArtifact: vi.fn()
    };
    const { onDeleted } = await renderActions(client);
    await act(async () => {
      buttonNamed("Delete").click();
    });
    expect(document.querySelector('[data-testid="delete-dialog"]')?.textContent).toContain("Delete this artifact?");
    await act(async () => {
      buttonNamed("Cancel").click();
    });
    expect(document.querySelector('[data-testid="delete-dialog"]')).toBeNull();
    expect(client.deleteArtifact).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("deletes after confirmation and renames from the dialog", async () => {
    const renamed = { ...artifact, name: "Calendar" };
    const client = {
      renameArtifact: vi.fn(async () => ({ artifact: renamed })),
      deleteArtifact: vi.fn(async () => undefined)
    };
    const { onRenamed, onDeleted } = await renderActions(client);

    await act(async () => {
      buttonNamed("Delete").click();
    });
    await act(async () => {
      buttonNamed("Delete artifact").click();
    });
    expect(client.deleteArtifact).toHaveBeenCalledWith(id);
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith("Artifact deleted");

    await act(async () => {
      buttonNamed("Rename").click();
    });
    const input = document.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("name input missing");
    }
    expect(input.value).toBe("Launch notes");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Calendar");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonNamed("Save name").click();
    });
    expect(client.renameArtifact).toHaveBeenCalledWith(id, "Calendar");
    expect(onRenamed).toHaveBeenCalledWith(renamed);
    expect(toast.success).toHaveBeenCalledWith("Name updated");
  });

  it("shows the API error and does not treat a forbidden rename as success", async () => {
    const client = {
      renameArtifact: vi.fn(async () => {
        throw new FactroveApiError("Artifact was not found.", { status: 404, code: "ARTIFACT_NOT_FOUND" });
      }),
      deleteArtifact: vi.fn()
    };
    const { onRenamed } = await renderActions(client);
    await act(async () => {
      buttonNamed("Rename").click();
    });
    await act(async () => {
      buttonNamed("Save name").click();
    });
    expect(onRenamed).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Artifact was not found.");
  });
});
