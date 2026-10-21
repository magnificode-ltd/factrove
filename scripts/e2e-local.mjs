// Uses Compose project factrove-e2e, with its own volumes and host ports.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  apiEntry,
  apiEnvFile,
  assertLoopbackHttpEndpoint,
  e2eApiPort,
  e2eComposeArgs,
  e2eComposeBase,
  e2eGaragePort,
  e2eInfraEnv,
  e2ePostgresPort,
  e2eProjectName,
  e2eWebPort,
  infraFailureHint,
  localGarageEnv,
  readDotEnv,
  repoRoot,
  restoreFileSnapshot,
  snapshotFile,
  webAppDir,
  webDevBin,
  webLaunchEnv,
  workspaceBuildArgs,
} from "./local-runtime.mjs";

const webOrigin = `http://127.0.0.1:${e2eWebPort}`;
const apiOrigin = `http://127.0.0.1:${e2eApiPort}`;
const garageEndpoint = `http://127.0.0.1:${e2eGaragePort}`;
const databaseUrl = `postgresql://factrove:factrove@127.0.0.1:${e2ePostgresPort}/factrove`;
const fixturePath = join(repoRoot, "fixtures/hello.html");
const nextEnvPath = join(webAppDir, "next-env.d.ts");
const nextEnvSnapshot = snapshotFile(nextEnvPath);
const screenshotDir = process.env.FACTROVE_E2E_SCREENSHOTS?.trim() || null;
const children = [];
let browser;
let ownerContext;
let chromium;
let e2eProjectStarted = false;
let ownerKey = "";

const env = { ...process.env };
delete env.INIT_CWD;

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeBrowser();
  await stopChildren();
  restoreFileSnapshot(nextEnvPath, nextEnvSnapshot);
  if (e2eProjectStarted) {
    await removeE2eProject();
  }
}

