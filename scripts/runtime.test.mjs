import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  cliEnvFilePath,
  cliLaunch,
  composeArgs,
  composeFile,
  e2eComposeArgs,
  e2eProjectName,
  infraFailureHint,
  launcherSkipsEnvFile,
  launcherWantsJson,
  legacyRootEnvWarning,
  localGarageEnv,
  prepareLocalGarageEnv,
  invocationCwd,
  missingApiSettings,
  readCliEnvFile,
  repoRoot,
  resetDecision,
  restoreFileSnapshot,
  snapshotFile,
  webAppDir,
  webDevArgs,
  webDevBin,
  webLaunchEnv,
  workspaceBuildArgs,
} from "./local-runtime.mjs";
import { applyNextPublicApiUrl } from "../apps/web/load-public-api-url.mjs";

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

  it("uses a relative INIT_CWD and leaves CLI settings for the CLI env file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-runtime-"));
    const nested = join(directory, "docs");
    await mkdir(nested);

    assert.equal(invocationCwd({ INIT_CWD: "docs" }, directory), nested);
    assert.equal(invocationCwd({ INIT_CWD: join(directory, "missing") }, directory), directory);
    assert.equal(invocationCwd({ INIT_CWD: "   " }, directory), directory);

    const launch = cliLaunch({ INIT_CWD: "docs", FACTROVE_API_URL: "   " }, directory);
    assert.equal(launch.cwd, nested);
    assert.equal(launch.env.FACTROVE_API_URL, "   ");
    assert.equal(launch.env.INIT_CWD, undefined);
  });

  it("ranks a dev env file below the process environment and a profile URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-cli-env-"));
    const envFile = join(directory, "cli.env");
    writeFileSync(
      envFile,
      [
        "FACTROVE_API_URL=http://from-file",
        "FACTROVE_PROFILE=from-file",
        "FACTROVE_API_KEY=ftrv_from_file",
        "FACTROVE_CONFIG_DIR=/tmp/should-not-redirect",
        "DATABASE_URL=postgresql://secret",
        "NEXT_PUBLIC_API_URL=http://web",
      ].join("\n"),
    );
    const loaded = readCliEnvFile(envFile);
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.values, {
      FACTROVE_API_URL: "http://from-file",
      FACTROVE_PROFILE: "from-file",
    });
    assert.equal(readCliEnvFile(join(directory, "missing.env")).ok, true);

    const ranked = cliLaunch(
      { FACTROVE_DEV_API_URL: "http://stray", FACTROVE_API_KEY: "ftrv_keep" },
      directory,
      loaded.values,
    );
    assert.equal(ranked.env.FACTROVE_API_URL, undefined);
    assert.equal(ranked.env.FACTROVE_DEV_API_URL, "http://from-file");
    assert.equal(ranked.env.FACTROVE_PROFILE, "from-file");
    assert.equal(ranked.env.FACTROVE_API_KEY, "ftrv_keep");
    assert.equal(ranked.env.FACTROVE_CONFIG_DIR, undefined);
    assert.equal(ranked.env.DATABASE_URL, undefined);

    const processWins = cliLaunch(
      { FACTROVE_API_URL: "http://from-env", FACTROVE_PROFILE: "from-env" },
      directory,
      loaded.values,
    );
    assert.equal(processWins.env.FACTROVE_API_URL, "http://from-env");
    assert.equal(processWins.env.FACTROVE_PROFILE, "from-env");
    assert.equal(processWins.env.FACTROVE_DEV_API_URL, undefined);

    const cleared = cliLaunch({ FACTROVE_DEV_API_URL: "http://stray" }, directory, {});
    assert.equal(cleared.env.FACTROVE_DEV_API_URL, undefined);
    assert.equal(cliEnvFilePath({}), join(repoRoot, "apps/cli/.env"));
    assert.equal(cliEnvFilePath({ FACTROVE_CLI_ENV_FILE: envFile }), envFile);
    assert.equal(launcherSkipsEnvFile(["upload", "--help"]), true);
    assert.equal(launcherSkipsEnvFile(["--json", "help"]), true);
    assert.equal(launcherSkipsEnvFile(["upload", "report.html"]), false);
    assert.equal(launcherWantsJson(["upload", "report.html", "--json"]), true);
    assert.equal(launcherWantsJson(["upload", "report.html", "--api-url", "http://127.0.0.1:9", "--json"]), true);
    assert.equal(launcherWantsJson(["upload", "--", "--json"]), false);
    assert.equal(launcherWantsJson(["upload", "--output", "json", "a.html"]), true);
    assert.equal(launcherWantsJson(["upload", "--output=text", "a.html"]), false);
    assert.equal(launcherWantsJson(["upload", "--json", "--output", "text", "a.html"]), true);
    assert.equal(launcherWantsJson(["upload", "--output", "text", "--json", "a.html"]), true);
    assert.equal(launcherWantsJson(["upload", "--json", "--", "--output", "text"]), true);
    assert.equal(launcherWantsJson(["upload", "--artifactId", "123e4567-e89b-42d3-a456-426614174000", "--json", "a.html"]), true);
    assert.equal(launcherSkipsEnvFile(["s3", "help"]), false);
    assert.equal(launcherSkipsEnvFile(["get", "--help"]), true);

    const blocked = readCliEnvFile(directory);
    assert.equal(blocked.ok, false);
    assert.match(blocked.message, /Could not read the CLI environment file/);
    await rm(directory, { recursive: true, force: true });
  });

  it("gives the web app the public API origin and withholds database and storage settings", () => {
    const env = webLaunchEnv(
      {
        PATH: "/usr/bin",
        DATABASE_URL: "postgresql://factrove:factrove@127.0.0.1:5432/factrove",
        BASE_URL: "http://127.0.0.1:3001",
        AWS_PROFILE: "dev",
        S3_REGION: "us-west-2",
        S3_ENDPOINT: "http://127.0.0.1:3900",
        NEXT_PUBLIC_API_URL: "",
      },
      {
        NEXT_PUBLIC_API_URL: "http://localhost:3001",
        FACTROVE_API_URL: "http://localhost:3001",
        DATABASE_URL: "postgresql://from-file",
        SOURCE_CODE_URL: "https://git.example.com/from-file",
        POSTHOG_KEY: "phc_fromfilekey",
      },
    );

    assert.equal(env.NEXT_PUBLIC_API_URL, "http://localhost:3001");
    assert.equal(env.SOURCE_CODE_URL, undefined);
    assert.equal(env.POSTHOG_KEY, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.BASE_URL, undefined);
    assert.equal(env.AWS_PROFILE, undefined);
    assert.equal(env.S3_REGION, undefined);
    assert.equal(env.S3_ENDPOINT, undefined);
    assert.equal(env.FACTROVE_API_URL, undefined);
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(workspaceBuildArgs.includes("@factrove/web"), false);
    assert.equal(webDevArgs.includes("--hostname"), true);
    assert.equal(webDevArgs.includes("127.0.0.1"), true);
    assert.equal(webDevBin.endsWith("/apps/web/node_modules/.bin/next"), true);
  });

  it("keeps an explicit web origin and reports missing API settings", async () => {
    const env = webLaunchEnv(
      { NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001", SOURCE_CODE_URL: "https://git.example.com/fork", POSTHOG_KEY: "phc_parentkey" },
      { NEXT_PUBLIC_API_URL: "http://localhost:3001" },
    );
    assert.equal(env.NEXT_PUBLIC_API_URL, "http://127.0.0.1:3001");
    assert.equal(env.SOURCE_CODE_URL, "https://git.example.com/fork");
    assert.equal(env.POSTHOG_KEY, "phc_parentkey");
    assert.equal(legacyRootEnvWarning(join(repoRoot, ".env-does-not-exist")), "");
    const legacyDir = await mkdtemp(join(tmpdir(), "factrove-legacy-env-"));
    const legacyFile = join(legacyDir, ".env");
    writeFileSync(legacyFile, "NEXT_PUBLIC_API_URL=http://legacy\n");
    assert.match(legacyRootEnvWarning(legacyFile), /apps\/api\/\.env/);
    assert.match(legacyRootEnvWarning(legacyFile), /apps\/cli\/\.env/);
    await rm(legacyDir, { recursive: true, force: true });
    assert.deepEqual(missingApiSettings({}, {}), ["DATABASE_URL", "S3_BUCKET", "S3_REGION"]);
    assert.deepEqual(missingApiSettings({ DATABASE_URL: "postgresql://local" }, { S3_BUCKET: "bucket", S3_REGION: "us-west-2" }), []);
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
    assert.equal(down.includes(e2eProjectName), false);
    assert.equal(reset.includes(e2eProjectName), false);
    assert.throws(() => composeArgs("drop"), /Unknown infra action/);

    const e2eReset = e2eComposeArgs("reset");
    const e2eDown = e2eComposeArgs("down");
    assert.equal(e2eReset.includes("--volumes"), true);
    assert.equal(e2eDown.includes("--volumes"), false);
    assert.equal(e2eReset.includes("-p"), true);
    assert.ok(e2eReset.includes(e2eProjectName));
    assert.equal(e2eProjectName, "factrove-e2e");
  });

  it("explains a stopped daemon and a taken Postgres port", () => {
    assert.match(infraFailureHint("Cannot connect to the Docker daemon at unix:///var/run/docker.sock"), /Start Docker Desktop/);
    assert.match(infraFailureHint("Bind for 127.0.0.1:5432 failed: port is already allocated"), /5432/);
    assert.match(infraFailureHint("Bind for 127.0.0.1:3900 failed: port is already allocated"), /3900/);
    assert.match(infraFailureHint("Bind for 127.0.0.1:5433 failed: port is already allocated"), /5433/);
    assert.match(infraFailureHint("Bind for 127.0.0.1:3910 failed: port is already allocated"), /3910/);
    assert.match(infraFailureHint("failed to resolve reference"), /pinned container image/);
    assert.equal(infraFailureHint("network factrove_default removed"), "");
  });

  it("pins loopback Postgres and the local Garage S3 stand-in", () => {
    const compose = readFileSync(composeFile, "utf8");
    assert.match(compose, /127\.0\.0\.1:\$\{FACTROVE_POSTGRES_PORT:-5432\}:5432/);
    assert.match(compose, /postgres:17\.11@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3/);
    assert.match(compose, /factrove-postgres:/);
    assert.match(compose, /127\.0\.0\.1:\$\{FACTROVE_GARAGE_PORT:-3900\}:3900/);
    assert.match(compose, /Local only\. Do not reuse these Garage credentials/);
    assert.match(compose, /dxflrs\/garage:v2\.3\.0@sha256:866bd13ed2038ba7e7190e840482bc27234c4afaf77be8cfa439ae088c1e4690/);
    assert.match(compose, /--default-bucket/);
    assert.match(compose, /factrove-garage-meta:/);
    assert.match(compose, /factrove-garage-data:/);
    assert.match(compose, /GARAGE_DEFAULT_BUCKET: factrove/);

    assert.equal(existsSync(join(repoRoot, ".env.example")), false);

    const apiExample = readFileSync(join(repoRoot, "apps/api/.env.example"), "utf8");
    assert.match(apiExample, /^NEXT_PUBLIC_API_URL=http:\/\/localhost:3001$/m);
    assert.match(apiExample, /client bundle/);
    assert.equal(apiExample.includes("FACTROVE_"), false);
    assert.match(apiExample, /^DATABASE_URL=postgresql:\/\/factrove:factrove@127\.0\.0\.1:5432\/factrove$/m);
    assert.match(apiExample, /^S3_BUCKET=factrove$/m);
    assert.match(apiExample, /^S3_REGION=us-east-1$/m);
    assert.match(apiExample, /^S3_ENDPOINT=http:\/\/127\.0\.0\.1:3900$/m);
    assert.match(apiExample, /^S3_FORCE_PATH_STYLE=true$/m);
    assert.match(apiExample, /^AWS_ACCESS_KEY_ID=factrove-local$/m);
    assert.match(apiExample, /^AWS_SECRET_ACCESS_KEY=factrove-local-secret$/m);
    assert.match(apiExample, /Plain http:\/\/ is accepted only for localhost, 127\.0\.0\.1, and ::1/);
    assert.match(apiExample, /^EMAIL_TRANSPORT=log$/m);
    assert.equal(/^EMAIL_FROM_ADDRESS=\S/m.test(apiExample), false);
    assert.match(apiExample, /^# EMAIL_FROM_ADDRESS=library@example\.com$/m);
    assert.match(apiExample, /^EMAIL_FROM_NAME=Factrove$/m);
    assert.equal(apiExample.includes("BREVO_SENDER_"), false);
    assert.equal(/^BREVO_API_KEY=\S/m.test(apiExample), false);
    assert.equal(/^SMTP_PASSWORD=\S/m.test(apiExample), false);

    const cliExample = readFileSync(join(repoRoot, "apps/cli/.env.example"), "utf8");
    assert.match(cliExample, /^FACTROVE_API_URL=http:\/\/localhost:3001$/m);
    assert.match(cliExample, /https:\/\/api\.factrove\.app/);
    assert.match(cliExample, /^# FACTROVE_PROFILE=default$/m);
    assert.equal(/^[^#\n]*FACTROVE_API_KEY=/m.test(cliExample), false);
    assert.equal(cliExample.includes("DATABASE_URL"), false);
    assert.equal(cliExample.includes("NEXT_PUBLIC_"), false);
    assert.equal(cliExample.includes("AWS_"), false);
    assert.equal(cliExample.includes("S3_"), false);
    const launcher = readFileSync(join(repoRoot, "scripts/factrove.mjs"), "utf8");
    assert.match(launcher, /readCliEnvFile/);
    assert.match(launcher, /launcherSkipsEnvFile/);
    assert.equal(launcher.includes("readDotEnv"), false);
    assert.equal(launcher.includes("FACTROVE_API_URL"), false);
    assert.equal(launcher.includes("loadCliEnv"), false);
    const cliPackage = JSON.parse(readFileSync(join(repoRoot, "apps/cli/package.json"), "utf8"));
    assert.deepEqual(cliPackage.files, ["dist", "README.md", "LICENSE"]);
    assert.equal(cliPackage.private, true);
    assert.equal(cliPackage.name, "@factrove/cli");
    assert.deepEqual(cliPackage.engines, { node: ">=24.7.0 <25" });
    const cliMain = readFileSync(join(repoRoot, "apps/cli/src/main.ts"), "utf8");
    assert.equal(cliMain.includes("loadCliEnv"), false);
    const devScript = readFileSync(join(repoRoot, "scripts/dev.mjs"), "utf8");
    assert.match(devScript, /legacyRootEnvWarning/);
  });

  it("replaces shell S3 and AWS overrides with the local Garage endpoint", () => {
    const parent = {
      S3_ENDPOINT: "",
      S3_BUCKET: "real-bucket",
      S3_REGION: "us-west-2",
      AWS_ACCESS_KEY_ID: "AKIAREALKEY",
      AWS_SECRET_ACCESS_KEY: "real-secret-value",
      AWS_SESSION_TOKEN: "real-session",
      AWS_PROFILE: "prod",
      AWS_ENDPOINT_URL: "https://s3.us-east-1.amazonaws.com",
      AWS_ENDPOINT_URL_S3: "https://s3.us-east-1.amazonaws.com",
      S3_INTEGRATION: "1",
      PATH: "/usr/bin",
      DATABASE_URL: "postgresql://factrove:factrove@127.0.0.1:5432/factrove",
    };
    const env = localGarageEnv(parent, { garagePort: "3910" });

    assert.equal(env.S3_ENDPOINT, "http://127.0.0.1:3910");
    assert.equal(env.S3_BUCKET, "factrove");
    assert.equal(env.S3_REGION, "us-east-1");
    assert.equal(env.S3_FORCE_PATH_STYLE, "true");
    assert.equal(env.AWS_ACCESS_KEY_ID, "factrove-local");
    assert.equal(env.AWS_SECRET_ACCESS_KEY, "factrove-local-secret");
    assert.equal(env.AWS_SESSION_TOKEN, undefined);
    assert.equal(env.AWS_PROFILE, undefined);
    assert.equal(env.AWS_ENDPOINT_URL, undefined);
    assert.equal(env.AWS_ENDPOINT_URL_S3, undefined);
    assert.equal(env.S3_INTEGRATION, "1");
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.DATABASE_URL, parent.DATABASE_URL);
    assert.equal(parent.AWS_ACCESS_KEY_ID, "AKIAREALKEY");
    assert.throws(() => prepareLocalGarageEnv({}, { garagePort: "nope" }), /Garage port/);
    assert.throws(() => localGarageEnv({}, { garagePort: "0" }), /Garage port/);
  });

  it("keeps end-to-end checks on an isolated Compose project", () => {
    const source = readFileSync(join(repoRoot, "scripts/e2e-local.mjs"), "utf8");
    assert.equal(source.includes("infra:reset"), false);
    assert.equal(source.includes("infra:up"), false);
    assert.equal(source.includes("infra:down"), false);
    assert.match(source, /factrove-e2e/);
    assert.match(source, /requireChromium/);
    assert.match(source, /requireDocker/);
    assert.match(source, /restoreFileSnapshot/);
    assert.match(source, /localGarageEnv/);
    assert.match(source, /assertLoopbackHttpEndpoint/);
    const chromiumCheck = source.indexOf("requireChromium");
    const projectStart = source.indexOf("e2eProjectStarted = true");
    assert.ok(chromiumCheck > 0);
    assert.ok(projectStart > chromiumCheck);
  });

  it("restores a snapshotted file and leaves a missing snapshot untouched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-snapshot-"));
    try {
      const filePath = join(directory, "next-env.d.ts");
      writeFileSync(filePath, "original\n");
      const snapshot = snapshotFile(filePath);
      writeFileSync(filePath, "rewritten\n");
      restoreFileSnapshot(filePath, snapshot);
      assert.equal(readFileSync(filePath, "utf8"), "original\n");
      restoreFileSnapshot(filePath, snapshot);
      assert.equal(readFileSync(filePath, "utf8"), "original\n");

      const absent = join(directory, "absent.d.ts");
      restoreFileSnapshot(absent, null);
      assert.equal(snapshotFile(absent), null);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires confirmation before deleting the Postgres volume", async () => {
    assert.equal(resetDecision(["--yes"], false), "run");
    assert.equal(resetDecision([], true), "prompt");
    assert.equal(resetDecision([], false), "refuse");
    assert.equal(resetDecision(["--volumes"], false), "refuse");

    const child = spawn(process.execPath, [join(repoRoot, "scripts/infra.mjs"), "reset"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const [code] = await withTimeout(once(child, "close"), 5000, "infra reset refusal");
    assert.equal(code, 1);
    assert.match(stderr, /Refusing to delete the local PostgreSQL and object-storage volumes/);
    assert.match(stderr, /local S3 stand-in/);
    assert.match(stderr, /real AWS bucket/);
    assert.equal(stderr.includes("docker"), false);
  });

  it("licenses the workspace under AGPL-3.0-or-later and ships that text with the CLI", () => {
    const rootLicense = readFileSync(join(repoRoot, "LICENSE"), "utf8");
    assert.equal(readFileSync(join(repoRoot, "apps/cli/LICENSE"), "utf8"), rootLicense);
    assert.match(rootLicense, /GNU AFFERO GENERAL PUBLIC LICENSE/);
    assert.match(rootLicense, /Copyright \(C\) 2007 Free Software Foundation, Inc\./);
    assert.match(rootLicense, /Factrove - Share HTML artifacts with humans and reuse artifact context for future agents/);
    assert.match(rootLicense, /Copyright \(C\) 2026 Magnificode LTD/);
    assert.equal(existsSync(join(repoRoot, "NOTICE")), false);
    assert.equal(existsSync(join(repoRoot, "apps/cli/NOTICE")), false);
    const packages = [
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "apps/cli/package.json",
      "packages/api-client/package.json",
      "packages/contracts/package.json",
    ];
    for (const file of packages) {
      const manifest = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
      assert.equal(manifest.license, "AGPL-3.0-or-later", file);
    }
    const cli = JSON.parse(readFileSync(join(repoRoot, "apps/cli/package.json"), "utf8"));
    assert.equal(cli.files.includes("LICENSE"), true);
    assert.equal(cli.files.includes("NOTICE"), false);
    const compose = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
    assert.match(compose, /SOURCE_CODE_URL: \$\{SOURCE_CODE_URL:-https:\/\/github\.com\/magnificode-ltd\/factrove\}/);
    assert.match(compose, /DOCS_BASE_URL: \$\{DOCS_BASE_URL:-https:\/\/factrove\.mintlify\.app\}/);
    assert.match(compose, /POSTHOG_KEY: \$\{POSTHOG_KEY:-\}/);
    assert.match(compose, /POSTHOG_HOST: \$\{POSTHOG_HOST:-https:\/\/us\.i\.posthog\.com\}/);
    assert.match(compose, /TURNSTILE_SITE_KEY: \$\{TURNSTILE_SITE_KEY:-\}/);
    assert.match(compose, /TURNSTILE_SECRET_KEY: \$\{TURNSTILE_SECRET_KEY:-\}/);
    assert.equal(compose.includes("phc_"), false);
    const apiExample = readFileSync(join(repoRoot, "apps/api/.env.example"), "utf8");
    assert.match(apiExample, /^# SOURCE_CODE_URL=https:\/\/github\.com\/magnificode-ltd\/factrove$/m);
    assert.match(apiExample, /^# DOCS_BASE_URL=https:\/\/factrove\.mintlify\.app$/m);
    assert.match(apiExample, /^# POSTHOG_KEY=$/m);
    assert.match(apiExample, /^# POSTHOG_HOST=https:\/\/us\.i\.posthog\.com$/m);
    assert.match(apiExample, /^# TURNSTILE_SITE_KEY=$/m);
    assert.match(apiExample, /^# TURNSTILE_SECRET_KEY=$/m);
    for (const line of apiExample.split("\n")) {
      if (line.includes("phc_") && !line.trimStart().startsWith("#")) {
        assert.fail(`apps/api/.env.example sets a PostHog key: ${line}`);
      }
    }
    assert.equal(apiExample.includes("support@factrove.app"), false);
    assert.equal(apiExample.includes("https://factrove.app"), false);
  });

  it("keeps a from-source Compose stack and a published-image override", () => {
    const source = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
    const published = readFileSync(join(repoRoot, "docker-compose.published.yml"), "utf8");
    assert.match(source, /image: factrove-api:local/);
    assert.match(source, /image: factrove-web:local/);
    assert.match(source, /dockerfile: Dockerfile/);
    assert.match(source, /target: api/);
    assert.match(source, /target: web/);
    assert.match(source, /command: \["migrate"\]/);
    assert.match(
      published,
      /image: ghcr\.io\/magnificode-ltd\/factrove-api:\$\{FACTROVE_IMAGE_TAG:-latest\}/,
    );
    assert.match(
      published,
      /image: ghcr\.io\/magnificode-ltd\/factrove-web:\$\{FACTROVE_IMAGE_TAG:-latest\}/,
    );
    assert.equal(published.match(/build: !reset null/g)?.length, 3);
    assert.equal(published.includes("factrove.app"), false);
    assert.equal(published.includes("factrove-cloud"), false);
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    assert.match(
      readme,
      /docker compose --env-file \.env\.docker -f docker-compose\.yml -f docker-compose\.published\.yml up/,
    );
    assert.match(readme, /docker compose --env-file \.env\.docker -f docker-compose\.yml up --build/);
  });

  it("ships the shadcn/ui MIT notice with the web image and keeps the skill license", () => {
    const uiLicense = readFileSync(join(repoRoot, "apps/web/src/components/ui/LICENSE"), "utf8");
    const thirdParty = readFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
    assert.match(uiLicense, /Copyright \(c\) 2023 shadcn/);
    assert.match(uiLicense, /Permission is hereby granted/);
    assert.match(thirdParty, /Copyright \(c\) 2023 shadcn/);
    assert.match(thirdParty, /Permission is hereby granted/);
    assert.match(readFileSync(join(repoRoot, "README.md"), "utf8"), /THIRD_PARTY_NOTICES\.md/);
    assert.equal(readFileSync(join(repoRoot, "README.md"), "utf8").includes("[NOTICE](NOTICE)"), false);
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
    assert.match(dockerfile, /\/src\/LICENSE /);
    assert.equal(/\/src\/NOTICE\b/.test(dockerfile), false);
    assert.match(dockerfile, /\/src\/apps\/web\/src\/components\/ui\/LICENSE/);
    assert.match(dockerfile, /\/src\/THIRD_PARTY_NOTICES\.md/);
    const ignore = readFileSync(join(repoRoot, ".dockerignore"), "utf8");
    assert.equal(dockerignoreExcludes(ignore, "docs/self-host/deploy.mdx"), true);
    assert.equal(dockerignoreExcludes(ignore, "prd/README.md"), true);
    assert.equal(dockerignoreExcludes(ignore, "apps/web/test/ui.test.tsx"), true);
    assert.equal(dockerignoreExcludes(ignore, "LICENSE"), false);
    assert.equal(dockerignoreExcludes(ignore, "THIRD_PARTY_NOTICES.md"), false);
    assert.equal(dockerignoreExcludes(ignore, "apps/web/src/components/ui/LICENSE"), false);
    assert.equal(dockerignoreExcludes(ignore, ".agents/skills/frontend-design/LICENSE.txt"), false);
    for (const dir of [".agents/skills/frontend-design", ".claude/skills/frontend-design"]) {
      const license = readFileSync(join(repoRoot, dir, "LICENSE.txt"), "utf8");
      assert.match(license, /Apache License/);
      assert.match(license, /Version 2\.0, January 2004/);
      assert.match(readFileSync(join(repoRoot, dir, "SKILL.md"), "utf8"), /license: Complete terms in LICENSE\.txt/);
    }
  });

  it("copies only NEXT_PUBLIC_API_URL from the application env file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-public-url-"));
    const envFile = join(directory, "api.env");
    const secret = "postgresql://probe-secret-user:probe-secret-pass@db.internal/factrove";
    writeFileSync(
      envFile,
      `NEXT_PUBLIC_API_URL=https://api.probe-example.test\nDATABASE_URL=${secret}\nAWS_SECRET_ACCESS_KEY=probe-aws-secret\n`,
    );
    const env = { PATH: "/usr/bin" };
    applyNextPublicApiUrl(env, envFile);
    assert.equal(env.NEXT_PUBLIC_API_URL, "https://api.probe-example.test");
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    const kept = { NEXT_PUBLIC_API_URL: "http://127.0.0.1:3001" };
    applyNextPublicApiUrl(kept, envFile);
    assert.equal(kept.NEXT_PUBLIC_API_URL, "http://127.0.0.1:3001");
    const missing = {};
    applyNextPublicApiUrl(missing, join(directory, "absent.env"));
    assert.equal(missing.NEXT_PUBLIC_API_URL, undefined);
    await rm(directory, { recursive: true, force: true });
  });

  it("inlines NEXT_PUBLIC_API_URL from the application env file into the production bundle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-public-build-"));
    const envFile = join(directory, "api.env");
    const probe = "https://api.probe-example.test";
    writeFileSync(
      envFile,
      `NEXT_PUBLIC_API_URL=${probe}\nDATABASE_URL=postgresql://probe-secret-user:probe-secret-pass@db.internal/factrove\nAWS_SECRET_ACCESS_KEY=probe-aws-secret\nPOSTHOG_KEY=phc_fileprobekey\n`,
    );
    const env = { ...process.env };
    delete env.NEXT_PUBLIC_API_URL;
    delete env.POSTHOG_KEY;
    env.FACTROVE_APP_ENV_FILE = envFile;
    env.POSTHOG_KEY = "phc_processprobekey";
    const result = spawnSync(webDevBin, ["build"], { cwd: webAppDir, env, encoding: "utf8", timeout: 180000 });
    assert.equal(result.status, 0, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    const staticDir = join(webAppDir, ".next/static");
    const serverDir = join(webAppDir, ".next/server");
    assert.equal(treeContains(staticDir, "api.probe-example.test"), true);
    assert.equal(treeContains(staticDir, "probe-secret-pass"), false);
    assert.equal(treeContains(staticDir, "probe-aws-secret"), false);
    assert.equal(treeContains(staticDir, "phc_processprobekey"), false);
    assert.equal(treeContains(staticDir, "phc_fileprobekey"), false);
    assert.equal(treeContains(serverDir, "probe-secret-pass"), false);
    assert.equal(treeContains(serverDir, "probe-aws-secret"), false);
    assert.equal(treeContains(serverDir, "phc_processprobekey"), false);
    assert.equal(treeContains(serverDir, "phc_fileprobekey"), false);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("process supervision", () => {
  it("stops both child processes on SIGHUP", async () => {
    const run = await superviseFixture("hold");
    try {
      process.kill(run.child.pid, "SIGHUP");
      const [code, signal] = await withTimeout(run.exited, 8000, "SIGHUP shutdown");
      assert.equal(signal, null);
      assert.equal(code, 0);
      await waitGone(run.pids.api);
      await waitGone(run.pids.web);
    } finally {
      killProcess(run.child.pid);
      killProcess(run.pids.api);
      killProcess(run.pids.web);
    }
  });

  it("stops the other child when one exits on its own", async () => {
    const run = await superviseFixture("one-exits");
    try {
      const [code, signal] = await withTimeout(run.exited, 8000, "sibling shutdown");
      assert.equal(signal, null);
      assert.equal(code, 0);
      await waitGone(run.pids.api);
      await waitGone(run.pids.web);
    } finally {
      killProcess(run.child.pid);
      killProcess(run.pids.api);
      killProcess(run.pids.web);
    }
  });

  it("stops both child processes when the supervisor exits", async () => {
    const run = await superviseFixture("exit-now");
    try {
      const [code, signal] = await withTimeout(run.exited, 8000, "exit hook");
      assert.equal(signal, null);
      assert.equal(code, 3);
      await waitGone(run.pids.api);
      await waitGone(run.pids.web);
    } finally {
      killProcess(run.child.pid);
      killProcess(run.pids.api);
      killProcess(run.pids.web);
    }
  });
});

function treeContains(directory, needle) {
  const encoded = Buffer.from(needle);
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (readFileSync(path).includes(encoded)) {
        return true;
      }
    }
  }
  return false;
}

function superviseFixture(mode) {
  const child = spawn(process.execPath, [join(repoRoot, "scripts/supervise-fixture.mjs"), mode], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  return readSupervisorPids(child)
    .then((pids) => ({ child, pids, exited }))
    .catch((error) => {
      killProcess(child.pid);
      throw error;
    });
}

function readSupervisorPids(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`supervisor did not report both pids\n${buffer}\n${stderr}`));
    }, 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const api = /pid api (\d+)/.exec(buffer);
      const web = /pid web (\d+)/.exec(buffer);
      if (api && web && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ api: Number(api[1]), web: Number(web[1]) });
      }
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`supervisor exited (${signal ?? code}) before both pids\n${buffer}\n${stderr}`));
      }
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

