import { docsBaseUrl } from "@/public-config";

export function docsUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${docsBaseUrl()}${suffix}`;
}