async function main() {
  await requireDocker();
  await requireChromium();
  const apiEnv = apiChildEnv();
  assertLoopbackHttpEndpoint(apiEnv.S3_ENDPOINT);
  if (apiEnv.S3_ENDPOINT !== garageEndpoint) {
    throw new Error("The effective S3 endpoint must be an http loopback origin.");
  }

  await must("pnpm", workspaceBuildArgs);
  const fixture = readFileSync(fixturePath);

  e2eProjectStarted = true;
  await compose("reset");
  await compose("up");
  const migrated = await must("pnpm", ["db:migrate"], databaseChildEnv());
  if (!`${migrated.stdout}\n${migrated.stderr}`.includes("20261011120000_add_identity_and_artifact")) {
    throw new Error("The first migrate did not apply the committed migration.");
  }
  await must("pnpm", ["db:seed"], databaseChildEnv());
  await must("pnpm", ["db:seed"], databaseChildEnv());
  const again = await must("pnpm", ["db:migrate"], databaseChildEnv());
  if (!`${again.stdout}\n${again.stderr}`.includes("No pending migrations")) {
    throw new Error("A second migrate was not a no-op.");
  }
  await expectSql('select count(*) from "user"', "1");
  await expectSql('select count(*) from organization', "1");

  startApi(apiEnv);
  startWeb();
  await waitForJson(`${apiOrigin}/api/v1/health`, (body) => body.status === "ok");
  await waitForText(`${webOrigin}/`, "My artifacts");
  const anonymousContext = await fetch(`${apiOrigin}/api/v1/context`);
  if (anonymousContext.status !== 401) {
    throw new Error(`Anonymous context returned ${anonymousContext.status}.`);
  }
  const anonymousBody = await anonymousContext.json();
  if (anonymousBody.error?.code !== "UNAUTHENTICATED") {
    throw new Error(`Anonymous context returned ${JSON.stringify(anonymousBody)}.`);
  }

  browser = await chromium.launch({ headless: true });
  ownerContext = await browser.newContext();
  const owner = await signUpAndCreateKey();
  ownerKey = owner.secret;
  const configDir = await mkdtemp(join(tmpdir(), "factrove-e2e-"));
  await configureProfile(configDir, owner.secret);
  await addOwnerMembership();
  await expectItems("mine", []);
  await expectItems("org", []);

  const plain = await must("pnpm", ["factrove", "upload", "./fixtures/hello.html", "--profile", "e2e"], cliChildEnv(configDir));
  const plainId = artifactIdFromStdout(plain.stdout);
  if (plain.stdout.includes("Nest") || plain.stdout.includes("successfully started")) {
    throw new Error("Plain upload stdout included framework logs.");
  }
  if (plain.stdout.includes(owner.secret)) {
    throw new Error("Plain upload printed the API key.");
  }
  const plainViewer = `${webOrigin}/artifacts/${plainId}`;

  const jsonUpload = await must("pnpm", ["factrove", "upload", "./fixtures/hello.html", "--json", "--profile", "e2e"], cliChildEnv(configDir));
  const jsonArtifact = JSON.parse(jsonUpload.stdout).artifact;
  if (jsonArtifact.viewerUrl !== `${webOrigin}/artifacts/${jsonArtifact.id}`) {
    throw new Error(`JSON viewer URL did not use the web origin: ${jsonArtifact.viewerUrl}`);
  }
  if (jsonArtifact.accessType !== "private") {
    throw new Error(`JSON upload was ${jsonArtifact.accessType}`);
  }
  if (jsonArtifact.contentUrl.includes("access=") || jsonArtifact.contentUrl.includes("?")) {
    throw new Error("JSON upload included a content grant.");
  }
  if (jsonUpload.stdout.includes(owner.secret)) {
    throw new Error("JSON upload printed the API key.");
  }
  if (jsonArtifact.name !== "hello" || jsonArtifact.filename !== `${jsonArtifact.id}.html`) {
    throw new Error(`JSON upload name was ${jsonArtifact.name} and filename ${jsonArtifact.filename}.`);
  }

  const shared = await must(
    "pnpm",
    ["factrove", "upload", "./fixtures/hello.html", "--access", "org_shared", "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  const sharedId = artifactIdFromStdout(shared.stdout);
  const sharedViewer = `${webOrigin}/artifacts/${sharedId}`;

  const mine = await expectItems("mine", [plainId, jsonArtifact.id, sharedId]);
  const org = await expectItems("org", [sharedId]);
  for (const id of [plainId, jsonArtifact.id]) {
    if (org.some((item) => item.id === id)) {
      throw new Error(`Private artifact ${id} appeared in Organization artifacts.`);
    }
  }
  if (!mine.some((item) => item.id === sharedId && item.accessType === "org_shared")) {
    throw new Error("The org_shared upload was missing from My artifacts.");
  }
  for (const id of [plainId, jsonArtifact.id, sharedId]) {
    const item = mine.find((entry) => entry.id === id);
    if (item?.name !== "hello") {
      throw new Error(`Upload ${id} stored name ${item?.name}.`);
    }
  }

  await assertContent(plainId, fixture);
  await assertContent(sharedId, fixture);

  await checkLibrary(plainId, jsonArtifact.id, sharedId);
  await checkViewer(plainViewer, fixture);
  await checkViewer(sharedViewer, fixture);
  await checkSignedOutReturn(plainViewer, owner.email, owner.password);
  await expectOwnerOnly(plainId);
  await expectKeyHash(owner.secret);
  await checkPublicShare(plainId, fixture, configDir);
  await checkPasswordShare(jsonArtifact.id, fixture, configDir);

  const missing = await run("pnpm", ["factrove", "upload", "./fixtures/missing.html", "--json", "--profile", "e2e"], cliChildEnv(configDir));
  if (missing.code === 0 || !missing.stderr.includes("FILE_NOT_FOUND")) {
    throw new Error(`Missing file did not fail usefully.\n${missing.stderr}`);
  }
  const unsupported = await run("pnpm", ["factrove", "upload", "./README.md", "--json", "--profile", "e2e"], cliChildEnv(configDir));
  if (unsupported.code === 0 || !unsupported.stderr.includes("INVALID_INPUT")) {
    throw new Error(`Non-HTML upload did not fail usefully.\n${unsupported.stderr}`);
  }
  const unknown = await fetch(`${apiOrigin}/api/v1/artifacts/00000000-0000-4000-8000-000000000000`);
  if (unknown.status !== 404) {
    throw new Error(`Unknown artifact returned ${unknown.status}.`);
  }
  const unknownBody = await unknown.json();
  if (unknownBody.error?.code !== "ARTIFACT_NOT_FOUND") {
    throw new Error(`Unknown artifact returned ${JSON.stringify(unknownBody)}.`);
  }

  await stopChildren();
  await waitUntilDown(apiOrigin);
  const webOnly = startWeb();
  await waitForText(`${webOrigin}/`, "The Factrove API is unavailable. Start the backend and refresh.");
  await stopChild(webOnly);

  await compose("down");
  await compose("up");
  const restartedApi = startApi(apiEnv);
  startWeb();
  await waitForJson(`${apiOrigin}/api/v1/health`, (body) => body.status === "ok");
  await expectItems("mine", [plainId, jsonArtifact.id, sharedId]);
  await expectItems("org", [sharedId]);
  await assertContent(plainId, fixture);
  await assertContent(sharedId, fixture);
  await checkNamedArtifact(configDir);
  await expectSql('select count(*) from "user"', "3");
  await revokeKey();
  const revokedUpload = await run(
    "pnpm",
    ["factrove", "upload", "./fixtures/hello.html", "--profile", "e2e", "--json"],
    cliChildEnv(configDir),
  );
  if (revokedUpload.code === 0 || !revokedUpload.stderr.includes("UNAUTHENTICATED")) {
    throw new Error(`Revoked key upload did not fail.\n${revokedUpload.stderr}`);
  }
  if (`${revokedUpload.stdout}\n${revokedUpload.stderr}`.includes(owner.secret)) {
    throw new Error("Revoked key upload printed the API key.");
  }
  await stopChild(restartedApi);
  await stopChildren();

  const s3Env = integrationChildEnv();
  assertLoopbackHttpEndpoint(s3Env.S3_ENDPOINT);
  const s3 = await must(
    "pnpm",
    ["--filter", "@factrove/api", "exec", "vitest", "run", "test/storage.integration.test.ts", "test/content.s3.integration.test.ts"],
    s3Env,
  );
  const s3Report = `${s3.stdout}\n${s3.stderr}`;
  if (!/Tests\s+4 passed/.test(s3Report)) {
    throw new Error(`S3 integration tests did not report 4 passes.\n${s3Report}`);
  }
  process.stdout.write("Local end-to-end checks passed. macOS was not run.\n");
}

function databaseChildEnv() {
  const child = localGarageEnv(env, { garagePort: e2eGaragePort });
  delete child.INIT_CWD;
  delete child.S3_INTEGRATION;
  child.DATABASE_URL = databaseUrl;
  child.BASE_URL = apiOrigin;
  child.FACTROVE_GARAGE_PORT = e2eGaragePort;
  return child;
}

function apiChildEnv() {
  const child = databaseChildEnv();
  child.HOST = "127.0.0.1";
  child.PORT = e2eApiPort;
  child.WEB_ORIGIN = webOrigin;
  child.API_PUBLIC_ORIGIN = apiOrigin;
  child.PUBLIC_BASE_URL = webOrigin;
  child.BETTER_AUTH_SECRET = "local-only-factrove-auth-secret-change-me";
  return child;
}

function cliChildEnv(configDir) {
  const child = { ...env, FACTROVE_API_URL: apiOrigin, FACTROVE_PROFILE: "e2e" };
  delete child.FACTROVE_API_KEY;
  delete child.FACTROVE_DEV_API_URL;
  child.FACTROVE_CLI_ENV_FILE = join(tmpdir(), "factrove-e2e-cli-env-absent");
  if (configDir) {
    child.FACTROVE_CONFIG_DIR = configDir;
  }
  return child;
}

function webChildEnv() {
  const child = webLaunchEnv(env, readDotEnv(apiEnvFile));
  child.NEXT_PUBLIC_API_URL = apiOrigin;
  delete child.INIT_CWD;
  return child;
}

function integrationChildEnv() {
  const child = apiChildEnv();
  child.S3_INTEGRATION = "1";
  return child;
}

function artifactIdFromStdout(stdout) {
  const id = stdout.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || stdout !== `${id}\n`) {
    throw new Error(`Plain upload did not print only the artifact id.\n${stdout}`);
  }
  return id;
}

async function requireDocker() {
  const info = await run("docker", ["info"]);
  if (info.code !== 0) {
    throw new Error("The container runtime is not running. Start Docker, then run pnpm e2e again.");
  }
}

async function requireChromium() {
  const playwright = await import(pathToFileURL(join(repoRoot, "apps/web/node_modules/playwright/index.mjs")).href);
  chromium = playwright.chromium;
  if (!chromium) {
    throw new Error("Playwright did not export chromium.");
  }
  if (!existsSync(chromium.executablePath())) {
    throw new Error(
      "Playwright Chromium is not installed. From the repository root, run: pnpm --filter @factrove/web exec playwright install chromium",
    );
  }
}

function startApi(childEnv) {
  return startLogged(process.execPath, [apiEntry], repoRoot, childEnv);
}

function startWeb() {
  return startLogged(webDevBin, ["dev", "--hostname", "127.0.0.1", "--port", e2eWebPort], webAppDir, webChildEnv());
}

async function compose(action) {
  const result = await run("docker", e2eComposeArgs(action), e2eInfraEnv(env));
  if (result.code !== 0) {
    const hint = infraFailureHint(result.stderr);
    throw new Error(`docker ${e2eComposeArgs(action).join(" ")} failed (${result.code}).\n${result.stdout}\n${result.stderr}\n${hint}`);
  }
  return result;
}

async function removeE2eProject() {
  const result = await run("docker", e2eComposeArgs("reset"), e2eInfraEnv(env));
  if (result.code !== 0) {
    process.stderr.write(`Could not remove the ${e2eProjectName} Compose project.\n${result.stderr}\n`);
  }
}

function startLogged(command, args, cwd, childEnv) {
  const child = spawn(command, args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  child.output = "";
  const append = (chunk) => {
    child.output = `${child.output}${chunk}`.slice(-12000);
    process.stderr.write(chunk);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code, signal) => {
    if (!child.expectedStop && process.exitCode === undefined) {
      process.stderr.write(`\nProcess exited early (${signal ?? code}).\n${child.output}\n`);
    }
  });
  children.push(child);
  return child;
}

async function stopChildren() {
  const running = children.filter((child) => child.exitCode === null && child.signalCode === null);
  await Promise.all(running.map((child) => stopChild(child)));
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.expectedStop = true;
  child.kill("SIGTERM");
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), 8000);
  });
  const result = await Promise.race([once(child, "exit").then(() => "exit"), timeout]);
  clearTimeout(timer);
  if (result === "timeout") {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
}

