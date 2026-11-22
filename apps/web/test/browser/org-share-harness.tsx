import { createRoot } from "react-dom/client";
import type { ArtifactDto } from "@factrove/contracts";
import { ArtifactCard } from "@/components/artifact-card";
import { Toaster } from "@/components/ui/sonner";
import { ViewerScreen } from "@/viewer/viewer-screen";
import "@/app/globals.css";

const viewerId = "123e4567-e89b-42d3-a456-426614174010";
const libraryId = "123e4567-e89b-42d3-a456-426614174011";
const sharedId = "123e4567-e89b-42d3-a456-426614174012";
const otherId = "123e4567-e89b-42d3-a456-426614174013";
const noOrgId = "123e4567-e89b-42d3-a456-426614174014";
const longName = new URLSearchParams(window.location.search).has("long");
const organization = longName
  ? { id: "long-org", name: "Magnificode Software Development Organization" }
  : { id: "local-org", name: "Local Organization" };

declare global {
  interface Window {
    __holdOrgShare?: boolean;
    __releaseOrgShare?: () => void;
  }
}
const contentUrl = new URL("./hello.html", window.location.href).href;

document.documentElement.style.setProperty("--font-inter", "Inter, ui-sans-serif, system-ui, sans-serif");
document.documentElement.style.setProperty("--font-jetbrains", "'JetBrains Mono', ui-monospace, monospace");

function artifact(id: string, accessType: ArtifactDto["accessType"], creatorUserId = "local-user"): ArtifactDto {
  return {
    id,
    creatorUserId,
    organizationId: accessType === "private" ? null : organization.id,
    accessType,
    filename: `${id}.html`,
    name: id === viewerId ? "Launch notes" : "Library notes",
    mimeType: "text/html",
    sizeBytes: 128,
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
    uploadedAt: "2026-10-22T12:00:00.000Z",
    viewerUrl: `http://localhost:3000/artifacts/${id}`,
    contentUrl,
    shared: false,
    passwordProtected: false
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "PATCH" && String(input).endsWith("/name")) {
    const url = String(input);
    const parts = url.split("/");
    const id = decodeURIComponent(parts[parts.length - 2] ?? "");
    const parsed = typeof init?.body === "string" ? JSON.parse(init.body) as { name?: unknown } : {};
    const nextName = typeof parsed.name === "string" ? parsed.name : null;
    const current = artifact(id, id === sharedId ? "org_shared" : "private");
    return new Response(
      JSON.stringify({
        artifact: {
          ...current,
          name: nextName,
          updatedAt: "2026-10-22T12:05:00.000Z"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (method === "PATCH") {
    const url = String(input);
    const id = decodeURIComponent(url.split("/").pop() ?? "");
    const current = artifact(id, "private");
    let organizationId = organization.id;
    if (typeof init?.body === "string") {
      const parsed = JSON.parse(init.body) as { organizationId?: unknown };
      if (typeof parsed.organizationId === "string") {
        organizationId = parsed.organizationId;
      }
    }
    if (window.__holdOrgShare) {
      document.body.dataset.patchPending = "1";
      await new Promise<void>((resolve) => {
        window.__releaseOrgShare = resolve;
      });
      delete document.body.dataset.patchPending;
    }
    return new Response(
      JSON.stringify({
        artifact: {
          ...current,
          accessType: "org_shared",
          organizationId,
          updatedAt: "2026-10-22T12:05:00.000Z"
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (String(input).endsWith("/context")) {
    return new Response(JSON.stringify({
      user: { id: "local-user", name: "Local User" },
      organization
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};

const viewer = artifact(viewerId, "private");
const root = document.getElementById("root");
if (!root) {
  throw new Error("root is required");
}

createRoot(root).render(
  <>
    <ViewerScreen
      state={{
        status: "ready",
        artifact: viewer,
        share: { shared: false, shareUrl: null, passwordProtected: false },
        organization,
        owner: true
      }}
    />
    <section data-testid="library-row" className="bg-cloud px-6 py-8">
      <ul className="grid list-none gap-3 p-0">
        <ArtifactCard artifact={artifact(libraryId, "private")} now={Date.parse("2026-10-22T12:02:00.000Z")} canShare organization={organization} />
        <ArtifactCard artifact={artifact(sharedId, "org_shared")} now={Date.parse("2026-10-22T12:02:00.000Z")} canShare organization={organization} />
        <ArtifactCard artifact={artifact(otherId, "private", "other-user")} now={Date.parse("2026-10-22T12:02:00.000Z")} organization={organization} />
        <ArtifactCard artifact={artifact(noOrgId, "private")} now={Date.parse("2026-10-22T12:02:00.000Z")} canShare organization={null} />
      </ul>
    </section>
    <Toaster />
  </>
);
