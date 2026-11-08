import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtifactDto } from "@factrove/contracts";
import { SignInGate } from "../src/components/sign-in-gate";
import { ViewerScreen } from "../src/viewer/viewer-screen";

const artifactId = "123e4567-e89b-42d3-a456-426614174000";
const returnTo = `/artifacts/${artifactId}`;
const message = "Sign in to continue.";
const valueStatement = "Factrove is a self-hostable home for artifacts created by people and agents.";

const artifact: ArtifactDto = {
  id: artifactId,
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "private",
  filename: `${artifactId}.html`,
  name: null,
  mimeType: "text/html",
  sizeBytes: 42,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: `http://localhost:3000/artifacts/${artifactId}`,
  contentUrl: `http://localhost:3001/api/v1/artifacts/${artifactId}/content`,
  shared: false,
  passwordProtected: false
};

function heading(html: string): string {
  return html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "";
}

function hrefFor(html: string, label: string): string {
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
  const anchor = anchors.find((item) => item.includes(`>${label}</a>`));
  const href = anchor?.match(/\bhref="([^"]*)"/)?.[1]?.replaceAll("&amp;", "&");
  if (!href) {
    throw new Error(`Missing href for ${label}`);
  }
  return href;
}

function decodedNext(href: string): string {
  const next = new URL(href, "http://127.0.0.1").searchParams.get("next");
  if (next === null) {
    throw new Error(`Missing next on ${href}`);
  }
  return next;
}

describe("SignInGate", () => {
  it("centers a branded card with the readme value line and both auth paths", () => {
    const html = renderToStaticMarkup(<SignInGate message={message} returnTo={returnTo} />);
    const title = heading(html);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(title).toContain(message);
    expect(html).toContain(valueStatement);
    expect(hrefFor(html, "Sign in")).toBe(`/login?next=%2Fartifacts%2F${artifactId}`);
    expect(decodedNext(hrefFor(html, "Sign in"))).toBe(returnTo);
    expect(hrefFor(html, "Create an account")).toBe(`/signup?next=%2Fartifacts%2F${artifactId}`);
    expect(decodedNext(hrefFor(html, "Create an account"))).toBe(returnTo);
    expect(html).toContain("Create an account");
    expect(html).not.toContain("Back to library");
    expect(html).toContain('href="/"');
    expect(html).toContain("Source code");
    expect(html).toContain("fac<b>t</b>rove");
    expect(html.match(/class="wm /g)).toHaveLength(1);
    expect(html).toContain("focus-visible:outline-peri-d");
    expect(html).toContain('data-variant="default"');
    expect(html).toContain("h-12");
    expect(html).toContain("w-full");
    expect(html).toContain("ft-hero");
    expect(html).toContain("ft-vault-card");
    expect(html).toContain('data-testid="sign-in-gate"');
    expect(html).toContain("<main");
    expect(html).not.toContain('role="alert"');
    expect(title).not.toContain(valueStatement);
  });

  it("keeps a query, a hash, and already-encoded characters in both auth links", () => {
    const cases = [
      {
        returnTo: `/artifacts/${artifactId}?view=org`,
        login: `/login?next=%2Fartifacts%2F${artifactId}%3Fview%3Dorg`,
        signup: `/signup?next=%2Fartifacts%2F${artifactId}%3Fview%3Dorg`
      },
      {
        returnTo: `/artifacts/${artifactId}#notes`,
        login: `/login?next=%2Fartifacts%2F${artifactId}%23notes`,
        signup: `/signup?next=%2Fartifacts%2F${artifactId}%23notes`
      },
      {
        returnTo: "/artifacts/report%20draft",
        login: "/login?next=%2Fartifacts%2Freport%2520draft",
        signup: "/signup?next=%2Fartifacts%2Freport%2520draft"
      }
    ];

    for (const item of cases) {
      const html = renderToStaticMarkup(<SignInGate message={message} returnTo={item.returnTo} />);
      const login = hrefFor(html, "Sign in");
      const signup = hrefFor(html, "Create an account");
      expect(login).toBe(item.login);
      expect(signup).toBe(item.signup);
      expect(decodedNext(login)).toBe(item.returnTo);
      expect(decodedNext(signup)).toBe(item.returnTo);
    }
  });
});

describe("signed-out viewer", () => {
  it("uses the shared gate and leaves other viewer notices unchanged", () => {
    const signedOut = renderToStaticMarkup(<ViewerScreen state={{ status: "signed-out", message, returnTo }} />);
    expect(signedOut).toContain('data-testid="sign-in-gate"');
    expect(heading(signedOut)).toContain(message);
    expect(signedOut).not.toContain("Back to library");
    expect(hrefFor(signedOut, "Sign in")).toBe(`/login?next=%2Fartifacts%2F${artifactId}`);
    expect(decodedNext(hrefFor(signedOut, "Sign in"))).toBe(returnTo);
    expect(hrefFor(signedOut, "Create an account")).toBe(`/signup?next=%2Fartifacts%2F${artifactId}`);
    expect(decodedNext(hrefFor(signedOut, "Create an account"))).toBe(returnTo);
    expect(signedOut).not.toContain("<iframe");

    const ready = renderToStaticMarkup(<ViewerScreen state={{ status: "ready", artifact }} />);
    expect(ready).toContain("Back to library");
    expect(ready).toContain('href="/"');

    const missing = renderToStaticMarkup(<ViewerScreen state={{ status: "missing", message: "Artifact not found" }} />);
    expect(missing).not.toContain('data-testid="sign-in-gate"');
    expect(missing).toContain("Artifact not found");
    expect(missing).toContain("Back to library");
    expect(missing).toContain('role="status"');
  });
});
