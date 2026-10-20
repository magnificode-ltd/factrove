export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "/";
  }
  const path = value.trim();
  if (path.length === 0 || path.length > 2048) {
    return "/";
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return "/";
  }
  if (path.includes("\\") || path.includes("://") || /[\u0000-\u001f\u007f]/.test(path)) {
    return "/";
  }
  return path;
}

export function artifactReturnPath(id: string): string {
  return `/artifacts/${encodeURIComponent(id)}`;
}

export function authPageHref(page: "login" | "signup", next: string): string {
  const safe = safeNextPath(next);
  if (safe === "/") {
    return `/${page}`;
  }
  return `/${page}?next=${encodeURIComponent(safe)}`;
}