function waitGone(pid) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (isGone(pid)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > 2000) {
        clearInterval(timer);
        reject(new Error(`process ${pid} is still running`));
      }
    }, 50);
  });
}

function isGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
}

function killProcess(pid) {
  if (!pid) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process has already exited.
    }
  }
}

function dockerignoreExcludes(text, filePath) {
  const normalized = filePath.replace(/^\/+/, "");
  let excluded = false;
  for (const rule of dockerignoreRules(text)) {
    const negate = rule.startsWith("!");
    const pattern = negate ? rule.slice(1) : rule;
    if (dockerignorePatternMatches(pattern, normalized)) {
      excluded = !negate;
    }
  }
  return excluded;
}

function dockerignoreRules(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

function dockerignorePatternMatches(pattern, filePath) {
  const body = pattern.replace(/^\//, "").replace(/\/$/, "");
  const regex = dockerignoreGlobToRegExp(body);
  if (regex.test(filePath)) {
    return true;
  }
  const parts = filePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    if (regex.test(parts.slice(0, index).join("/"))) {
      return true;
    }
  }
  return false;
}

function dockerignoreGlobToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      source += ".*";
      index += 1;
      continue;
    }
    const char = pattern[index];
    if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if ("\\^$+?.()|[]{}".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`${source}$`);
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
