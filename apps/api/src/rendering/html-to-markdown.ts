import { NodeHtmlMarkdown } from "node-html-markdown";
import { parse, NodeType, type HTMLElement, type TextNode } from "node-html-parser";
import { MAX_HTML_BYTES } from "./html-policy.js";

// Stored artifacts are HTML. Markdown is derived when content is requested and is not persisted.
const DROPPED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "template",
  "link",
  "meta",
  "title",
  "base",
]);

const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "background",
  "cite",
  "xlink:href",
]);

const IGNORABLE = /[\u0000-\u0020\u007f\u200b-\u200d\ufeff]+/g;
const RASTER_DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp)[;,]/i;
const LANGUAGE_HINT = /(?:^|\s)(?:language-|lang-)([A-Za-z0-9_+-]+)/;
const CODE_OPEN_TAG = /<code\b([^>]*)>/i;

const converter = new NodeHtmlMarkdown({
  preferNativeParser: false,
  codeBlockStyle: "fenced",
  bulletMarker: "-",
  keepDataImages: true,
  ignore: [...DROPPED_TAGS],
});

export class HtmlConversionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HtmlConversionError";
  }
}

export function htmlToMarkdown(html: string): string {
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) {
    throw new HtmlConversionError("HTML exceeds the conversion limit.");
  }
  try {
    const markdown = converter.translate(sanitizeHtml(html)).trim();
    return markdown.length === 0 ? "" : `${markdown}\n`;
  } catch (error) {
    if (error instanceof HtmlConversionError) {
      throw error;
    }
    throw new HtmlConversionError("HTML could not be converted to Markdown.", { cause: error });
  }
}

export async function readBoundedHtml(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > MAX_HTML_BYTES) {
      throw new HtmlConversionError("HTML exceeds the conversion limit.");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sanitizeHtml(html: string): string {
  const root = parse(html, {
    comment: false,
    blockTextElements: {
      script: true,
      noscript: true,
      style: true,
      pre: true,
    },
  });
  const stack: HTMLElement[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const child of [...current.childNodes]) {
      if (child.nodeType === NodeType.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (child.nodeType !== NodeType.ELEMENT_NODE) {
        continue;
      }
      const element = child as HTMLElement;
      if (DROPPED_TAGS.has(element.tagName.toLowerCase())) {
        element.remove();
        continue;
      }
      preserveCodeLanguage(element);
      sanitizeAttributes(element);
      stack.push(element);
    }
  }
  return root.toString();
}

function preserveCodeLanguage(element: HTMLElement): void {
  if (element.tagName.toLowerCase() !== "pre") {
    return;
  }
  const language = LANGUAGE_HINT.exec(element.getAttribute("class") ?? "")?.[1];
  if (!language) {
    return;
  }
  for (const child of element.childNodes) {
    if (child.nodeType !== NodeType.TEXT_NODE) {
      continue;
    }
    const text = child as TextNode;
    text.rawText = text.rawText.replace(CODE_OPEN_TAG, (match) => codeOpenTagWithLanguage(match, language));
  }
}

function codeOpenTagWithLanguage(tag: string, language: string): string {
  if (/\blanguage-\S+/i.test(tag)) {
    return tag;
  }
  if (/\bclass\s*=\s*(['"])/i.test(tag)) {
    return tag.replace(/\bclass\s*=\s*(['"])/i, (classAttribute) => `${classAttribute}language-${language} `);
  }
  return tag.replace(/<code/i, `<code class="language-${language}"`);
}

function sanitizeAttributes(element: HTMLElement): void {
  const tag = element.tagName.toLowerCase();
  for (const name of Object.keys(element.attributes)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || lower === "style" || lower === "srcset" || lower === "srcdoc") {
      element.removeAttribute(name);
      continue;
    }
    if (!URL_ATTRIBUTES.has(lower)) {
      continue;
    }
    const value = element.getAttribute(name);
    if (value === undefined || !isSafeUrl(value, urlKind(tag, lower))) {
      element.removeAttribute(name);
    }
  }
}

function urlKind(tag: string, attribute: string): "link" | "image" {
  if (attribute === "poster") {
    return "image";
  }
  if (attribute === "src" && (tag === "img" || tag === "image" || tag === "source")) {
    return "image";
  }
  return "link";
}

function isSafeUrl(value: string, kind: "link" | "image"): boolean {
  const compact = compactUrl(value);
  if (compact.length === 0) {
    return false;
  }
  const schemeMatch = /^([a-z][a-z0-9+.-]*:)/i.exec(compact);
  const scheme = schemeMatch?.[1]?.toLowerCase();
  if (!scheme) {
    return true;
  }
  if (scheme === "javascript:" || scheme === "vbscript:") {
    return false;
  }
  if (scheme === "data:") {
    return kind === "image" && RASTER_DATA_IMAGE.test(compact);
  }
  return scheme === "http:" || scheme === "https:" || scheme === "mailto:";
}

function compactUrl(value: string): string {
  let current = value.replace(IGNORABLE, "");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }
    if (decoded === current) {
      break;
    }
    current = decoded.replace(IGNORABLE, "");
  }
  return current;
}
