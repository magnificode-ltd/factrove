import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HtmlConversionError, htmlToMarkdown } from "../src/rendering/html-to-markdown.js";
import { MAX_HTML_BYTES } from "../src/rendering/html-policy.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/hello.html", import.meta.url));

describe("HTML to Markdown", () => {
  it("preserves headings, emphasis, lists, tables, code, and links", () => {
    expect(htmlToMarkdown("<h1>Title</h1><h2>Section</h2><p>Hello <strong>bold</strong> and <em>italic</em>.</p>")).toBe(
      "# Title\n\n## Section\n\nHello **bold** and _italic_.\n",
    );
    expect(
      htmlToMarkdown("<ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>"),
    ).toBe("- One\n- Two\n  - Nested\n1. First\n2. Second\n");
    expect(
      htmlToMarkdown(
        "<table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Apple</td><td>2</td></tr></tbody></table>",
      ),
    ).toBe("| Name  | Qty |\n| ----- | --- |\n| Apple | 2   |\n");
    expect(htmlToMarkdown('<p>Use <code>id</code>.</p><pre><code class="language-ts">const value = a &lt; b;</code></pre>')).toBe(
      "Use `id`.\n\n```ts\nconst value = a < b;\n```\n",
    );
    expect(htmlToMarkdown('<pre class="lang-js"><code>const n = 1;</code></pre>')).toBe("```js\nconst n = 1;\n```\n");
    expect(htmlToMarkdown('<p>See <a href="https://example.com/docs">the docs</a>.</p>')).toBe(
      "See [the docs](https://example.com/docs).\n",
    );
    expect(htmlToMarkdown('<a href="mailto:a@example.com">Email</a>')).toBe("[Email](mailto:a@example.com)\n");
    expect(htmlToMarkdown('<a href="/artifacts/1">Local</a>')).toBe("[Local](/artifacts/1)\n");
    expect(htmlToMarkdown('<img alt="dot" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">')).toBe(
      "![dot](data:image/gif;base64,R0lGODlhAQABAAAAACw=)\n",
    );
  });

  it("converts the hello fixture without script or style text", async () => {
    const html = await readFile(fixturePath, "utf8");
    const markdown = htmlToMarkdown(html);
    expect(markdown).toBe("# Hello from Factrove\n\nThe HTML fixture loaded.\n");
    expect(markdown).not.toContain("querySelector");
    expect(markdown).not.toContain("font:");
    expect(markdown).not.toContain("Factrove hello fixture");
  });

  it("drops scripts, styles, comments, and unsafe URLs", () => {
    const markdown = htmlToMarkdown(
      [
        "<p>Visible</p>",
        "<script>SECRETTOKEN</script>",
        "<style>.x{color:red}</style>",
        "<!-- hidden note -->",
        '<a href="javascript:alert(1)" onclick="alert(2)">click</a>',
        '<a href="javascript&#58;alert(1)">entity</a>',
        '<a href="java\nscript:alert(1)">broken</a>',
        '<a href="javascript%3Aalert(1)">encoded</a>',
        '<a href="data:text/html,hi">data</a>',
        '<img alt="svg" src="data:image/svg+xml,<svg></svg>">',
      ].join(""),
    );
    expect(markdown).toContain("Visible");
    expect(markdown).toContain("click");
    expect(markdown).toContain("entity");
    expect(markdown).toContain("broken");
    expect(markdown).toContain("encoded");
    expect(markdown).toContain("data");
    expect(markdown).not.toContain("SECRETTOKEN");
    expect(markdown).not.toContain("color:red");
    expect(markdown).not.toContain("hidden note");
    expect(markdown).not.toContain("javascript");
    expect(markdown).not.toContain("alert");
    expect(markdown).not.toContain("data:text/html");
    expect(markdown).not.toContain("svg+xml");
    expect(markdown).not.toContain("onclick");
  });

  it("keeps meaningful text from malformed fragments", () => {
    const markdown = htmlToMarkdown('<p>Hello<b>bold</p></div><<tag> &amp; "quotes"');
    expect(markdown).toContain("Hello");
    expect(markdown).toContain("bold");
    expect(markdown).toContain("quotes");
  });

  it("does not carry text from an earlier document", () => {
    expect(htmlToMarkdown("<p>First FIRSTTOKEN</p>")).toContain("FIRSTTOKEN");
    const second = htmlToMarkdown("<p>Second</p>");
    expect(second).toBe("Second\n");
    expect(second).not.toContain("FIRSTTOKEN");
  });

  it("rejects HTML above the stored size limit before converting", () => {
    expect(() => htmlToMarkdown("a".repeat(MAX_HTML_BYTES + 1))).toThrow(HtmlConversionError);
    const multibyte = "你".repeat(Math.floor(MAX_HTML_BYTES / 3) + 1);
    expect(multibyte.length).toBeLessThan(MAX_HTML_BYTES);
    expect(() => htmlToMarkdown(multibyte)).toThrow(HtmlConversionError);
    expect(htmlToMarkdown("<p>你好</p>")).toContain("你好");
  });

  it("rejects deeply nested HTML instead of hanging", () => {
    const html = `${"<div>".repeat(8000)}secret${"</div>".repeat(8000)}`;
    expect(() => htmlToMarkdown(html)).toThrow(HtmlConversionError);
  });

  it("returns empty markdown when the document has no visible content", () => {
    expect(htmlToMarkdown("<script>SECRETTOKEN</script><style>.x{}</style>")).toBe("");
  });
});
