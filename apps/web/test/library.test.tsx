import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ArtifactDto, ContextEnvelope } from "@factrove/contracts";
import { createWebClient } from "../src/api/client";
import { accessLabel, formatBytes, formatRelativeTime, formatUploadedAt } from "../src/format";
import { docsUrl } from "../src/docs";
import { libraryViewFromParam, loadLibrary } from "../src/library/load-library";
import { LibraryScreen } from "../src/library/library-screen";
import { cliApiOrigin } from "../src/public-config";
import { artifactReturnPath, authPageHref, safeNextPath } from "../src/auth/return-path";
import { loadArtifact } from "../src/viewer/load-artifact";
import { ViewerScreen } from "../src/viewer/viewer-screen";

const mineId = "123e4567-e89b-42d3-a456-426614174000";
const sharedId = "123e4567-e89b-42d3-a456-426614174001";
const otherId = "123e4567-e89b-42d3-a456-426614174002";

const context: ContextEnvelope = {
  user: { id: "local-user", name: "Local User" },
  organization: { id: "local-org", name: "Local Organization" }
};

const noOrganization: ContextEnvelope = {
  user: { id: "local-user", name: "Local User" },
  organization: null
};

function artifact(id: string, accessType: ArtifactDto["accessType"], creatorUserId = "local-user"): ArtifactDto {
  return {
    id,
    creatorUserId,
    organizationId: "local-org",
    accessType,
    filename: `${id}.html`,
    name: null,
    mimeType: "text/html",
    sizeBytes: id === mineId ? 13 : 2048,
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
    uploadedAt: "2026-10-11T10:00:00.000Z",
    viewerUrl: `http://localhost:3000/artifacts/${id}`,
    contentUrl: `http://localhost:3001/api/v1/artifacts/${id}/content`,
    shared: false,
    passwordProtected: false
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.cache).toBe("no-store");
    return handler(String(input));
  }) as typeof fetch;
}

