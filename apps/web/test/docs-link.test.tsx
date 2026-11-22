import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ContextEnvelope } from "@factrove/contracts";
import { AuthScreen } from "../src/components/auth-screen";
import { AppBar, ViewerBar } from "../src/components/chrome";
import { DocsUrlProvider } from "../src/components/docs-link";
import { SignInGate } from "../src/components/sign-in-gate";
import { LibraryScreen } from "../src/library/library-screen";
import { DEFAULT_DOCS_BASE_URL, docsBaseUrl } from "../src/public-config";

const context: ContextEnvelope = {
  user: { id: "local-user", name: "Local User" },
  organization: { id: "local-org", name: "Local Organization" },
};

function docsAnchor(html: string): string {
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
  const anchor = anchors.find((item) => item.includes(">Docs</a>"));
  if (!anchor) {
    throw new Error("Missing Docs link");
  }
  return anchor;
}

describe("Docs link", () => {
  it("opens the public docs in a new tab beside the header controls", () => {
    const signedIn = renderToStaticMarkup(
      <LibraryScreen state={{ status: "empty", view: "mine", context }} />,
    );
    const signedOut = renderToStaticMarkup(<LibraryScreen state={{ status: "signed-out", view: "mine" }} />);
    const auth = renderToStaticMarkup(
      <AuthScreen title="Sign in" lede="Sign in to your Factrove library." footer={<span>New here?</span>}>
        <form />
      </AuthScreen>,
    );
    const gate = renderToStaticMarkup(<SignInGate message="Sign in to continue." returnTo="/artifacts/example" />);
    const viewer = renderToStaticMarkup(<ViewerBar title="Artifact" showLibraryLink={false} />);

    for (const html of [signedIn, signedOut, auth, gate, viewer]) {
      const anchor = docsAnchor(html);
      expect(anchor).toContain(`href="${DEFAULT_DOCS_BASE_URL}"`);
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
      expect(anchor).not.toContain("docs.factrove.app");
      expect(html.indexOf(">Docs</a>")).toBeLessThan(html.indexOf(">Source code</a>"));
    }

    expect(signedIn.indexOf("Sign out")).toBeLessThan(signedIn.indexOf(">Docs</a>"));
    expect(signedIn.indexOf('href="/account/api-keys"')).toBeLessThan(signedIn.indexOf(">Docs</a>"));
    expect(signedOut.indexOf(">Create account</a>")).toBeLessThan(signedOut.indexOf(">Docs</a>"));
    expect(auth).toContain(">Docs</a>");
    expect(gate).toContain(">Docs</a>");
  });

  it("uses the docs base configured for the page", () => {
    const html = renderToStaticMarkup(
      <DocsUrlProvider url={docsBaseUrl({ DOCS_BASE_URL: "https://docs.example.com/factrove/" })}>
        <AppBar />
      </DocsUrlProvider>,
    );
    const anchor = docsAnchor(html);
    expect(anchor).toContain('href="https://docs.example.com/factrove"');
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain(DEFAULT_DOCS_BASE_URL);
    expect(html).not.toContain("docs.factrove.app");
  });
});
