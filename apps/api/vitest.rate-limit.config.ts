import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    include: ["test/rate-limit.production.test.ts"],
    env: {
      NODE_ENV: "production",
    },
  },
});
