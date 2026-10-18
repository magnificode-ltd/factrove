import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { composeArgs, infraFailureHint, resetDecision } from "./local-runtime.mjs";

const action = process.argv[2];
if (action !== "up" && action !== "down" && action !== "reset") {
  process.stderr.write("Usage: node scripts/infra.mjs up|down|reset\n");
  process.exit(1);
}

if (action === "reset") {
  const decision = resetDecision(process.argv.slice(3), Boolean(process.stdin.isTTY));
  if (decision === "refuse") {
    process.stderr.write(
      "Refusing to delete the local PostgreSQL and object-storage volumes without confirmation. Run pnpm infra:reset -- --yes. Reset removes database rows and objects stored in the local S3 stand-in. Objects in a real AWS bucket are not deleted.\n",
    );
    process.exit(1);
  }
  if (decision === "prompt") {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = (
      await rl.question(
        "Delete the local PostgreSQL and object-storage volumes? Artifact rows and objects stored in the local S3 stand-in are removed. Objects in a real AWS bucket are not deleted. Type yes to continue: ",
      )
    ).trim();
    rl.close();
    if (answer !== "yes") {
      process.stderr.write("Reset cancelled.\n");
      process.exit(1);
    }
  }
  process.stderr.write(
    "Deleting the local PostgreSQL and object-storage volumes. Artifact metadata and objects stored in the local S3 stand-in will be removed. Objects in a real AWS bucket are not deleted.\n",
  );
}

const child = spawn("docker", composeArgs(action), { stdio: ["ignore", "inherit", "pipe"] });
let stderr = "";

child.stderr?.setEncoding("utf8");
child.stderr?.on("data", (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});

child.on("error", (error) => {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "ENOENT") {
    process.stderr.write(
      "Docker Compose is not available. Install Docker Desktop, or another runtime that provides the docker compose command, and start it.\n",
    );
  } else {
    process.stderr.write(`${error.message}\n`);
  }
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }
  if ((code ?? 1) !== 0) {
    const hint = infraFailureHint(stderr);
    if (hint.length > 0) {
      process.stderr.write(`${hint}\n`);
    }
    process.exit(code ?? 1);
  }
  if (action === "up") {
    process.stderr.write("PostgreSQL is ready on 127.0.0.1:5432 (database factrove).\n");
    process.stderr.write("Local S3 is ready on http://127.0.0.1:3900 (bucket factrove).\n");
    process.stderr.write("The data volumes are kept by pnpm infra:down. Next: pnpm db:migrate && pnpm db:seed\n");
  } else if (action === "down") {
    process.stderr.write("Stopped local services. The PostgreSQL and local object-storage volumes were kept.\n");
    process.stderr.write("To delete those volumes, run pnpm infra:reset.\n");
  } else {
    process.stderr.write(
      "Stopped local services and deleted the PostgreSQL and local object-storage volumes. Objects in a real AWS bucket were not deleted.\n",
    );
  }
  process.exit(0);
});