function run(command, args, childEnv = env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

async function must(command, args, childEnv) {
  const result = await run(command, args, childEnv);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.code}).\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

async function expectSql(sql, expected) {
  const result = await must("docker", [
    ...e2eComposeBase(),
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "factrove",
    "-d",
    "factrove",
    "-tAc",
    sql,
  ], e2eInfraEnv(env));
  if (result.stdout.trim() !== expected) {
    throw new Error(`SQL ${sql} returned ${result.stdout.trim()}, expected ${expected}.`);
  }
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { ...headers, authorization: `Bearer ${ownerKey}` } });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function expectItems(view, ids) {
  const body = await getJson(`${apiOrigin}/api/v1/artifacts?view=${view}`);
  const items = body.items ?? [];
  for (const item of items) {
    if (String(item.contentUrl ?? "").includes("access=")) {
      throw new Error("List content URL included a content grant.");
    }
  }
  const actual = items.map((item) => item.id).sort();
  const expected = [...ids].sort();
  if (actual.join(",") !== expected.join(",")) {
    throw new Error(`${view} list was ${actual.join(",")} and expected ${expected.join(",")}.`);
  }
  return items;
}

async function assertContent(id, fixture) {
  const response = await fetch(`${apiOrigin}/api/v1/artifacts/${id}/content`, {
    headers: { authorization: `Bearer ${ownerKey}` },
  });
  if (response.status !== 200) {
    throw new Error(`Content for ${id} returned ${response.status}.`);
  }
  const csp = response.headers.get("content-security-policy") ?? "";
  if (!csp.includes("sandbox allow-scripts") || csp.includes("allow-same-origin") || !csp.includes("connect-src 'none'")) {
    throw new Error(`Content CSP was ${csp}`);
  }
  if (!csp.includes(`frame-ancestors ${webOrigin}`)) {
    throw new Error(`Content CSP frame-ancestors was ${csp}`);
  }
  for (const [name, value] of [
    ["content-type", "text/html; charset=utf-8"],
    ["cache-control", "no-store"],
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "no-referrer"],
  ]) {
    if (response.headers.get(name) !== value) {
      throw new Error(`${name} was ${response.headers.get(name)}`);
    }
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.equals(fixture)) {
    throw new Error(`Content bytes for ${id} did not match the fixture.`);
  }
}

async function signUpAndCreateKey() {
  const email = "e2e-owner@example.invalid";
  const password = "e2e-owner-password";
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(`${webOrigin}/signup`);
    await page.getByLabel("Name").fill("E2E Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(`${webOrigin}/`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("link", { name: "Sign in" }).waitFor();
    await page.goto(`${webOrigin}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${webOrigin}/`);
    await page.goto(`${webOrigin}/account/api-keys`);
    await page.getByLabel("Key name").fill("e2e");
    await page.getByRole("button", { name: "Create API key" }).click();
    const secret = (await page.getByTestId("api-key-secret").innerText()).trim();
    if (!secret.startsWith("ftrv_") || secret.length < 20) {
      throw new Error("The created API key did not have the expected shape.");
    }
    await page.reload();
    if ((await page.getByTestId("api-key-secret").count()) !== 0) {
      throw new Error("The API key was still shown after reload.");
    }
    if ((await page.content()).includes(secret)) {
      throw new Error("The API key remained on the page after reload.");
    }
    return { secret, email, password };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Browser sign-up or API key creation failed. ${detail}`);
  } finally {
    await page.close();
  }
}

async function configureProfile(configDir, secret) {
  const result = await runInput(
    "pnpm",
    ["factrove", "configure", "--profile", "e2e"],
    `${secret}\n${apiOrigin}\n`,
    cliChildEnv(configDir),
  );
  if (result.code !== 0) {
    throw new Error(`configure failed (${result.code}).\n${result.stderr}`);
  }
  if (result.stdout.includes(secret) || result.stderr.includes(secret)) {
    throw new Error("configure printed the API key.");
  }
  if (!result.stdout.includes('Configured profile "e2e"')) {
    throw new Error(`configure stdout was ${result.stdout}`);
  }
}

async function addOwnerMembership() {
  const context = await getJson(`${apiOrigin}/api/v1/context`);
  const userId = context.user?.id;
  if (context.user?.name !== "E2E Owner" || typeof userId !== "string" || !/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new Error("The signed-in context did not match the new account.");
  }
  await must(
    "docker",
    [
      ...e2eComposeBase(),
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "factrove",
      "-d",
      "factrove",
      "-c",
      `insert into member (id, "organizationId", "userId", role, "createdAt") values ('e2e-owner-member', 'local-org', '${userId}', 'member', now())`,
    ],
    e2eInfraEnv(env),
  );
}

async function expectOwnerOnly(artifactId) {
  const anonymous = await fetch(`${apiOrigin}/api/v1/artifacts/${artifactId}`);
  const anonymousContent = await fetch(`${apiOrigin}/api/v1/artifacts/${artifactId}/content`);
  if (anonymous.status !== 404 || anonymousContent.status !== 404) {
    throw new Error(`Anonymous artifact access returned ${anonymous.status}/${anonymousContent.status}.`);
  }
  const otherKey = await signUpApiUser("e2e-other@example.invalid", "E2E Other");
  const denied = await fetch(`${apiOrigin}/api/v1/artifacts/${artifactId}`, {
    headers: { authorization: `Bearer ${otherKey}` },
  });
  const unknown = await fetch(`${apiOrigin}/api/v1/artifacts/00000000-0000-4000-8000-000000000000`, {
    headers: { authorization: `Bearer ${otherKey}` },
  });
  if (denied.status !== 404 || unknown.status !== 404) {
    throw new Error(`Another account's read returned ${denied.status}.`);
  }
  const deniedBody = await denied.json();
  const unknownBody = await unknown.json();
  if (JSON.stringify(deniedBody) !== JSON.stringify(unknownBody)) {
    throw new Error("A hidden artifact did not use the unknown-id response.");
  }
}

