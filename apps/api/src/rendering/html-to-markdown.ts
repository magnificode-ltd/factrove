import { parse, type DefaultTreeAdapterMap } from "parse5";
import { MAX_HTML_BYTES } from "./html-policy.js";

type Element = DefaultTreeAdapterMap["element"];
type ChildNode = DefaultTreeAdapterMap["childNode"];
type TextNode = DefaultTreeAdapterMap["textNode"];

export const MAX_MARKDOWN_INPUT_BYTES = MAX_HTML_BYTES;
export const MAX_MARKDOWN_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_MARKDOWN_DEPTH = 100;
export const MARKDOWN_CONVERSION_TIMEOUT_MS = 5_000;
export const MARKDOWN_WORKER_OLD_GENERATION_MB = 256;

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
  "svg",
  "math",
]);

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "center",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const IGNORABLE = /[\u0000-\u0020\u007f\u200b-\u200d\ufeff]+/g;
const LANGUAGE_HINT = /(?:^|\s)(?:language-|lang-)([A-Za-z0-9_+-]+)/;
const TEXT_ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

export type HtmlConversionLimit = "input" | "output" | "time" | "memory" | "complex";

export class HtmlConversionError extends Error {
  readonly limit?: HtmlConversionLimit;

  constructor(message: string, options?: { cause?: unknown; limit?: HtmlConversionLimit }) {
    super(message, options);
    this.name = "HtmlConversionError";
    this.limit = options?.limit;
  }
}

type Budget = {
  bytes: number;
};

type InlineContext = {
  budget: Budget;
  inLink: boolean;
  label: boolean;
  inTable: boolean;
  inlineDepth: number;
};

export function htmlToMarkdown(html: string): string {
  if (Buffer.byteLength(html) > MAX_MARKDOWN_INPUT_BYTES) {
    throw new HtmlConversionError("HTML exceeds the Markdown conversion limit.", { limit: "input" });
  }

  let root: ChildNode[];
  try {
    root = parse(html).childNodes;
  } catch (error) {
    throw asConversionError(error);
  }

  const budget: Budget = { bytes: 0 };
  const context: InlineContext = {
    budget,
    inLink: false,
    label: false,
    inTable: false,
    inlineDepth: 0,
  };
  let blocks: string[];
  try {
    blocks = renderNodes(root, 0, context);
  } catch (error) {
    if (error instanceof HtmlConversionError) {
      throw error;
    }
    throw asConversionError(error);
  }

  const markdown = joinBlocks(blocks);
  const output = markdown.length === 0 ? "" : `${markdown}\n`;
  if (Buffer.byteLength(output) > MAX_MARKDOWN_OUTPUT_BYTES) {
    throw new HtmlConversionError("Markdown output exceeds the conversion limit.", { limit: "output" });
  }
  return output;
}

export async function readBoundedHtml(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > MAX_MARKDOWN_INPUT_BYTES) {
      throw new HtmlConversionError("HTML exceeds the Markdown conversion limit.", { limit: "input" });
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

function asConversionError(error: unknown): HtmlConversionError {
  if (isComplexityError(error)) {
    return new HtmlConversionError("HTML is too complex to convert to Markdown.", { limit: "complex", cause: error });
  }
  return new HtmlConversionError("HTML could not be converted to Markdown.", { cause: error });
}

function isComplexityError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "RangeError" || /Maximum call stack/i.test(error.message);
}

function renderNodes(nodes: readonly ChildNode[], depth: number, context: InlineContext): string[] {
  if (depth > MAX_MARKDOWN_DEPTH) {
    const text = trimInline(collectVisibleText(nodes, context));
    return text.length === 0 ? [] : [text];
  }

  const blocks: string[] = [];
  const inline: ChildNode[] = [];
  const flush = (): void => {
    if (inline.length === 0) {
      return;
    }
    const text = trimInline(inline.map((node) => renderInline(node, context)).join(""));
    inline.length = 0;
    if (text.length > 0) {
      blocks.push(text);
    }
  };

  for (const node of nodes) {
    if (isElement(node) && isBlockElement(node)) {
      flush();
      for (const block of renderElement(node, depth, context)) {
        if (block.length > 0) {
          blocks.push(block);
        }
      }
      continue;
    }
    inline.push(node);
  }
  flush();
  return blocks;
}

