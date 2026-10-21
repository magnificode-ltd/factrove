import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/next-env.d.ts", "packages/contracts/src/common-password-list.ts"] },
  ...tseslint.configs.recommended
);
