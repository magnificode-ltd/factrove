export const MAX_HTML_BYTES = 10_485_760;
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

const HTML_EXTENSION = /\.(html|htm)$/i;

export type HtmlPolicyViolation = {
  status: 400 | 413 | 415;
  code: "INVALID_REQUEST" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE";
  message: string;
};

export function artifactObjectKey(id: string): string {
  return `${id}.html`;
}

export function contentSecurityPolicy(webOrigin: string): string {
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
    `frame-ancestors ${webOrigin}`,
  ].join("; ");
}

export function htmlContentHeaders(webOrigin: string, sizeBytes: number): Array<[string, string]> {
  return [
    ["Content-Type", HTML_CONTENT_TYPE],
    ["Content-Length", String(sizeBytes)],
    ["Cache-Control", "no-store"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["Content-Security-Policy", contentSecurityPolicy(webOrigin)],
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