async function signUpApiUser(email, name) {
  const response = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: webOrigin },
    body: JSON.stringify({ email, password: "e2e-other-password", name }),
  });
  if (!response.ok) {
    throw new Error(`Second sign-up returned ${response.status}.`);
  }
  const created = await fetch(`${apiOrigin}/api/auth/api-key/create`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(response),
      origin: webOrigin,
    },
    body: JSON.stringify({ name: "other" }),
  });
  if (!created.ok) {
    throw new Error(`Second API key returned ${created.status}.`);
  }
  const body = await created.json();
  if (typeof body.key !== "string") {
    throw new Error("Second API key response did not include a key.");
  }
  return body.key;
}

function cookieHeader(response) {
  const pairs = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const parts = pairs.map((value) => value.split(";", 1)[0]).filter(Boolean);
  if (parts.length > 0) {
    return parts.join("; ");
  }
  const single = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!single) {
    throw new Error("Sign-up did not set a session cookie.");
  }
  return single;
}

async function expectKeyHash(secret) {
  const hash = createHash("sha256").update(secret).digest("base64url");
  if (!/^[A-Za-z0-9_-]+$/.test(hash) || hash === secret) {
    throw new Error("API key hash did not have the expected shape.");
  }
  const result = await must(
    "docker",
    [
      ...e2eComposeBase(),
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "factrove",
      "-d",
      "factrove",
      "-tAc",
      `select "key" from apikey where "key" = '${hash}'`,
    ],
    e2eInfraEnv(env),
  );
  if (result.stdout.trim() !== hash) {
    throw new Error("The stored API key was not the SHA-256 hash.");
  }
}

async function revokeKey() {
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(`${webOrigin}/account/api-keys`);
    await page.getByRole("button", { name: "Revoke" }).click();
    await page.getByText("No active API keys.").waitFor();
  } finally {
    await page.close();
  }
}

