import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppBar, ViewerBar } from "../src/components/chrome";
import { SourceCodeUrlProvider } from "../src/components/source-code-link";
import { DEFAULT_SOURCE_CODE_URL } from "../src/public-config";

describe("source code link", () => {
  it("offers the Factrove repository from the app and viewer bars", () => {
    const app = renderToStaticMarkup(<AppBar />);
    const viewer = renderToStaticMarkup(<ViewerBar title="Artifact" showLibraryLink={false} />);
    for (const html of [app, viewer]) {
      expect(html).toContain(`href="${DEFAULT_SOURCE_CODE_URL}"`);
      expect(html).toContain("Source code");
    }
  });

  it("uses the URL a self-hosted fork configures", () => {
    const html = renderToStaticMarkup(
      <SourceCodeUrlProvider url="https://git.example.com/fork">
        <ViewerBar title="Shared artifact" showLibraryLink={false} />
      </SourceCodeUrlProvider>,
    );
    expect(html).toContain('href="https://git.example.com/fork"');
    expect(html).not.toContain(DEFAULT_SOURCE_CODE_URL);
  });
});