describe("library requests", () => {
  it("requests the selected list and leaves the default tab on mine", async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch(async (url) => {
      urls.push(url);
      if (url.endsWith("/context")) return jsonResponse(context);
      if (url.endsWith("view=org")) return jsonResponse({ items: [artifact(sharedId, "org_shared"), artifact(otherId, "org_shared", "other-user")] });
      return jsonResponse({ items: [artifact(mineId, "private"), artifact(sharedId, "org_shared")] });
    });
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });

    const mine = await loadLibrary(client, libraryViewFromParam(undefined));
    const ignored = await loadLibrary(client, libraryViewFromParam("private"));
    const org = await loadLibrary(client, libraryViewFromParam("org"));

    expect(urls).toContain("http://localhost:3001/api/v1/artifacts?view=mine");
    expect(urls).toContain("http://localhost:3001/api/v1/artifacts?view=org");
    expect(urls.some((url) => url.includes("view=private"))).toBe(false);
    expect(mine.status).toBe("ready");
    expect(ignored.status).toBe("ready");
    expect(org.status).toBe("ready");
    if (mine.status !== "ready" || org.status !== "ready") return;

    const mineHtml = renderToStaticMarkup(<LibraryScreen state={mine} />);
    const orgHtml = renderToStaticMarkup(<LibraryScreen state={org} />);
    expect(mineHtml).toContain(`${mineId}.html`);
    expect(mineHtml).toContain(`${sharedId}.html`);
    expect(mineHtml).not.toContain(`${otherId}.html`);
    expect(mineHtml).toContain("Private");
    expect(mineHtml).toContain("Organization shared");
    expect(mineHtml).toContain("Share with Local Organization");
    expect(orgHtml).not.toContain("Share with Local Organization");
    expect(mineHtml).not.toContain("list only");
    expect(mineHtml).toContain("Private artifacts are visible only to you.");
    expect(mineHtml).not.toContain("Have your agent set it up");
    expect(mineHtml).not.toContain("npm i -g factrove");
    expect(orgHtml).toContain(`${otherId}.html`);
    expect(orgHtml).not.toContain(`${mineId}.html`);
    expect(mineHtml.indexOf(`${mineId}.html`)).toBeLessThan(mineHtml.indexOf(`${sharedId}.html`));
  });

  it("shows an empty organization list for a configured organization", () => {
    const html = renderToStaticMarkup(<LibraryScreen state={{ status: "empty", view: "org", context }} />);
    expect(html).toContain("No organization-shared artifacts for Local Organization.");
    expect(html).toContain("factrove upload plan.html --access org_shared");
    expect(html).toContain("Install and configure are in the");
    expect(html).toContain(`href="${docsUrl("/cli-reference/overview")}"`);
    expect(html).not.toContain("api.factrove.app");
    expect(html).not.toContain("steps are on");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("npm i -g factrove");
    expect(html).not.toContain("Have your agent set it up");
    expect(html).not.toContain("<ul");
  });

  it("shows an empty mine list and a no-organization state without inventing artifacts", async () => {
    const fetchImpl = stubFetch(async (url) => {
      if (url.endsWith("/context")) return jsonResponse(noOrganization);
      if (url.includes("view=org")) return jsonResponse({ items: [artifact(otherId, "org_shared", "other-user")] });
      return jsonResponse({ items: [] });
    });
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const mine = await loadLibrary(client, "mine");
    const org = await loadLibrary(client, "org");
    expect(mine).toMatchObject({ status: "empty", view: "mine" });
    expect(org.status).toBe("no-organization");

    const mineHtml = renderToStaticMarkup(<LibraryScreen state={mine} />);
    const orgHtml = renderToStaticMarkup(<LibraryScreen state={org} />);
    expect(mineHtml).toContain("No artifacts yet");
    expect(mineHtml).toContain("Upload your first artifact");
    expect(mineHtml).toContain("npm i -g factrove");
    expect(mineHtml).toContain("npx factrove");
    expect(mineHtml).toContain("ftrv");
    expect(mineHtml).toContain(`factrove configure --api-url ${cliApiOrigin()}`);
    expect(mineHtml).toContain(`The API origin for this app is ${cliApiOrigin()}.`);
    expect(mineHtml).not.toContain("api.factrove.app");
    expect(mineHtml).toContain('href="/account/api-keys"');
    expect(mineHtml).toContain("factrove upload plan.html");
    expect(mineHtml).toContain("Have your agent set it up");
    expect(mineHtml).toContain(docsUrl("/cli-reference/overview"));
    expect(mineHtml).not.toContain("docs.factrove.app");
    expect(mineHtml).not.toContain("git clone");
    expect(mineHtml).not.toContain("pnpm factrove");
    expect(mineHtml).toContain("Local User · No organization");
    expect(mineHtml).not.toContain("<ul");
    expect(orgHtml).toContain("has no configured organization");
    expect(orgHtml).not.toContain(`${otherId}.html`);
    expect(orgHtml).toContain('href="/?view=org"');
    expect(orgHtml).toContain('aria-current="page"');
  });

  it("reports an unavailable API without rendering a list", async () => {
    const fetchImpl = stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createWebClient({ baseUrl: "http://127.0.0.1:3001", fetch: fetchImpl });
    const state = await loadLibrary(client, "org");
    expect(state).toMatchObject({
      status: "unavailable",
      view: "org",
      message: "The Factrove API is unavailable. Start the backend and refresh."
    });
    const html = renderToStaticMarkup(<LibraryScreen state={state} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("The Factrove API is unavailable");
    expect(html).toContain('href="/?view=org"');
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("list only");
  });

  it("sends a signed-in user with no organization to onboarding", async () => {
    const fetchImpl = stubFetch(async () =>
      jsonResponse({ error: { code: "ORGANIZATION_SETUP_REQUIRED", message: "Create an organization to continue." } }, 403)
    );
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const library = await loadLibrary(client, "mine");
    const viewer = await loadArtifact(client, mineId);
    expect(library).toEqual({ status: "setup-required", view: "mine" });
    expect(viewer).toEqual({ status: "setup-required" });
  });

  it("treats an unauthenticated library as signed out", async () => {
    const fetchImpl = stubFetch(async () =>
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401)
    );
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const state = await loadLibrary(client, "mine");
    expect(state).toEqual({ status: "signed-out", view: "mine" });
    const html = renderToStaticMarkup(<LibraryScreen state={state} />);
    expect(html).toContain("Sign in to see your artifacts.");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("The Factrove API is unavailable");
    expect(html).not.toContain("<ul");
  });

  it("shows the API error message when a list request fails", async () => {
    const fetchImpl = stubFetch(async (url) => {
      if (url.endsWith("/context")) return jsonResponse(context);
      return jsonResponse({ error: { code: "STORAGE_UNAVAILABLE", message: "Storage is unavailable" } }, 503);
    });
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const state = await loadLibrary(client, "mine");
    expect(state).toMatchObject({ status: "unavailable", message: "Storage is unavailable" });
    expect(renderToStaticMarkup(<LibraryScreen state={state} />)).toContain("Storage is unavailable");
  });
});