function renderElement(element: Element, depth: number, context: InlineContext): string[] {
  const tag = element.tagName.toLowerCase();
  if (DROPPED_TAGS.has(tag) || tag === "head") {
    return [];
  }
  if (depth > MAX_MARKDOWN_DEPTH) {
    const text = trimInline(collectVisibleText(element.childNodes, context));
    return text.length === 0 ? [] : [text];
  }

  const nested = depth + 1;
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return heading(element, Number(tag[1]), context);
    case "p":
    case "summary":
      return paragraph(element, context);
    case "pre":
      return codeBlock(element, context);
    case "ul":
    case "ol":
      return listBlock(element, tag === "ol", nested, context);
    case "blockquote":
      return quoteBlock(element, nested, context);
    case "table":
      return tableBlock(element, context);
    case "hr":
      return ["---"];
    case "li":
      return renderNodes(element.childNodes, nested, context);
    default:
      if (BLOCK_TAGS.has(tag)) {
        return renderNodes(element.childNodes, nested, context);
      }
      return paragraph(element, context);
  }
}

function heading(element: Element, level: number, context: InlineContext): string[] {
  const text = renderInlineChildren(element, context).replace(/\s+/g, " ").trim();
  if (text.length === 0) {
    return [];
  }
  return [`${"#".repeat(level)} ${text}`];
}

function paragraph(element: Element, context: InlineContext): string[] {
  const text = trimInline(renderInlineChildren(element, context));
  return text.length === 0 ? [] : [text];
}

function codeBlock(element: Element, context: InlineContext): string[] {
  const code = element.childNodes.find((child): child is Element => isElement(child) && child.tagName.toLowerCase() === "code");
  const language = languageOf(code) ?? languageOf(element);
  const fenced = fencedCode(rawText(element), language, context.budget);
  return fenced.length === 0 ? [] : [fenced];
}

function listBlock(element: Element, ordered: boolean, depth: number, context: InlineContext): string[] {
  const items = element.childNodes.filter((child): child is Element => isElement(child) && child.tagName.toLowerCase() === "li");
  if (items.length === 0) {
    return [];
  }
  const start = ordered ? listStart(element) : 1;
  const lines = items.map((item, index) => {
    const marker = ordered ? `${start + index}. ` : "- ";
    const blocks = renderNodes(item.childNodes, depth, context);
    return formatItem(marker, blocks);
  });
  return [lines.join("\n")];
}

function quoteBlock(element: Element, depth: number, context: InlineContext): string[] {
  const inner = joinBlocks(renderNodes(element.childNodes, depth, context));
  if (inner.length === 0) {
    return [];
  }
  const quoted = inner
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return [quoted];
}

function tableBlock(element: Element, context: InlineContext): string[] {
  const rows = collectRows(element).map((row) => row.map((cell) => renderCell(cell, context)));
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columns === 0) {
    return [];
  }
  const widths = Array.from({ length: columns }, () => 3);
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 3, cell.length);
    });
  }
  const header = formatTableRow(padRow(rows[0] ?? [], widths));
  const separator = formatTableRow(widths.map((width) => "-".repeat(width)));
  const body = rows.slice(1).map((row) => formatTableRow(padRow(row, widths)));
  return [[header, separator, ...body].join("\n")];
}

function renderCell(cell: Element | undefined, context: InlineContext): string {
  if (!cell) {
    return "";
  }
  const text = renderInlineChildren(cell, {
    ...context,
    inLink: false,
    label: false,
    inTable: true,
    inlineDepth: 0,
  });
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function collectRows(element: Element): Array<Array<Element | undefined>> {
  const rows: Array<Array<Element | undefined>> = [];
  const stack: ChildNode[] = [...element.childNodes].reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !isElement(current)) {
      continue;
    }
    const tag = current.tagName.toLowerCase();
    if (tag === "table") {
      continue;
    }
    if (tag === "tr") {
      const cells: Array<Element | undefined> = [];
      for (const child of current.childNodes) {
        if (!isElement(child)) {
          continue;
        }
        const cellTag = child.tagName.toLowerCase();
        if (cellTag !== "td" && cellTag !== "th") {
          continue;
        }
        cells.push(child);
        const span = colspan(child);
        for (let extra = 1; extra < span; extra += 1) {
          cells.push(undefined);
        }
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
      continue;
    }
    for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
      const child = current.childNodes[index];
      if (child) {
        stack.push(child);
      }
    }
  }
  return rows;
}