function runInput(command, args, input, childEnv = env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdin.end(input);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

async function checkNamedArtifact(configDir) {
  const named = await must(
    "pnpm",
    ["factrove", "upload", "./fixtures/hello.html", "--name", "X launch calendar", "--json", "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  const artifact = JSON.parse(named.stdout).artifact;
  if (artifact.name !== "X launch calendar" || artifact.filename !== `${artifact.id}.html`) {
    throw new Error(`Named upload stored ${artifact.name} / ${artifact.filename}.`);
  }
  const replaced = await must(
    "pnpm",
    ["factrove", "upload", "./fixtures/hello.html", "--artifactId", artifact.id, "--json", "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  const after = JSON.parse(replaced.stdout).artifact;
  if (after.id !== artifact.id || after.name !== "X launch calendar") {
    throw new Error(`Replace dropped the name: ${after.name}.`);
  }
  const rejected = await run(
    "pnpm",
    ["factrove", "upload", "./fixtures/hello.html", "--name", "n".repeat(121), "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  if (rejected.code === 0 || !rejected.stderr.includes("name must be one line of 1 to 120 characters.")) {
    throw new Error(`Over-long name was not rejected.\n${rejected.stderr}`);
  }

  const page = await ownerContext.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  const shotDir = process.env.FACTROVE_E2E_SCREENSHOT_DIR;
  try {
    await page.goto(`${webOrigin}/`);
    await renderedLibrary(page);
    await page.getByRole("link", { name: "Refresh" }).click();
    await page.waitForURL(`${webOrigin}/`);
    const link = page.locator(`a[href="/artifacts/${artifact.id}"]`);
    await link.waitFor();
    const label = (await link.innerText()).trim();
    if (label !== "X launch calendar") {
      throw new Error(`Library label was ${label}.`);
    }
    const cardText = await link.locator("xpath=ancestor::li").innerText();
    if (!cardText.includes(artifact.id)) {
      throw new Error("Library card hid the artifact id.");
    }
    if (shotDir) {
      await page.screenshot({ path: join(shotDir, "library_named_artifact.png"), fullPage: true });
    }
    await link.click();
    await page.waitForURL(`${webOrigin}/artifacts/${artifact.id}`);
    await page.locator("h1", { hasText: "X launch calendar" }).waitFor();
    const header = await page.locator("header").innerText();
    if (!header.includes("Back to library") || !header.includes(artifact.id)) {
      throw new Error(`Viewer header was ${header}.`);
    }
    if (shotDir) {
      await page.screenshot({ path: join(shotDir, "viewer_named_header.png"), fullPage: true });
    }
  } finally {
    await page.close();
  }

  const shared = await must("pnpm", ["factrove", "share", artifact.id, "--profile", "e2e"], cliChildEnv(configDir));
  const shareUrl = printedShareUrl(shared.stdout);
  const anonymous = await browser.newContext();
  const publicPage = await anonymous.newPage();
  publicPage.setDefaultTimeout(30000);
  publicPage.setDefaultNavigationTimeout(60000);
  try {
    await publicPage.goto(shareUrl);
    await publicPage.locator("h1", { hasText: "X launch calendar" }).waitFor();
    const publicHeader = await publicPage.locator("header").innerText();
    if (publicHeader.includes("Back to library")) {
      throw new Error("The public share header linked back to the library.");
    }
  } finally {
    await publicPage.close();
    await anonymous.close();
  }
}

async function checkLibrary(plainId, jsonId, sharedId) {
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(`${webOrigin}/`);
    await renderedLibrary(page);
    await page.getByRole("link", { name: "Refresh" }).click();
    await page.waitForURL(`${webOrigin}/`);
    const mineHtml = await page.content();
    for (const id of [plainId, jsonId, sharedId]) {
      if (!mineHtml.includes(`/artifacts/${id}`)) {
        throw new Error(`My artifacts did not list ${id} after refresh.`);
      }
    }
    if (mineHtml.includes("Inline JavaScript ran successfully.")) {
      throw new Error("Uploaded HTML was injected into the library page.");
    }
    await page.locator(`a[href="/artifacts/${plainId}"]`).click();
    await page.waitForURL(`${webOrigin}/artifacts/${plainId}`);
    await page.goBack();

    await page.goto(`${webOrigin}/?view=org`);
    await renderedLibrary(page);
    await page.getByRole("link", { name: "Refresh" }).click();
    await page.waitForURL(`${webOrigin}/?view=org`);
    const orgHtml = await page.content();
    if (!orgHtml.includes(`/artifacts/${sharedId}`)) {
      throw new Error("Organization artifacts did not list the org_shared upload after refresh.");
    }
    if (orgHtml.includes(`/artifacts/${plainId}`) || orgHtml.includes(`/artifacts/${jsonId}`)) {
      throw new Error("Organization artifacts listed a private upload.");
    }
    await page.locator(`a[href="/artifacts/${sharedId}"]`).click();
    await page.waitForURL(`${webOrigin}/artifacts/${sharedId}`);
  } finally {
    await page.close();
  }
}

// The loading skeleton has its own Refresh link to "/". Wait for the list so the click uses the current view.
async function renderedLibrary(page) {
  await page.locator('[aria-label="Artifact lists"] a[aria-current="page"]').waitFor();
}

async function checkSignedOutReturn(viewer, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  const artifactPath = new URL(viewer).pathname;
  try {
    await page.goto(viewer);
    const loggedOut = await page.content();
    if (loggedOut.includes("Artifact not found")) {
      throw new Error("A logged-out viewer treated an existing artifact as missing.");
    }
    const signIn = page.getByRole("link", { name: "Sign in" });
    await signIn.waitFor();
    const href = await signIn.getAttribute("href");
    const next = new URL(href ?? "", webOrigin).searchParams.get("next");
    if (next !== artifactPath) {
      throw new Error(`Sign-in link returned to ${next}.`);
    }
    await signIn.click();
    await page.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("next") === artifactPath);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(viewer);
    await page.locator("iframe").waitFor({ timeout: 20000 });
    if ((await page.content()).includes("Artifact not found")) {
      throw new Error("Login did not return to the requested artifact.");
    }
  } finally {
    await page.close();
    await context.close();
  }
}

async function checkViewer(viewer, fixture) {
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(viewer);
    await assertIsolatedFrame(page, fixture);
  } finally {
    await page.close();
  }
}

function shareLinkPattern(id) {
  return new RegExp(`^http://127\\.0\\.0\\.1:${e2eWebPort}/share/${id}/[A-Za-z0-9_-]{43}$`);
}

async function checkPublicShare(plainId, fixture, configDir) {
  const malformed = await fetch(`${webOrigin}/share/not-an-id/short`);
  await malformed.arrayBuffer();
  if (malformed.status !== 404) {
    throw new Error(`A malformed share URL returned ${malformed.status}.`);
  }

  const guessed = await fetch(`${apiOrigin}/api/v1/public/artifacts/${plainId}/${"a".repeat(43)}`);
  const guessedBody = await guessed.json();
  if (guessed.status !== 404 || guessedBody.error?.code !== "ARTIFACT_NOT_FOUND") {
    throw new Error(`An unshared artifact returned ${guessed.status} ${JSON.stringify(guessedBody)}.`);
  }

  const shared = await must("pnpm", ["factrove", "share", plainId, "--profile", "e2e"], cliChildEnv(configDir));
  const shareUrl = printedShareUrl(shared.stdout);
  if (!shareLinkPattern(plainId).test(shareUrl) || !shared.stdout.includes("This link is not password protected.")) {
    throw new Error(`Share did not print a public link on the configured base URL.\n${shared.stdout}`);
  }
  if (shareUrl.startsWith("http://localhost:3000/") || shared.stdout.includes(ownerKey)) {
    throw new Error("Share printed a hard-coded origin or the API key.");
  }
  const token = shareUrl.slice(shareUrl.lastIndexOf("/") + 1);

  const jsonShare = await must(
    "pnpm",
    ["factrove", "share", plainId, "--json", "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  const envelope = JSON.parse(jsonShare.stdout);
  if (envelope.share?.shareUrl !== shareUrl || jsonShare.stdout.includes(ownerKey)) {
    throw new Error(`JSON share did not repeat the same public link.\n${jsonShare.stdout}`);
  }

  const anonymous = await browser.newContext();
  const publicPage = await anonymous.newPage();
  publicPage.setDefaultTimeout(30000);
  publicPage.setDefaultNavigationTimeout(60000);
  try {
    const detailRequest = publicPage.waitForRequest(
      (request) => request.method() === "GET" && request.url() === `${apiOrigin}/api/v1/public/artifacts/${plainId}/${token}`,
    );
    const documentResponse = await publicPage.goto(shareUrl);
    const documentHeaders = documentResponse?.headers() ?? {};
    if (documentHeaders["referrer-policy"] !== "no-referrer" || documentHeaders["x-robots-tag"] !== "noindex") {
      throw new Error("The public page did not send no-referrer and noindex.");
    }
    const detail = await detailRequest;
    if (detail.headers().cookie) {
      throw new Error("The public page attached a cookie to the artifact request.");
    }
    await assertIsolatedFrame(publicPage, fixture);
    const visible = await publicPage.locator("body").innerText();
    if (visible.includes(token)) {
      throw new Error("The public page text included the share token.");
    }
  } finally {
    await publicPage.close();
    await anonymous.close();
  }

  const content = await fetch(`${apiOrigin}/api/v1/public/artifacts/${plainId}/${token}/content`);
  if (content.status !== 200) {
    throw new Error(`Public content returned ${content.status}.`);
  }
  const csp = content.headers.get("content-security-policy") ?? "";
  if (!csp.includes("sandbox allow-scripts") || csp.includes("allow-same-origin") || !csp.includes(`frame-ancestors ${webOrigin}`)) {
    throw new Error(`Public content CSP was ${csp}`);
  }

  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: webOrigin });
  const ownerPage = await ownerContext.newPage();
  ownerPage.setDefaultTimeout(30000);
  ownerPage.setDefaultNavigationTimeout(60000);
  try {
    await ownerPage.goto(`${webOrigin}/artifacts/${plainId}`);
    const region = await openOwnerSharePanel(ownerPage);
    const shown = (await ownerPage.getByTestId("share-url").innerText()).trim();
    if (shown !== shareUrl) {
      throw new Error(`Viewer share link was ${shown}`);
    }
    await region.getByRole("button", { name: "Copy link" }).click();
    await ownerPage.getByRole("button", { name: "Copied" }).first().waitFor();
    const copied = await ownerPage.evaluate(() => navigator.clipboard.readText());
    if (copied !== shareUrl) {
      throw new Error(`Copied link was ${copied}`);
    }
  } finally {
    await ownerPage.close();
  }

  const revoked = await must(
    "pnpm",
    ["factrove", "share", plainId, "--revoke", "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  if (revoked.stdout.trim() !== `Revoked the public link for ${plainId}.` || revoked.stdout.includes(token)) {
    throw new Error(`Revoke output was ${JSON.stringify(revoked.stdout)}`);
  }
  await expectPublicMissing(shareUrl, token);

  const rotated = await must("pnpm", ["factrove", "share", plainId, "--profile", "e2e"], cliChildEnv(configDir));
  const nextUrl = printedShareUrl(rotated.stdout);
  if (!shareLinkPattern(plainId).test(nextUrl) || nextUrl === shareUrl) {
    throw new Error(`A new share did not replace the revoked link.\n${rotated.stdout}`);
  }
  const oldStillDead = await fetch(`${apiOrigin}/api/v1/public/artifacts/${plainId}/${token}`);
  if (oldStillDead.status !== 404) {
    throw new Error(`The revoked link returned ${oldStillDead.status}.`);
  }
  const nextToken = nextUrl.slice(nextUrl.lastIndexOf("/") + 1);
  const fresh = await fetch(`${apiOrigin}/api/v1/public/artifacts/${plainId}/${nextToken}`);
  if (fresh.status !== 200) {
    throw new Error(`The replacement public link returned ${fresh.status}.`);
  }

  const stopPage = await ownerContext.newPage();
  stopPage.setDefaultTimeout(30000);
  stopPage.setDefaultNavigationTimeout(60000);
  try {
    await stopPage.goto(`${webOrigin}/artifacts/${plainId}`);
    await openOwnerSharePanel(stopPage);
    await stopPage.getByRole("button", { name: "Stop sharing" }).click();
    await stopPage.getByRole("button", { name: "Share" }).waitFor();
  } finally {
    await stopPage.close();
  }
  await expectPublicMissing(nextUrl, nextToken);
}

async function checkPasswordShare(id, fixture, configDir) {
  const firstPassword = "first secret pass";
  const secondPassword = "second secret pass";
  const inline = await run(
    "pnpm",
    ["factrove", "share", id, `--password=${firstPassword}`, "--json", "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  const inlineError = inline.stderr.trim().split("\n").at(-1) ?? "";
  if (inline.code === 0 || inlineError.includes(firstPassword) || JSON.parse(inlineError).error?.code !== "INVALID_INPUT") {
    throw new Error(`An inline --password value was not refused.\n${inline.stderr}`);
  }
  const protectedShare = await runInput(
    "pnpm",
    ["factrove", "share", id, "--password-stdin", "--profile", "e2e"],
    `${firstPassword}\n`,
    cliChildEnv(configDir),
  );
  const shareUrl = printedShareUrl(protectedShare.stdout);
  if (
    protectedShare.code !== 0
    || !shareLinkPattern(id).test(shareUrl)
    || !protectedShare.stdout.includes("This link is password protected.")
    || !protectedShare.stdout.includes("revoke, then share again")
  ) {
    throw new Error(`share --password-stdin failed.\n${protectedShare.stdout}\n${protectedShare.stderr}`);
  }
  if (`${protectedShare.stdout}${protectedShare.stderr}`.includes(firstPassword)) {
    throw new Error("share --password-stdin printed the password.");
  }
  const token = shareUrl.slice(shareUrl.lastIndexOf("/") + 1);
  const detailUrl = `${apiOrigin}/api/v1/public/artifacts/${id}/${token}`;
  await expectSql(
    `select share_password_hash like '$argon2id$v=19$m=19456,t=2,p=1$%' and position('${firstPassword}' in share_password_hash) = 0 from artifact where id = '${id}'`,
    "t",
  );

  const lockedDetail = await fetch(detailUrl);
  const lockedBody = await lockedDetail.json();
  if (lockedDetail.status !== 401 || lockedBody.error?.code !== "PASSWORD_REQUIRED" || "artifact" in lockedBody) {
    throw new Error(`A protected link without a grant returned ${lockedDetail.status} ${JSON.stringify(lockedBody)}.`);
  }
  const lockedContent = await fetch(`${detailUrl}/content`);
  const lockedContentBody = await lockedContent.text();
  if (lockedContent.status !== 401 || lockedContentBody.includes("Inline JavaScript")) {
    throw new Error(`Protected content without a ticket returned ${lockedContent.status}.`);
  }

  const visitor = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await visitor.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  let grant = "";
  try {
    const lockedRequest = page.waitForRequest((request) => request.method() === "GET" && request.url() === detailUrl);
    await page.goto(shareUrl);
    const lockedResponse = await (await lockedRequest).response();
    if (lockedResponse?.status() !== 401) {
      throw new Error(`The locked page detail request returned ${lockedResponse?.status()}.`);
    }
    await page.getByRole("heading", { name: "This artifact is locked" }).waitFor();
    if ((await page.locator("iframe").count()) !== 0 || (await page.content()).includes("Inline JavaScript")) {
      throw new Error("The locked page rendered artifact content.");
    }
    if ((await page.getByText("This artifact does not exist.").count()) !== 0) {
      throw new Error("The locked page showed the missing notice.");
    }
    await waitForRestingPaint(page);
    await screenshot(page, "visitor-password-page");

    const field = page.getByLabel("Password", { exact: true });
    await field.fill("not the password");
    const wrongRequest = page.waitForRequest((request) => request.url() === `${detailUrl}/unlock`);
    await page.getByRole("button", { name: "Unlock" }).click();
    const wrong = await wrongRequest;
    if (wrong.headers().cookie || wrong.url().includes("not")) {
      throw new Error("The unlock request carried a cookie or put the password in the URL.");
    }
    await page.getByRole("alert").filter({ hasText: "That password didn't work" }).waitFor();
    if ((await field.getAttribute("aria-invalid")) !== "true" || (await page.locator("iframe").count()) !== 0) {
      throw new Error("A wrong password did not flag the field or revealed the artifact.");
    }
    await waitForRestingPaint(page);
    await screenshot(page, "visitor-wrong-password");

    await field.fill(firstPassword);
    const grantedRequest = page.waitForRequest(
      (request) => request.method() === "GET" && request.url() === detailUrl && Boolean(request.headers()["x-factrove-share-grant"]),
    );
    await page.getByRole("button", { name: "Unlock" }).click();
    const granted = await grantedRequest;
    if (granted.headers().cookie) {
      throw new Error("The granted detail request attached a cookie.");
    }
    await assertIsolatedFrame(page, fixture);
    grant = await page.evaluate((artifactId) => {
      const stored = JSON.parse(sessionStorage.getItem(`factrove:share-grant:${artifactId}`) ?? "{}");
      return stored.grant ?? "";
    }, id);
    if (!/^g1\./.test(grant) || (await visitor.cookies()).length !== 0) {
      throw new Error("The unlock did not store a grant in sessionStorage.");
    }
    if (granted.headers()["x-factrove-share-grant"] !== grant) {
      throw new Error("The detail request did not send the stored grant.");
    }
    const src = (await page.locator("iframe").getAttribute("src")) ?? "";
    if (!src.startsWith(`${detailUrl}/content?ticket=t1.`) || src.includes(grant)) {
      throw new Error(`The iframe src was ${src}`);
    }
    const inside = await page.frameLocator("iframe").locator("body").evaluate(() => {
      let storage = "blocked";
      try {
        void window.sessionStorage.length;
        storage = "readable";
      } catch {
        storage = "blocked";
      }
      return { href: window.location.href, referrer: document.referrer, storage, cookie: (() => {
        try {
          return document.cookie;
        } catch {
          return "";
        }
      })() };
    });
    if (inside.href.includes(grant) || inside.referrer || inside.storage !== "blocked" || inside.cookie) {
      throw new Error(`The artifact iframe could see the grant: ${JSON.stringify(inside)}`);
    }
    // The page spent at least two uses (preflight and frame load), so a third outside fetch is the last allowed.
    const lastUse = await fetch(src);
    await lastUse.arrayBuffer();
    const exhausted = await fetch(src);
    await exhausted.arrayBuffer();
    if (exhausted.status !== 401) {
      throw new Error(`A content ticket was honored past its use limit (${exhausted.status}).`);
    }
    await page.getByText("Unlocked with password").waitFor();
    await waitForRestingPaint(page);
    await screenshot(page, "visitor-unlocked-view");

    await page.reload();
    await page.locator("iframe").waitFor({ timeout: 20000 });
    if ((await page.getByLabel("Password", { exact: true }).count()) !== 0) {
      throw new Error("A reload in the same tab asked for the password again.");
    }

    const other = await visitor.newPage();
    try {
      await other.goto(shareUrl);
      await other.getByRole("heading", { name: "This artifact is locked" }).waitFor();
    } finally {
      await other.close();
    }

    await ownerPasswordChange(id, secondPassword);
    const stale = await fetch(detailUrl, { headers: { "x-factrove-share-grant": grant } });
    await stale.arrayBuffer();
    if (stale.status !== 401) {
      throw new Error(`A grant survived a password change (${stale.status}).`);
    }
    await page.reload();
    await page.getByText("Your access expired or the password changed.").waitFor();
    await page.getByLabel("Password", { exact: true }).fill(firstPassword);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.getByRole("alert").filter({ hasText: "That password didn't work" }).waitFor();
    await page.getByLabel("Password", { exact: true }).fill(secondPassword);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.locator("iframe").waitFor({ timeout: 20000 });

    await ownerRemovePassword(id);
    await page.reload();
    await assertIsolatedFrame(page, fixture);
    if ((await page.getByText("Unlocked with password").count()) !== 0) {
      throw new Error("An unprotected link still said it was unlocked with a password.");
    }
    const open = await fetch(detailUrl);
    const openBody = await open.json();
    if (open.status !== 200 || openBody.artifact?.passwordProtected !== false || openBody.artifact.contentUrl.includes("ticket=")) {
      throw new Error(`Removing the password left ${open.status} ${JSON.stringify(openBody)}.`);
    }
  } finally {
    await page.close();
    await visitor.close();
  }

  const relocked = await runInput(
    "pnpm",
    ["factrove", "share", id, "--password-stdin", "--json", "--profile", "e2e"],
    firstPassword,
    cliChildEnv(configDir),
  );
  const relockedShare = JSON.parse(relocked.stdout).share;
  if (relocked.code !== 0 || relockedShare.shareUrl !== shareUrl || relockedShare.passwordProtected !== true) {
    throw new Error(`Re-protecting the link changed it or failed.\n${relocked.stdout}\n${relocked.stderr}`);
  }
  const unlock = await fetch(`${detailUrl}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: firstPassword }),
  });
  const unlockBody = await unlock.json();
  if (unlock.status !== 200 || !unlockBody.grant?.token) {
    throw new Error(`Unlock returned ${unlock.status} ${JSON.stringify(unlockBody)}.`);
  }
  const revoked = await must("pnpm", ["factrove", "share", id, "--revoke", "--profile", "e2e"], cliChildEnv(configDir));
  if (revoked.stdout.trim() !== `Revoked the public link for ${id}.`) {
    throw new Error(`Revoke output was ${JSON.stringify(revoked.stdout)}`);
  }
  await expectSql(`select share_password_hash is null from artifact where id = '${id}'`, "t");
  const afterRevoke = await fetch(detailUrl, { headers: { "x-factrove-share-grant": unlockBody.grant.token } });
  const afterRevokeBody = await afterRevoke.json();
  if (afterRevoke.status !== 404 || afterRevokeBody.error?.code !== "ARTIFACT_NOT_FOUND") {
    throw new Error(`A grant survived revoke: ${afterRevoke.status} ${JSON.stringify(afterRevokeBody)}.`);
  }
  const unlockRevoked = await fetch(`${detailUrl}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: firstPassword }),
  });
  await unlockRevoked.arrayBuffer();
  if (unlockRevoked.status !== 404) {
    throw new Error(`Unlocking a revoked link returned ${unlockRevoked.status}.`);
  }
  await expectPublicMissing(shareUrl, token);
}

async function ownerPasswordChange(id, password) {
  const page = await ownerContext.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(`${webOrigin}/artifacts/${id}`);
    const region = await openOwnerSharePanel(page);
    const controls = region.getByRole("region", { name: "Link password" });
    await controls.getByText("Password protected").waitFor();
    if (!(await controls.getByText("Visitors unlock it once per tab").count())) {
      throw new Error("The owner panel did not explain how visitors unlock the link.");
    }
    await controls.getByRole("button", { name: "Change password" }).click();
    const field = controls.getByLabel("New link password");
    await field.fill(password);
    await waitForRestingPaint(page);
    await screenshot(page, "owner-password-controls");
    await controls.getByRole("button", { name: "Save new password" }).click();
    await page.getByText("Password changed").first().waitFor();
    if ((await controls.getByLabel("New link password").count()) !== 0) {
      throw new Error("The password form stayed open after saving.");
    }
    if ((await page.content()).includes(password)) {
      throw new Error("The owner page kept the password in the document.");
    }
  } finally {
    await page.close();
  }
}

async function ownerRemovePassword(id) {
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(`${webOrigin}/artifacts/${id}`);
    await openOwnerSharePanel(page);
    const controls = page.getByRole("region", { name: "Link password" });
    await controls.getByRole("button", { name: "Remove password" }).click();
    await controls.getByText("No password").waitFor();
  } finally {
    await page.close();
  }
}

async function screenshot(page, name) {
  if (!screenshotDir) {
    return;
  }
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

function printedShareUrl(stdout) {
  return stdout.trim().split(/\r?\n/)[0] ?? "";
}

async function openOwnerSharePanel(page) {
  const region = page.getByRole("region", { name: "Public link" });
  if ((await region.count()) === 0) {
    await page.getByRole("button", { name: /Sharing/ }).click();
  }
  await region.waitFor();
  return region;
}

async function waitForRestingPaint(page) {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().flatMap((animation) => {
        const iterations = animation.effect?.getComputedTiming().iterations;
        if (iterations === Infinity) {
          return [];
        }
        return [animation.finished.catch(() => undefined)];
      }),
    ),
  );
}

