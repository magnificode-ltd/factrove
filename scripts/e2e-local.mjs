// Uses Compose project factrove-e2e, with its own volumes and host ports.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  apiEntry,
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
  rootEnvFile,
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
  const plainViewer = plain.stdout.trim();
  if (!viewerUrl(plainViewer)) {
    throw new Error(`Plain upload did not print a viewer URL.\n${plain.stdout}`);
  }
  if (plain.stdout.includes("Nest") || plain.stdout.includes("successfully started")) {
    throw new Error("Plain upload stdout included framework logs.");
  }
  if (plain.stdout.includes(owner.secret)) {
    throw new Error("Plain upload printed the API key.");
  }
  const plainId = plainViewer.slice(plainViewer.lastIndexOf("/") + 1);

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

  const shared = await must(
    "pnpm",
    ["factrove", "upload", "./fixtures/hello.html", "--access", "org_shared", "--profile", "e2e"],
    cliChildEnv(configDir),
  );
  const sharedViewer = shared.stdout.trim();
  const sharedId = sharedViewer.slice(sharedViewer.lastIndexOf("/") + 1);
  if (!viewerUrl(sharedViewer)) {
    throw new Error(`org_shared upload did not print a viewer URL.\n${shared.stdout}`);
  }

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

  await assertContent(plainId, fixture);
  await assertContent(sharedId, fixture);

  await checkLibrary(plainId, jsonArtifact.id, sharedId);
  await checkViewer(plainViewer, fixture);
  await checkViewer(sharedViewer, fixture);
  await checkSignedOutReturn(plainViewer, owner.email, owner.password);
  await expectOwnerOnly(plainId);
  await expectKeyHash(owner.secret);

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
  child.BETTER_AUTH_SECRET = "local-only-factrove-auth-secret-change-me";
  return child;
}

function cliChildEnv(configDir) {
  const child = { ...env, FACTROVE_API_URL: apiOrigin, FACTROVE_PROFILE: "e2e" };
  delete child.FACTROVE_API_KEY;
  if (configDir) {
    child.FACTROVE_CONFIG_DIR = configDir;
  }
  return child;
}

function webChildEnv() {
  const child = webLaunchEnv(env, readDotEnv(rootEnvFile));
  child.NEXT_PUBLIC_API_URL = apiOrigin;
  delete child.INIT_CWD;
  return child;
}

function integrationChildEnv() {
  const child = apiChildEnv();
  child.S3_INTEGRATION = "1";
  return child;
}

function viewerUrl(value) {
  return new RegExp(`^http://127\\.0\\.0\\.1:${e2eWebPort}/artifacts/[0-9a-f-]{36}$`).test(value);
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

async function checkLibrary(plainId, jsonId, sharedId) {
  const page = await ownerContext.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(60000);
  try {
    await page.goto(`${webOrigin}/`);
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
  } finally {
    await page.close();
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
