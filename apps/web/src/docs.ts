/** Public docs site built from `docs/` on main. Change this when the docs domain changes. */
export const DOCS_BASE_URL = "https://factrove.mintlify.app";

export function docsUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${DOCS_BASE_URL}${suffix}`;
}
