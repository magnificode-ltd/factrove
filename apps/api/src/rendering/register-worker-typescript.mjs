import { register } from "node:module";

register(new URL("./worker-typescript-hook.mjs", import.meta.url), import.meta.url);
