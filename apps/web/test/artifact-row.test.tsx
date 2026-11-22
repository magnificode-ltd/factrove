/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDto, ContextEnvelope } from "@factrove/contracts";
import { ArtifactCard } from "../src/components/artifact-card";

const organization: ContextEnvelope["organization"] = { id: "local-org", name: "Local Organization" };

function artifact(id: string, accessType: ArtifactDto["accessType"], name: string): ArtifactDto {
  return {
    id,
    creatorUserId: "local-user",
    organizationId: "local-org",
    accessType,
    filename: `${id}.html`,
    name,
    mimeType: "text/html",
    sizeBytes: 2048,
    createdAt: "2026-11-22T12:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
    uploadedAt: "2026-11-22T12:00:00.000Z",
    viewerUrl: `http://localhost:3000/artifacts/${id}`,
    contentUrl: `http://localhost:3001/api/v1/artifacts/${id}/content`,
    shared: false,
    passwordProtected: false
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
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

async function openMenu(scope: ParentNode) {
  const trigger = [...scope.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "More actions");
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new Error("row menu missing");
  }
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
}

function itemNames(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

describe("artifact row menu", () => {
  const now = Date.parse("2026-11-22T12:02:00.000Z");
  const privateId = "123e4567-e89b-42d3-a456-426614174000";
  const sharedId = "223e4567-e89b-42d3-a456-426614174001";

  it("keeps the same row structure and puts secondary actions in the menu", async () => {
    const longName = "Quarterly launch review for the north region board pack, the stakeholder archive, and the November appendix";
    const container = render(
      <ul>
        <ArtifactCard
          artifact={artifact(privateId, "private", longName)}
          now={now}
          canShare
          organization={organization}
        />
        <ArtifactCard
          artifact={artifact(sharedId, "org_shared", "Library notes")}
          now={now}
          canShare
          organization={organization}
        />
      </ul>
    );

    const rows = [...container.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector(".ft-artifact-row")).toBeTruthy();
      expect(row.querySelector(".ft-artifact-meta")).toBeTruthy();
      expect(row.querySelector(".ft-artifact-actions")).toBeTruthy();
      expect(row.querySelector("button")?.textContent).toContain("Share");
      expect(row.textContent).not.toContain("Share with Local Organization");
      expect(row.textContent).not.toContain("Rename");
      expect(row.textContent).not.toContain("Delete");
    }

    const privateLink = rows[0]?.querySelector("a");
    expect(privateLink?.getAttribute("title")).toBe(longName);
    expect(privateLink?.className).toContain("truncate");
    expect(rows[0]?.querySelector("code")?.textContent).toBe(privateId.slice(0, 8));
    expect(rows[1]?.querySelector("code")?.textContent).toBe(sharedId.slice(0, 8));

    await openMenu(rows[0] ?? container);
    expect(itemNames()).toEqual(["Rename", "Copy ID", "Share with Local Organization", "Delete"]);

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await openMenu(rows[1] ?? container);
    expect(itemNames()).toEqual(["Rename", "Copy ID", "Delete"]);
  });

  it("hides owner actions when the viewer cannot share", async () => {
    const container = render(
      <ArtifactCard artifact={artifact(privateId, "private", "Library notes")} now={now} organization={organization} />
    );
    expect(container.textContent).not.toContain("Share");
    await openMenu(container);
    expect(itemNames()).toEqual(["Copy ID"]);
  });

  it("omits organization sharing when the artifact is private and the account has no organization", async () => {
    const container = render(
      <ArtifactCard artifact={artifact(privateId, "private", "Library notes")} now={now} canShare organization={null} />
    );
    await openMenu(container);
    expect(itemNames()).toEqual(["Rename", "Copy ID", "Delete"]);
  });
});