async function expectPublicMissing(shareUrl, token) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    const detailRequest = page.waitForRequest(
      (request) => request.method() === "GET" && request.url().startsWith(`${apiOrigin}/api/v1/public/artifacts/`),
    );
    const documentResponse = await page.goto(shareUrl);
    const documentHeaders = documentResponse?.headers() ?? {};
    if (documentHeaders["referrer-policy"] !== "no-referrer" || documentHeaders["x-robots-tag"] !== "noindex") {
      throw new Error("The missing public page did not send no-referrer and noindex.");
    }
    const detail = await detailRequest;
    const detailResponse = await detail.response();
    if (detail.headers().cookie || detailResponse?.status() !== 404) {
      throw new Error(`The visitor's public request returned ${detailResponse?.status() ?? "no response"}.`);
    }
    await page.getByText("This artifact does not exist.").waitFor();
    if ((await page.getByRole("link", { name: "Back to library" }).count()) !== 0) {
      throw new Error("Anonymous visitors were offered the library.");
    }
    if ((await page.locator("iframe").count()) !== 0) {
      throw new Error("A revoked public link rendered an iframe.");
    }
    const visible = await page.locator("body").innerText();
    if (visible.includes(token) || /revok/i.test(visible) || visible.includes("Sign in")) {
      throw new Error(`Revoked public page leaked state: ${visible}`);
    }
  } finally {
    await page.close();
    await context.close();
  }
}

