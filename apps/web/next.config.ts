import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyNextPublicApiUrl, defaultAppEnvFile } from "./load-public-api-url.mjs";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const appEnvFile = process.env.FACTROVE_APP_ENV_FILE?.trim() || defaultAppEnvFile();
applyNextPublicApiUrl(process.env, appEnvFile);
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

const noStore = [{ key: "Cache-Control", value: "no-store" }];
const shareHeaders = [
  ...noStore,
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex" }
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(webDir, "../.."),
  ...(publicApiUrl ? { env: { NEXT_PUBLIC_API_URL: publicApiUrl } } : {}),
  agentRules: false,
  async headers() {
    return [
      { source: "/", headers: noStore },
      { source: "/share/:path*", headers: shareHeaders },
      { source: "/:path*", headers: noStore }
    ];
  }
};

export default nextConfig;
