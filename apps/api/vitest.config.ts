import { configDefaults, defineConfig } from "vitest/config";

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
    poolOptions: {
      forks: {
        execArgv: ["--expose-gc"],
      },
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    exclude: [...configDefaults.exclude, "test/rate-limit.production.test.ts"],
  },
});
