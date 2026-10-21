export const MAX_HTML_BYTES = 10_485_760;
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

const HTML_EXTENSION = /\.(html|htm)$/i;

export type HtmlPolicyViolation = {
  status: 400 | 413 | 415;
  code: "INVALID_REQUEST" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE";
  message: string;
};

export function artifactObjectKey(id: string): string {
  return `${id}.html`;
}

// Busboy's default filename charset is Latin-1. Browsers and Node's FormData put UTF-8
// bytes in that parameter, so café.html arrives as cafÃ©.html. A string that is already
// Unicode, or that is not valid UTF-8, is left as busboy decoded it.
export function decodeMultipartFilename(originalname: string): string {
  if ([...originalname].some((char) => (char.codePointAt(0) ?? 0) > 0xff)) {
    return originalname;
  }
  const bytes = Buffer.from(originalname, "latin1");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return originalname;
  }
}

// One immutable object per upload. The artifact id is the prefix so a row cannot point at another artifact.
export function immutableContentKey(artifactId: string, contentId: string): string {
  return `${artifactId}/${contentId}.html`;
}

// A blank key is the legacy object from before object_key was stored.
export function storedObjectKey(artifactId: string, objectKey: string | null | undefined): string {
  if (typeof objectKey === "string" && objectKey.trim().length > 0) {
    return objectKey;
  }
  return artifactObjectKey(artifactId);
}

export function contentSecurityPolicy(frameAncestors: readonly string[]): string {
  return [
    // allow-scripts only: no same-origin access, forms, or top-level navigation.
    "sandbox allow-scripts",
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestors.join(" ")}`,
  ].join("; ");
}

export function htmlContentHeaders(frameAncestors: readonly string[], sizeBytes: number): Array<[string, string]> {
  return [
    ["Content-Type", HTML_CONTENT_TYPE],
    ["Content-Length", String(sizeBytes)],
    ["Cache-Control", "no-store"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["Content-Security-Policy", contentSecurityPolicy(frameAncestors)],
  ];
}

export function markdownContentSecurityPolicy(): string {
  return [
    "sandbox",
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function markdownContentHeaders(sizeBytes: number): Array<[string, string]> {
  return [
    ["Content-Type", MARKDOWN_CONTENT_TYPE],
    ["Content-Length", String(sizeBytes)],
    ["Cache-Control", "no-store"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["Content-Security-Policy", markdownContentSecurityPolicy()],
  ];
}

export function rejectHtmlUpload(filename: string, bytes: Uint8Array): HtmlPolicyViolation | undefined {
  const base = uploadBasename(filename);
  if (base.length === 0 || base === "." || base === "..") {
    return {
      status: 400,
      code: "INVALID_REQUEST",
      message: "A file name is required.",
    };
  }
  if (!HTML_EXTENSION.test(base)) {
    return {
      status: 415,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Only .html and .htm files are supported.",
    };
  }
  if (bytes.byteLength === 0) {
    return {
      status: 400,
      code: "INVALID_REQUEST",
      message: "The HTML file is empty.",
    };
  }
  if (bytes.byteLength > MAX_HTML_BYTES) {
    return {
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "The file exceeds the 10 MiB limit.",
    };
  }
  if (!isUtf8(bytes)) {
    return {
      status: 400,
      code: "INVALID_REQUEST",
      message: "The file is not valid UTF-8.",
    };
  }
  return undefined;
}

function uploadBasename(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
