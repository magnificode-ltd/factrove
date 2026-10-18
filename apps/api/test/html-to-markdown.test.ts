import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { marked } from "marked";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it } from "vitest";
import { convertHtmlToMarkdown } from "../src/rendering/convert-html-to-markdown.js";
import {
  HtmlConversionError,
  MAX_MARKDOWN_OUTPUT_BYTES,
  htmlToMarkdown,
} from "../src/rendering/html-to-markdown.js";
import { MAX_HTML_BYTES } from "../src/rendering/html-policy.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/hello.html", import.meta.url));
const markdownIt = new MarkdownIt({ html: true, linkify: true });

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
      "See [the docs](<https://example.com/docs>).\n",
    );
    expect(htmlToMarkdown('<a href="mailto:a@example.com">Email</a>')).toBe("[Email](<mailto:a@example.com>)\n");
    expect(htmlToMarkdown('<a href="/artifacts/1">Local</a>')).toBe("[Local](</artifacts/1>)\n");
    expect(htmlToMarkdown('<a href="https://example.com/Foo_(bar)">x</a>')).toBe(
      "[x](<https://example.com/Foo_(bar)>)\n",
    );
    expect(htmlToMarkdown('<img alt="dot" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">')).toBe("dot\n");
    expect(htmlToMarkdown('<img alt="diagram" src="https://example.com/diagram.png">')).toBe(
      "![diagram](<https://example.com/diagram.png>)\n",
    );
  });

  it("honors ordered list start and keeps later paragraphs in the item", () => {
    expect(htmlToMarkdown('<ol start="3"><li>C</li><li>D</li></ol>')).toBe("3. C\n4. D\n");
    expect(htmlToMarkdown("<ul><li><p>First</p><p>Second</p></li></ul>")).toBe("- First\n\n  Second\n");
    expect(htmlToMarkdown("<table><tr><th>Pair</th></tr><tr><td>c<br>d</td></tr></table>")).toContain("c d");
    expect(htmlToMarkdown(`<a href="https://x.com/a b" title='t"q'>x</a>`)).toBe(
      '[x](<https://x.com/a%20b> "t\\"q")\n',
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

  it("keeps escaped markup inert when common markdown renderers allow HTML", () => {
    const samples = [
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>",
      "<p>&lt;script&gt;alert(document.cookie)&lt;/script&gt;</p>",
      "<p>&lt;javascript:alert(1)&gt;</p>",
      "<p>&lt;iframe src=javascript:alert(1)&gt;</p>",
      '<pre><code>```\n&lt;img src=x onerror=alert(1)&gt;</code></pre>',
      '<a href="https://ok.example/docs"><img alt="x](javascript:alert(3)) [y" src="https://ok.example/i.png"></a>',
      '<a href="javascript:alert(1)">label</a>',
      '<img alt="&lt;img onerror=alert(4)&gt;" src="https://ok.example/i.png">',
      '<a href="https://x.com/a b" title="t&quot;q">x</a>',
    ];
    for (const html of samples) {
      const markdown = htmlToMarkdown(html);
      if (!html.includes("<pre>")) {
        expect(markdown).not.toMatch(/<img\b/i);
        expect(markdown).not.toMatch(/<script\b/i);
        expect(markdown).not.toMatch(/<javascript:/i);
      }
      assertInert(markdown);
    }
    const fenced = htmlToMarkdown("<pre><code>```\n&lt;img src=x onerror=alert(1)&gt;</code></pre>");
    expect(fenced.startsWith("````")).toBe(true);
    expect(fenced).toContain("<img src=x onerror=alert(1)>");
  });

  it("keeps meaningful text from malformed fragments", () => {
    const markdown = htmlToMarkdown('<p>Hello<b>bold</p></div><<tag> &amp; "quotes"');
    expect(markdown).toContain("Hello");
    expect(markdown).toContain("bold");
    expect(markdown).toContain("quotes");
    assertInert(markdown);
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

  it("rejects markdown that would exceed the output cap", () => {
    const html = `<p>${"<".repeat(Math.floor(MAX_MARKDOWN_OUTPUT_BYTES / 4) + 1)}</p>`;
    expect(() => htmlToMarkdown(html)).toThrow(HtmlConversionError);
    try {
      htmlToMarkdown(html);
    } catch (error) {
      expect(error).toBeInstanceOf(HtmlConversionError);
      expect((error as HtmlConversionError).limit).toBe("output");
    }
  });

  it("flattens deep documents instead of hanging", () => {
    const nested = `${"<div>".repeat(8000)}secret${"</div>".repeat(8000)}`;
    const started = performance.now();
    const markdown = htmlToMarkdown(nested);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(markdown).toContain("secret");

    let deepList = "center-token";
    for (let index = 0; index < 500; index += 1) {
      deepList = `<ul><li>${deepList}</li></ul>`;
    }
    deepList += "<p>tail-token</p>".repeat(2_000);
    const listStarted = performance.now();
    const list = htmlToMarkdown(deepList);
    expect(performance.now() - listStarted).toBeLessThan(1_000);
    expect(list).toContain("center-token");
    expect(list).toContain("tail-token");

    let quote = "quote-token";
    for (let index = 0; index < 400; index += 1) {
      quote = `<blockquote>${quote}</blockquote>`;
    }
    const quoteStarted = performance.now();
    const quoted = htmlToMarkdown(quote);
    expect(performance.now() - quoteStarted).toBeLessThan(1_000);
    expect(quoted).toContain("quote-token");
    expect(Buffer.byteLength(quoted)).toBeLessThan(100_000);
  });

  it("converts a large flat document quickly", () => {
    const html = `<p>${"word ".repeat(200_000)}</p>`;
    const started = performance.now();
    const markdown = htmlToMarkdown(html);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(markdown).toContain("word");
    expect(Buffer.byteLength(html)).toBeGreaterThan(1_000_000);
  });

  it("converts off the main thread", async () => {
    const html = `<p>${"word ".repeat(1_200_000)}</p>`;
    const started = performance.now();
    const pending = convertHtmlToMarkdown(html);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(performance.now() - started).toBeLessThan(200);
    const markdown = await pending;
    expect(markdown).toContain("word");
  });

  it("returns empty markdown when the document has no visible content", () => {
    expect(htmlToMarkdown("<script>SECRETTOKEN</script><style>.x{}</style>")).toBe("");
  });
});

function assertInert(markdown: string): void {
  const rendered = [marked.parse(markdown, { async: false }) as string, markdownIt.render(markdown)];
  for (const html of rendered) {
    const stack: DefaultTreeAdapterMap["childNode"][] = [...parse(html).childNodes];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || node.nodeName === "#text" || node.nodeName === "#comment" || node.nodeName === "#documentType") {
        continue;
      }
      const tag = node.tagName.toLowerCase();
      expect(["script", "iframe", "object", "embed"]).not.toContain(tag);
      for (const attr of node.attrs) {
        const name = attr.name.toLowerCase();
        expect(name.startsWith("on")).toBe(false);
        if (name === "href" || name === "src" || name === "action") {
          const compact = attr.value.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
          expect(compact.startsWith("javascript:"), `${tag} ${name}=${attr.value}\n${markdown}\n${html}`).toBe(false);
          expect(compact.startsWith("vbscript:")).toBe(false);
          expect(compact.startsWith("data:text")).toBe(false);
        }
      }
      stack.push(...node.childNodes);
    }
  }
}
