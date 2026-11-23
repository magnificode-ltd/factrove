import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const webSrc = fileURLToPath(new URL("../web/src", import.meta.url));
const headersStub = fileURLToPath(new URL("./test/next-headers-stub.ts", import.meta.url));
const navigationStub = fileURLToPath(new URL("./test/next-navigation-stub.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${webSrc}/` },
      { find: /^next\/headers$/, replacement: headersStub },
      { find: /^next\/navigation$/, replacement: navigationStub },
    ],
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        jsx: "react-jsx",
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
