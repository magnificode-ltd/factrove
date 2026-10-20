import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtifactDto } from "@factrove/contracts";
import { ArtifactCard } from "../src/components/artifact-card";
import { LibraryTabs } from "../src/components/chrome";
import NotFound from "../src/app/not-found";
import { formatUploadedAt } from "../src/format";
import { PublicShareScreen } from "../src/share/public-share-screen";
import { ViewerScreen } from "../src/viewer/viewer-screen";

const artifact: ArtifactDto = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "private",
  filename: "123e4567-e89b-42d3-a456-426614174000.html",
  mimeType: "text/html",
  sizeBytes: 13,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: "http://localhost:3000/artifacts/123e4567-e89b-42d3-a456-426614174000",
  contentUrl: "http://localhost:3001/api/v1/artifacts/123e4567-e89b-42d3-a456-426614174000/content",
  shared: false
};

describe("LibraryTabs", () => {
  it("marks the current list and slides the pill between the two links", () => {
    const mine = renderToStaticMarkup(<LibraryTabs view="mine" />);
    const org = renderToStaticMarkup(<LibraryTabs view="org" />);
    const none = renderToStaticMarkup(<LibraryTabs view="none" />);

    expect(mine).toContain('href="/"');
    expect(mine).toContain('href="/?view=org"');
    expect(mine).toContain('data-tab="mine"');
    expect(mine).toContain("ft-tab-pill");
    expect(mine.match(/aria-current="page"/g)).toHaveLength(1);
    expect(mine).toContain("focus-visible:outline-peri-d");
    expect(org).toContain('data-tab="org"');
    expect(org.indexOf('aria-current="page"')).toBeGreaterThan(org.indexOf('href="/"'));
    expect(none).not.toContain("ft-tab-pill");
    expect(none).not.toContain("aria-current");
  });
});

describe("ArtifactCard", () => {
  it("shows the mono id, a copy control, and the UTC time on the relative label", () => {
    const now = Date.parse("2026-10-11T10:02:00.000Z");
    const html = renderToStaticMarkup(<ArtifactCard artifact={artifact} now={now} />);

    expect(html).toContain(`href="/artifacts/${artifact.id}"`);
    expect(html).toContain(artifact.filename);
    expect(html).toContain(artifact.id);
    expect(html).toContain("Copy ID");
    expect(html).toContain("2 min ago");
    expect(html).toContain(`title="${formatUploadedAt(artifact.uploadedAt)}"`);
    expect(html).toContain("focus-visible:outline-peri-d");
    expect(html).toContain("ft-card");
    expect(html).not.toContain("suppressHydrationWarning");
  });
});

describe("not found", () => {
  it("keeps one wordmark and explains the miss without an alert role", () => {
    const html = renderToStaticMarkup(<NotFound />);
    expect(html).toContain("404");
    expect(html).toContain("This page wandered off.");
    expect(html).toContain("That link does not lead to an artifact or a page in Factrove.");
    expect(html).toContain("Back to library");
    expect(html.match(/class="wm /g)).toHaveLength(1);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("wm-lg");
  });
});

describe("viewer toolbar", () => {
  it("offers copy link and copy id without putting the content URL in the page", () => {
    const html = renderToStaticMarkup(<ViewerScreen state={{ status: "ready", artifact }} />);
    expect(html).toContain("Copy link");
    expect(html).toContain("Copy ID");
    expect(html).not.toContain("Open raw");
    expect(html).not.toContain(artifact.contentUrl);
    expect(html).toContain(formatUploadedAt(artifact.uploadedAt));
  });
});

describe("share controls", () => {
  it("shows a public link for the owner and keeps the token out of a revoked page", () => {
    const shareUrl = `http://localhost:3000/share/${artifact.id}/ccccccccccccccccccccccccccccccccccccccccccc`;
    const shared = renderToStaticMarkup(
      <ViewerScreen state={{ status: "ready", artifact: { ...artifact, shared: true }, share: { shared: true, shareUrl } }} />
    );
    expect(shared).toContain("Sharing");
    expect(shared).toContain("Anyone with this link can open the artifact without an account.");
    expect(shared).toContain(shareUrl);
    expect(shared).toContain("Stop sharing");
    expect(shared).toContain("ft-pop");

    const privateView = renderToStaticMarkup(
      <ViewerScreen state={{ status: "ready", artifact, share: { shared: false, shareUrl: null } }} />
    );
    expect(privateView).toContain("Share");
    expect(privateView).not.toContain("Stop sharing");

    const missing = renderToStaticMarkup(
      <PublicShareScreen state={{ status: "missing", message: "This artifact does not exist." }} />
    );
    expect(missing).toContain("This artifact does not exist.");
    expect(missing).not.toContain("ccccccccccccccccccccccccccccccccccccccccccc");
    expect(missing).not.toContain("<iframe");
  });
});

describe("contrast tokens", () => {
  it("fills primary controls with the darker periwinkle", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("--primary: var(--peri-d)");
    expect(css).toContain("--peri-d: #5e64d6");
    expect(css).toContain(".ft-card:focus-within");
  });
});
