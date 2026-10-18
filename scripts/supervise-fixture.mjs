import { writeSync } from "node:fs";
import { supervise } from "./supervise.mjs";

const mode = process.argv[2] ?? "hold";
const holdArgs = ["-e", "setInterval(() => {}, 1000)"];
const exitArgs = ["-e", "process.exit(0)"];

supervise(
  [
    {
      name: "api",
      command: process.execPath,
      args: holdArgs,
      cwd: process.cwd(),
      env: process.env,
    },
    {
      name: "web",
      command: process.execPath,
      args: mode === "one-exits" ? exitArgs : holdArgs,
      cwd: process.cwd(),
      env: process.env,
    },
  ],
  {
    onChild(name, pid) {
      if (pid) {
        writeSync(1, `pid ${name} ${pid}\n`);
      }
    },
  },
);

if (mode === "exit-now") {
  setTimeout(() => {
    process.exit(3);
  }, 200);
}