function renderInline(node: ChildNode, context: InlineContext): string {
  if (isText(node)) {
    return renderText(node, context);
  }
  if (!isElement(node)) {
    return "";
  }
  if (context.inlineDepth > MAX_MARKDOWN_DEPTH) {
    return collectVisibleText([node], context);
  }
  const tag = node.tagName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) {
    return "";
  }
  const nested: InlineContext = { ...context, inlineDepth: context.inlineDepth + 1 };
  switch (tag) {
    case "br":
      return context.inTable ? " " : "  \n";
    case "strong":
    case "b":
      return wrap(renderInlineChildren(node, nested), "**");
    case "em":
    case "i":
      return wrap(renderInlineChildren(node, nested), "_");
    case "code":
      return inlineCode(rawText(node), context.budget);
    case "a":
      return renderAnchor(node, context);
    case "img":
      return renderImage(node, context);
    default:
      if (BLOCK_TAGS.has(tag)) {
        return collectVisibleText(node.childNodes, nested);
      }
      return renderInlineChildren(node, nested);
  }
}

function renderInlineChildren(element: Element, context: InlineContext): string {
  let out = "";
  for (const child of element.childNodes) {
    out += renderInline(child, context);
  }
  return out;
}

function renderAnchor(element: Element, context: InlineContext): string {
  const childContext: InlineContext = { ...context, inlineDepth: context.inlineDepth + 1 };
  if (context.inLink) {
    return renderInlineChildren(element, childContext);
  }
  const destination = safeDestination(attribute(element, "href"));
  if (!destination) {
    return renderInlineChildren(element, childContext);
  }
  const label = trimInline(renderInlineChildren(element, { ...childContext, inLink: true, label: true }));
  if (label.length === 0) {
    return "";
  }
  const encoded = `<${encodeDestination(destination)}>${formatTitle(attribute(element, "title"))}`;
  // marked treats an image nested in a link label as a new destination, so a hostile alt can
  // become a javascript: image URL. Keep the image outside the link.
  if (label.includes("![")) {
    const prose = trimInline(collectVisibleText(element.childNodes, { ...childContext, label: true }));
    const linkLabel = prose.length > 0 ? prose : "image";
    return `${label} [${linkLabel}](${encoded})`;
  }
  return `[${label}](${encoded})`;
}

function renderImage(element: Element, context: InlineContext): string {
  const alt = collapseWhitespace(attribute(element, "alt") ?? "");
  const destination = safeDestination(attribute(element, "src"));
  if (!destination) {
    return escapeText(alt, context.label, context.budget);
  }
  const image = `![${escapeLabel(alt)}](<${encodeDestination(destination)}>${formatTitle(attribute(element, "title"))})`;
  charge(context.budget, image);
  return image;
}

function renderText(node: TextNode, context: InlineContext): string {
  return escapeText(collapseWhitespace(node.value), context.label, context.budget);
}

function collectVisibleText(nodes: readonly ChildNode[], context: InlineContext): string {
  let out = "";
  const stack: ChildNode[] = [...nodes].reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (isText(current)) {
      out += renderText(current, context);
      continue;
    }
    if (!isElement(current)) {
      continue;
    }
    const tag = current.tagName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) {
      continue;
    }
    if (tag === "br") {
      out += " ";
      continue;
    }
    for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
      const child = current.childNodes[index];
      if (child) {
        stack.push(child);
      }
    }
  }
  return out;
}

function rawText(element: Element): string {
  let out = "";
  const stack: ChildNode[] = [...element.childNodes].reverse();
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (isText(current)) {
      out += current.value;
      continue;
    }
    if (!isElement(current)) {
      continue;
    }
    const tag = current.tagName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) {
      continue;
    }
    if (tag === "br") {
      out += "\n";
      continue;
    }
    for (let index = current.childNodes.length - 1; index >= 0; index -= 1) {
      const child = current.childNodes[index];
      if (child) {
        stack.push(child);
      }
    }
  }
  return out;
}

function fencedCode(code: string, language: string | undefined, budget: Budget): string {
  const normalized = code.replace(/\n$/, "");
  if (normalized.length === 0) {
    return "";
  }
  const fence = "`".repeat(Math.max(3, longestRun(normalized, "`") + 1));
  const block = `${fence}${language ?? ""}\n${normalized}\n${fence}`;
  charge(budget, block);
  return block;
}

function inlineCode(code: string, budget: Budget): string {
  if (code.length === 0) {
    return "";
  }
  const fence = "`".repeat(longestRun(code, "`") + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  const block = `${fence}${pad}${code}${pad}${fence}`;
  charge(budget, block);
  return block;
}

function longestRun(value: string, token: string): number {
  const matches = value.match(new RegExp(`${token}+`, "g"));
  if (!matches) {
    return 0;
  }
  return matches.reduce((longest, run) => Math.max(longest, run.length), 0);
}

function languageOf(element: Element | undefined): string | undefined {
  if (!element) {
    return undefined;
  }
  return LANGUAGE_HINT.exec(attribute(element, "class") ?? "")?.[1];
}

function listStart(element: Element): number {
  const raw = attribute(element, "start");
  if (!raw) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999_999) {
    return 1;
  }
  return parsed;
}

