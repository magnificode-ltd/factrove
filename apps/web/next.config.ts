import type { NextConfig } from "next";
import { applyNextPublicApiUrl, defaultAppEnvFile } from "./load-public-api-url.mjs";

const appEnvFile = process.env.FACTROVE_APP_ENV_FILE?.trim() || defaultAppEnvFile();
applyNextPublicApiUrl(process.env, appEnvFile);
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

const noStore = [{ key: "Cache-Control", value: "no-store" }];

const nextConfig: NextConfig = {
  ...(publicApiUrl ? { env: { NEXT_PUBLIC_API_URL: publicApiUrl } } : {}),
  agentRules: false,
  async headers() {
    return [
      { source: "/", headers: noStore },
      { source: "/:path*", headers: noStore }
    ];
  }
};

export default nextConfig;
