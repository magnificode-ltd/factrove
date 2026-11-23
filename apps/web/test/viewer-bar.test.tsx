/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactDto, ContextEnvelope } from "@factrove/contracts";
import { ViewerScreen } from "../src/viewer/viewer-screen";

const organization: ContextEnvelope["organization"] = { id: "local-org", name: "Local Organization" };
const id = "123e4567-e89b-42d3-a456-426614174000";

function artifact(accessType: ArtifactDto["accessType"] = "private", name: string | null = "Launch notes"): ArtifactDto {
  return {
    id,
    creatorUserId: "local-user",
    organizationId: accessType === "private" ? null : "local-org",
    accessType,
    filename: `${id}.html`,
    name,
    mimeType: "text/html",
    sizeBytes: 13,
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
    uploadedAt: "2026-10-11T10:00:00.000Z",
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
    throw new Error("viewer menu missing");
  }
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
}

function itemNames(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

function screen(options: {
  accessType?: ArtifactDto["accessType"];
  owner?: boolean;
  organization?: ContextEnvelope["organization"];
  name?: string | null;
  share?: { shared: boolean; shareUrl: string | null; passwordProtected: boolean } | null;
}) {
  const item = artifact(options.accessType ?? "private", options.name === undefined ? "Launch notes" : options.name);
  return (
    <ViewerScreen
      state={{
        status: "ready",
        artifact: item,
        owner: options.owner ?? false,
        organization: options.organization === undefined ? organization : options.organization,
        share: options.share === undefined ? { shared: false, shareUrl: null, passwordProtected: false } : options.share
      }}
    />
  );
}

describe("viewer bar", () => {
  it("keeps the name as the title and the short id in the meta line", () => {
    const html = renderToStaticMarkup(screen({ owner: true }));
    expect(html).toContain('title="Launch notes"');
    expect(html).toContain(">Launch notes</h1>");
    expect(html).toContain("truncate");
    expect(html).toContain(`>${id.slice(0, 8)}</code>`);
    expect(html).toContain(`title="${id}"`);
    expect(html).toContain(`aria-label="${id}"`);
    expect(html).not.toContain(`>${id}</code>`);
    expect(html).toContain("Private");
    expect(html).toContain("13 B");
    expect(html).toContain('href="/"');
    expect(html).toContain("Back to library");
    expect(html).toContain("Copy link");
    expect(html).toContain('aria-label="Copy ID"');
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain('data-variant="default"');
    expect(html).not.toContain(">Docs</a>");
    expect(html).not.toContain(">Source code</a>");
    expect(html).not.toContain('class="wm"');
  });

  it("puts secondary actions in one menu and keeps delete apart", async () => {
    const container = render(screen({ owner: true }));
    expect(container.textContent).not.toContain("Rename");
    expect(container.textContent).not.toContain("Delete");
    expect(container.textContent).not.toContain("Share with Local Organization");

    await openMenu(container);
    expect(itemNames()).toEqual(["Rename", "Copy ID", "Share with Local Organization", "Docs", "Source code", "Delete"]);
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.at(-1)?.className).toContain("text-destructive");
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
    const share = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Share");
    expect(share?.getAttribute("data-variant")).toBe("default");
  });

  it("omits organization sharing, rename, and delete when those actions are unavailable", async () => {
    const shared = render(
      screen({ owner: true, accessType: "org_shared" })
    );
    await openMenu(shared);
    expect(itemNames()).toEqual(["Rename", "Copy ID", "Docs", "Source code", "Delete"]);

    act(() => {
      root?.unmount();
    });
    const reader = render(screen({ owner: false }));
    await openMenu(reader);
    expect(itemNames()).toEqual(["Copy ID", "Docs", "Source code"]);
    expect(document.querySelectorAll('[role="separator"]')).toHaveLength(0);

    act(() => {
      root?.unmount();
    });
    const noOrg = render(screen({ owner: true, organization: null }));
    await openMenu(noOrg);
    expect(itemNames()).toEqual(["Rename", "Copy ID", "Docs", "Source code", "Delete"]);
  });
});