function colspan(element: Element): number {
  const raw = attribute(element, "colspan");
  if (!raw) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, 10);
}

function formatItem(marker: string, blocks: string[]): string {
  if (blocks.length === 0) {
    return marker.trimEnd();
  }
  const body = joinItemBlocks(blocks);
  const indent = " ".repeat(marker.length);
  const lines = body.split("\n");
  const rest = lines
    .slice(1)
    .map((line) => (line.trim().length === 0 ? "" : `${indent}${line}`))
    .join("\n");
  const first = lines[0] ?? "";
  const continuation = rest.length > 0 || lines.length > 1 ? `\n${rest}` : "";
  if (startsStructuralBlock(first)) {
    return `${marker.trimEnd()}\n${indent}${first}${continuation}`;
  }
  return `${marker}${first}${continuation}`;
}

function joinBlocks(blocks: string[]): string {
  let result = "";
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index] ?? "";
    if (block.length === 0) {
      continue;
    }
    if (result.length === 0) {
      result = block;
      continue;
    }
    const previous = blocks[index - 1] ?? "";
    const tight = startsList(previous) && startsList(block);
    result += tight ? `\n${block}` : `\n\n${block}`;
  }
  return result;
}

function joinItemBlocks(blocks: string[]): string {
  let result = "";
  for (const block of blocks) {
    if (block.length === 0) {
      continue;
    }
    if (result.length === 0) {
      result = block;
      continue;
    }
    result += startsList(block) ? `\n${block}` : `\n\n${block}`;
  }
  return result;
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function padRow(row: string[], widths: number[]): string[] {
  return widths.map((width, index) => {
    const cell = row[index] ?? "";
    return cell.length >= width ? cell : `${cell}${" ".repeat(width - cell.length)}`;
  });
}

function startsList(block: string): boolean {
  return /^(?:- |\d+\. )/.test(block);
}

function startsStructuralBlock(block: string): boolean {
  return startsList(block) || block.startsWith("```") || block.startsWith("|");
}

function wrap(inner: string, marker: string): string {
  if (inner.trim().length === 0) {
    return inner;
  }
  return `${marker}${inner}${marker}`;
}

function trimInline(value: string): string {
  return value.replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, "").replace(/^\n+|\n+$/g, "");
}

function collapseWhitespace(value: string): string {
  return value.replace(/[\t\n\r\f\v ]+/g, " ");
}

function escapeText(value: string, label: boolean, budget: Budget): string {
  const escaped = label ? escapeLabel(value) : value.replace(/[\\&<>]/g, (char) => TEXT_ESCAPES[char] ?? char);
  charge(budget, escaped);
  return escaped;
}

function escapeLabel(value: string): string {
  return value.replace(/[\\&<>]/g, (char) => TEXT_ESCAPES[char] ?? char).replace(/[[\]]/g, (char) => `\\${char}`);
}

function formatTitle(title: string | undefined): string {
  if (!title) {
    return "";
  }
  const escaped = title.replace(/[\r\n\t\f\v]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return ` "${escaped}"`;
}

function attribute(element: Element, name: string): string | undefined {
  const found = element.attrs.find((entry) => entry.name.toLowerCase() === name);
  return found?.value;
}

function safeDestination(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const compact = compactUrl(value);
  if (compact.length === 0) {
    return undefined;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "http" && scheme !== "https" && scheme !== "mailto") {
    return undefined;
  }
  return value;
}

function encodeDestination(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === " " || char === "<" || char === ">" || char === "\\" || code <= 0x1f || code === 0x7f) {
      for (const byte of Buffer.from(char)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
      continue;
    }
    out += char;
  }
  return out;
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

function charge(budget: Budget, text: string): void {
  budget.bytes += Buffer.byteLength(text);
  if (budget.bytes > MAX_MARKDOWN_OUTPUT_BYTES) {
    throw new HtmlConversionError("Markdown output exceeds the conversion limit.", { limit: "output" });
  }
}

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

function isElement(node: ChildNode): node is Element {
  return node.nodeName !== "#text" && node.nodeName !== "#comment" && node.nodeName !== "#documentType";
}

function isBlockElement(node: Element): boolean {
  return BLOCK_TAGS.has(node.tagName.toLowerCase());
}