async function assertIsolatedFrame(page, fixture) {
  const frame = page.locator("iframe");
  await frame.waitFor({ timeout: 20000 });
  const sandbox = await frame.getAttribute("sandbox");
  const referrer = await frame.getAttribute("referrerpolicy");
  if (sandbox !== "allow-scripts" || referrer !== "no-referrer") {
    throw new Error(`iframe sandbox=${sandbox} referrerpolicy=${referrer}`);
  }
  const parent = await page.content();
  if (parent.includes("Inline JavaScript ran successfully.") || parent.includes(fixture.toString("utf8").slice(0, 40))) {
    throw new Error("Uploaded HTML was injected into the viewer page.");
  }
  const status = page.frameLocator("iframe").locator("#status");
  await status.waitFor({ timeout: 20000 });
  const text = await status.innerText();
  if (text !== "Inline JavaScript ran successfully.") {
    throw new Error(`Inline script result was ${text}`);
  }
  const isolation = await page.frameLocator("iframe").locator("body").evaluate(async () => {
    let parentAccess = "read";
    try {
      void window.parent.document.title;
    } catch {
      parentAccess = "blocked";
    }
    let external = "allowed";
    try {
      await fetch("https://example.com/");
    } catch {
      external = "blocked";
    }
    return { parentAccess, external };
  });
  if (isolation.parentAccess !== "blocked" || isolation.external !== "blocked") {
    throw new Error(`iframe isolation was ${JSON.stringify(isolation)}`);
  }
}

async function waitForJson(url, accept) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 180000) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (accept(body)) {
          return body;
        }
        last = JSON.stringify(body);
      } else {
        last = String(response.status);
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

async function waitForText(url, text) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 180000) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok && body.includes(text)) {
        return;
      }
      last = `${response.status} ${body.slice(0, 180)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${text} at ${url}: ${last}`);
}

async function waitUntilDown(url) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await delay(200);
  }
  throw new Error(`${url} was still accepting connections.`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