describe("viewer", () => {
  it("keeps unconfirmed artifact HTML out of the server render", async () => {
    const item = artifact(mineId, "private");
    const fetchImpl = stubFetch(async (url) => {
      if (url.endsWith("/context")) return jsonResponse(context);
      if (url.endsWith("/share")) return jsonResponse({ share: { shared: false, shareUrl: null, passwordProtected: false } });
      expect(url).toBe(`http://localhost:3001/api/v1/artifacts/${mineId}`);
      return jsonResponse({ artifact: item });
    });
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const state = await loadArtifact(client, mineId);
    const html = renderToStaticMarkup(<ViewerScreen state={state} />);

    expect(state).toMatchObject({
      status: "ready",
      owner: true,
      organization: { id: "local-org", name: "Local Organization" }
    });
    expect(html).toContain("Share with Local Organization");
    expect(html).toContain("Checking artifact content…");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain(`${mineId}.html`);
    expect(html).toContain("Back to library");
    expect(html).toContain("13 B");
    expect(html).toContain(formatUploadedAt(item.uploadedAt));
    expect(html).not.toContain("Hello from Factrove");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("hides organization sharing unless the owner has a private artifact and an organization", () => {
    const item = artifact(mineId, "private");
    const organization = { id: "local-org", name: "Local Organization" };
    const owner = renderToStaticMarkup(
      <ViewerScreen state={{ status: "ready", artifact: item, organization, owner: true, share: null }} />
    );
    const shared = renderToStaticMarkup(
      <ViewerScreen
        state={{ status: "ready", artifact: { ...item, accessType: "org_shared" }, organization, owner: true, share: null }}
      />
    );
    const reader = renderToStaticMarkup(
      <ViewerScreen state={{ status: "ready", artifact: item, organization, owner: false, share: null }} />
    );
    const noOrg = renderToStaticMarkup(
      <ViewerScreen state={{ status: "ready", artifact: item, organization: null, owner: true, share: null }} />
    );
    expect(owner).toContain("Share with Local Organization");
    expect(owner).toContain('aria-haspopup="dialog"');
    expect(owner).toContain("Rename");
    expect(owner).toContain("Delete");
    expect(shared).toContain("Rename");
    expect(shared).toContain("Delete");
    expect(reader).not.toContain("Rename");
    expect(reader).not.toContain("Delete");
    expect(shared).not.toContain("Share with Local Organization");
    expect(shared).toContain("Organization shared");
    expect(reader).not.toContain("Share with Local Organization");
    expect(noOrg).not.toContain("Share with Local Organization");
    expect(noOrg).toContain("Private");
  });

  it("shows a missing artifact without an iframe", async () => {
    const fetchImpl = stubFetch(async (url) => {
      if (url.endsWith("/context")) return jsonResponse(context);
      return jsonResponse({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact not found" } }, 404);
    });
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const state = await loadArtifact(client, mineId);
    const html = renderToStaticMarkup(<ViewerScreen state={state} />);
    expect(state).toMatchObject({ status: "missing", message: "Artifact not found" });
    expect(html).toContain("Artifact not found");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("<iframe");
  });

  it("does not embed a non-HTTP content URL", () => {
    const item = artifact(mineId, "private");
    item.contentUrl = "javascript:alert(1)";
    const html = renderToStaticMarkup(<ViewerScreen state={{ status: "ready", artifact: item }} />);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("The artifact content could not be loaded");
  });

  it("asks a signed-out viewer to sign in", async () => {
    const fetchImpl = stubFetch(async () =>
      jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401)
    );
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const state = await loadArtifact(client, mineId);
    const html = renderToStaticMarkup(<ViewerScreen state={state} />);
    expect(state).toMatchObject({ status: "signed-out", returnTo: artifactReturnPath(mineId) });
    expect(html).toContain("Sign in to continue.");
    expect(html).toContain(`href="${authPageHref("login", artifactReturnPath(mineId))}"`);
    expect(html).not.toContain("<iframe");
  });

  it("offers sign-in for an existing artifact when the hidden read is a 404", async () => {
    const fetchImpl = stubFetch(async (url) => {
      if (url.endsWith("/context")) {
        return jsonResponse({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, 401);
      }
      return jsonResponse({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }, 404);
    });
    const client = createWebClient({ baseUrl: "http://localhost:3001", fetch: fetchImpl });
    const state = await loadArtifact(client, mineId);
    const html = renderToStaticMarkup(<ViewerScreen state={state} />);
    expect(state).toEqual({
      status: "signed-out",
      message: "Sign in to continue.",
      returnTo: artifactReturnPath(mineId)
    });
    expect(html).toContain("Sign in to continue.");
    expect(html).toContain(`href="${authPageHref("login", artifactReturnPath(mineId))}"`);
    expect(html).not.toContain("Artifact not found");
    expect(html).not.toContain("Artifact was not found.");
    expect(html).not.toContain("<iframe");
  });
});

describe("return path", () => {
  it("keeps a same-origin artifact path and drops off-site targets", () => {
    const artifactPath = artifactReturnPath(mineId);
    expect(safeNextPath(artifactPath)).toBe(artifactPath);
    expect(authPageHref("login", artifactPath)).toBe(`/login?next=${encodeURIComponent(artifactPath)}`);
    expect(authPageHref("signup", artifactPath)).toBe(`/signup?next=${encodeURIComponent(artifactPath)}`);
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("https://evil.example/artifacts")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(authPageHref("login", "/")).toBe("/login");
  });
});

describe("formatting", () => {
  it("formats size, upload time, and access labels", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(13)).toBe("13 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(10_485_760)).toBe("10.0 MB");
    expect(formatUploadedAt("2026-10-11T10:00:00.000Z")).toBe("11 Oct 2026, 10:00 UTC");
    expect(formatRelativeTime("2026-10-11T10:00:00.000Z", Date.parse("2026-10-11T10:00:20.000Z"))).toBe("just now");
    expect(formatRelativeTime("2026-10-11T10:00:00.000Z", Date.parse("2026-10-11T10:02:00.000Z"))).toBe("2 min ago");
    expect(formatRelativeTime("2026-10-11T10:00:00.000Z", Date.parse("2026-10-11T11:00:00.000Z"))).toBe("1 hour ago");
    expect(formatRelativeTime("2026-10-11T10:00:00.000Z", Date.parse("2026-10-11T15:00:00.000Z"))).toBe("5 hours ago");
    expect(formatRelativeTime("2026-10-11T10:00:00.000Z", Date.parse("2026-10-12T10:00:00.000Z"))).toBe("1 day ago");
    expect(formatRelativeTime("2026-10-11T10:00:00.000Z", Date.parse("2026-10-17T10:00:00.000Z"))).toBe("6 days ago");
    expect(formatRelativeTime("2026-09-12T10:00:00.000Z", Date.parse("2026-10-11T10:00:00.000Z"))).toBe("29 days ago");
    expect(formatRelativeTime("2026-09-11T10:00:00.000Z", Date.parse("2026-10-11T10:00:00.000Z"))).toBe(
      formatUploadedAt("2026-09-11T10:00:00.000Z"),
    );
    expect(() => formatRelativeTime("not-a-date")).toThrow(RangeError);
    expect(accessLabel("private")).toBe("Private");
    expect(accessLabel("org_shared")).toBe("Organization shared");
  });
});
