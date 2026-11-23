// Same-origin relative paths only. A value that could leave this origin
// becomes "/". Invitation returns are the accept page and nothing else.
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

const RETURN_BASE = "http://return.invalid";

export function invitationReturnPath(value: string | null | undefined): string | null {
  const path = safeNextPath(value);
  if (path === "/") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(path, RETURN_BASE);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_BASE || url.username.length > 0 || url.password.length > 0) {
    return null;
  }
  if (url.pathname !== "/invites/accept") {
    return null;
  }
  return `${url.pathname}${url.search}`;
}
