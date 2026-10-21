import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FactroveApiError } from "@factrove/api-client";
import type { ArtifactDto } from "@factrove/contracts";
import { artifactReturnPath, authPageHref } from "../src/auth/return-path";
import Loading from "../src/app/(browse)/loading";
import LoadingArtifact from "../src/app/(browse)/artifacts/[id]/loading";
import LibraryError from "../src/app/error";
import HomePage from "../src/app/(browse)/page";
import ArtifactPage from "../src/app/(browse)/artifacts/[id]/page";

const api = vi.hoisted(() => ({
  getContext: vi.fn(),
  listArtifacts: vi.fn(),
  getArtifact: vi.fn(),
  getArtifactShare: vi.fn(),
  uploadArtifact: vi.fn()
}));

vi.mock("@/api/server-client", () => ({
  createRequestClient: async () => api
}));

const artifact: ArtifactDto = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "org_shared",
  filename: "123e4567-e89b-42d3-a456-426614174000.html",
  mimeType: "text/html",
  sizeBytes: 42,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: "http://localhost:3000/artifacts/123e4567-e89b-42d3-a456-426614174000",
  contentUrl: "http://localhost:3001/api/v1/artifacts/123e4567-e89b-42d3-a456-426614174000/content",
  shared: false
};

beforeEach(() => {
  api.getContext.mockReset();
  api.listArtifacts.mockReset();
  api.getArtifact.mockReset();
  api.getArtifactShare.mockReset();
  api.getArtifactShare.mockResolvedValue({ share: { shared: false, shareUrl: null } });
  api.getContext.mockResolvedValue({
    user: { id: "local-user", name: "Local User" },
    organization: { id: "local-org", name: "Local Organization" }
  });
  api.listArtifacts.mockResolvedValue({ items: [] });
});

describe("library page", () => {
  it("fetches the organization list when that tab is selected", async () => {
    api.listArtifacts.mockResolvedValue({ items: [artifact] });
    const html = renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ view: "org" }) }));
    expect(api.listArtifacts).toHaveBeenCalledWith({ view: "org" });
    expect(api.getContext).toHaveBeenCalledOnce();
    expect(html).toContain("Organization artifacts");
    expect(html).toContain(artifact.filename);
    expect(html).toContain("Local Organization");
    expect(html).toContain("Refresh");
  });

  it("fetches my artifacts for the default and unrecognized tabs", async () => {
    await HomePage({ searchParams: Promise.resolve({}) });
    await HomePage({ searchParams: Promise.resolve({ view: ["nope"] }) });
    expect(api.listArtifacts).toHaveBeenNthCalledWith(1, { view: "mine" });
    expect(api.listArtifacts).toHaveBeenNthCalledWith(2, { view: "mine" });
  });

  it("renders the loading and unexpected-error states", () => {
    expect(renderToStaticMarkup(<Loading />)).toContain("Loading artifacts…");
    expect(renderToStaticMarkup(<LoadingArtifact />)).toContain("Loading artifact…");
    const html = renderToStaticMarkup(<LibraryError error={new Error("boom")} reset={() => undefined} />);
    expect(html).toContain("This page could not be loaded.");
    expect(html).toContain("Try again");
  });
});

describe("artifact page", () => {
  it("requests the deep-linked artifact and withholds the iframe until content is confirmed", async () => {
    api.getArtifact.mockResolvedValue({ artifact });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: artifact.id }) }));
    expect(api.getArtifact).toHaveBeenCalledWith(artifact.id);
    expect(html).toContain("Checking artifact content…");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("allow-same-origin");
  });

  it("renders a useful missing state when the artifact request fails", async () => {
    api.getArtifact.mockRejectedValue(
      new FactroveApiError("Artifact not found", { status: 404, code: "ARTIFACT_NOT_FOUND" })
    );
    const missing = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: "missing" }) }));
    expect(missing).toContain("Artifact not found");
    expect(missing).not.toContain("<iframe");

    api.getArtifact.mockRejectedValue(new FactroveApiError("connect ECONNREFUSED", { status: null, code: "NETWORK_ERROR" }));
    const unavailable = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: artifact.id }) }));
    expect(unavailable).toContain("The Factrove API is unavailable");
    expect(unavailable).not.toContain("<iframe");
  });

  it("offers sign-in when a logged-out read of an existing artifact is hidden", async () => {
    api.getContext.mockRejectedValue(
      new FactroveApiError("Sign in to continue.", { status: 401, code: "UNAUTHENTICATED" })
    );
    api.getArtifact.mockRejectedValue(
      new FactroveApiError("Artifact was not found.", { status: 404, code: "ARTIFACT_NOT_FOUND" })
    );
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: artifact.id }) }));
    expect(html).toContain("Sign in to continue.");
    expect(html).toContain(`href="${authPageHref("login", artifactReturnPath(artifact.id))}"`);
    expect(html).not.toContain("Artifact not found");
    expect(html).not.toContain("<iframe");
  });
});
