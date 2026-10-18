import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  cliLaunch,
  composeArgs,
  composeFile,
  infraFailureHint,
  invocationCwd,
  missingApiSettings,
  repoRoot,
  webDevArgs,
  webDevBin,
  webLaunchEnv,
  workspaceBuildArgs,
} from "./local-runtime.mjs";

describe("local runtime", () => {
  it("starts the caller directory as the CLI working directory and drops infrastructure secrets", () => {
    const launch = cliLaunch(
      {
        INIT_CWD: repoRoot,
        PATH: "/usr/bin",
        DATABASE_URL: "postgresql://factrove:factrove@127.0.0.1:5432/factrove",
        AWS_SECRET_ACCESS_KEY: "secret",
        S3_BUCKET: "bucket",
        FACTROVE_API_URL: "http://127.0.0.1:3999",
      },
      tmpdir(),
      {
        FACTROVE_API_URL: "http://localhost:3001",
        DATABASE_URL: "postgresql://from-file",
        AWS_ACCESS_KEY_ID: "from-file",
      },
    );

    assert.equal(launch.cwd, repoRoot);
    assert.equal(launch.env.INIT_CWD, undefined);
    assert.equal(launch.env.DATABASE_URL, undefined);
    assert.equal(launch.env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(launch.env.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(launch.env.S3_BUCKET, undefined);
    assert.equal(launch.env.FACTROVE_API_URL, "http://127.0.0.1:3999");
    assert.equal(launch.env.PATH, "/usr/bin");
  });

  it("uses a relative INIT_CWD and the root env file only when the process variable is blank", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-runtime-"));
    const nested = join(directory, "docs");
    await mkdir(nested);

    assert.equal(invocationCwd({ INIT_CWD: "docs" }, directory), nested);
    assert.equal(invocationCwd({ INIT_CWD: join(directory, "missing") }, directory), directory);
    assert.equal(invocationCwd({ INIT_CWD: "   " }, directory), directory);

    const launch = cliLaunch({ INIT_CWD: "docs", FACTROVE_API_URL: "   " }, directory, {
      FACTROVE_API_URL: "http://localhost:3001",
    });
    assert.equal(launch.cwd, nested);
    assert.equal(launch.env.FACTROVE_API_URL, "http://localhost:3001");
    assert.equal(launch.env.INIT_CWD, undefined);
  });

  it("gives the web app the public API origin and withholds database and storage settings", () => {
    const env = webLaunchEnv(
      {
        PATH: "/usr/bin",
        DATABASE_URL: "postgresql://factrove:factrove@127.0.0.1:5432/factrove",
        BASE_URL: "http://127.0.0.1:3001",
        AWS_PROFILE: "dev",
        S3_REGION: "eu-central-1",
        NEXT_PUBLIC_API_URL: "",
      },
      {
        NEXT_PUBLIC_API_URL: "http://localhost:3001",
        FACTROVE_API_URL: "http://localhost:3001",
        DATABASE_URL: "postgresql://from-file",
      },
    );

    assert.equal(env.NEXT_PUBLIC_API_URL, "http://localhost:3001");
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.BASE_URL, undefined);
    assert.equal(env.AWS_PROFILE, undefined);
    assert.equal(env.S3_REGION, undefined);
    assert.equal(env.FACTROVE_API_URL, undefined);
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(workspaceBuildArgs.includes("@factrove/web"), false);
    assert.equal(webDevArgs.includes("--hostname"), true);
    assert.equal(webDevArgs.includes("127.0.0.1"), true);
    assert.equal(webDevBin.endsWith("/apps/web/node_modules/.bin/next"), true);
  });

  it("keeps an explicit web origin and reports missing API settings", () => {
    const env = webLaunchEnv({ NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001" }, { NEXT_PUBLIC_API_URL: "http://localhost:3001" });
    assert.equal(env.NEXT_PUBLIC_API_URL, "http://127.0.0.1:3001");
    assert.deepEqual(missingApiSettings({}, {}), ["DATABASE_URL", "S3_BUCKET", "S3_REGION"]);
    assert.deepEqual(missingApiSettings({ DATABASE_URL: "postgresql://local" }, { S3_BUCKET: "bucket", S3_REGION: "eu-central-1" }), []);
  });

  it("stops infrastructure without removing the volume", () => {
    const down = composeArgs("down");
    const up = composeArgs("up");
    const reset = composeArgs("reset");

    assert.equal(down.includes("--volumes"), false);
    assert.equal(down.includes("-v"), false);
    assert.equal(up.includes("--volumes"), false);
    assert.equal(up.includes("--wait"), true);
    assert.equal(reset.includes("--volumes"), true);
    assert.equal(reset.filter((arg) => arg === "--volumes").length, 1);
    assert.equal(down[0], "compose");
    assert.ok(down.includes(composeFile));
    assert.throws(() => composeArgs("drop"), /Unknown infra action/);
  });

  it("explains a stopped daemon and a taken Postgres port", () => {
    assert.match(infraFailureHint("Cannot connect to the Docker daemon at unix:///var/run/docker.sock"), /Start Docker Desktop/);
    assert.match(infraFailureHint("Bind for 127.0.0.1:5432 failed: port is already allocated"), /5432/);
    assert.equal(infraFailureHint("network factrove_default removed"), "");
  });

  it("pins a loopback Postgres service and keeps object storage out of Compose", () => {
    const compose = readFileSync(composeFile, "utf8");
    assert.match(compose, /127\.0\.0\.1:5432:5432/);
    assert.match(compose, /postgres:17\.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3/);
    assert.match(compose, /factrove-postgres:/);
    assert.equal(compose.toLowerCase().includes("minio"), false);
    assert.equal(compose.toLowerCase().includes("localstack"), false);
    assert.equal(compose.includes("S3_"), false);

    const rootExample = readFileSync(join(repoRoot, ".env.example"), "utf8");
    assert.match(rootExample, /^FACTROVE_API_URL=http:\/\/localhost:3001$/m);
    assert.match(rootExample, /^NEXT_PUBLIC_API_URL=http:\/\/localhost:3001$/m);
    assert.equal(rootExample.includes("DATABASE_URL"), false);
    assert.equal(rootExample.includes("AWS_"), false);
    assert.equal(rootExample.includes("S3_"), false);

    const apiExample = readFileSync(join(repoRoot, "apps/api/.env.example"), "utf8");
    assert.match(apiExample, /^DATABASE_URL=postgresql:\/\/factrove:factrove@127\.0\.0\.1:5432\/factrove$/m);
    assert.match(apiExample, /^S3_BUCKET=your-bucket$/m);
  });
});
