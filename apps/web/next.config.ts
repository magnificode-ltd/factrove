import type { NextConfig } from "next";

const noStore = [{ key: "Cache-Control", value: "no-store" }];

const nextConfig: NextConfig = {
  agentRules: false,
  async headers() {
    return [
      { source: "/", headers: noStore },
      { source: "/:path*", headers: noStore }
    ];
  }
};

export default nextConfig;
