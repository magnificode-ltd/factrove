import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHARE_WITH_ORGANIZATION_REQUEST_MESSAGE } from "./index.js";

const ARTIFACT_ID = "11111111-1111-4111-8111-111111111111";
const SHARE_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UPLOADED_AT = "2026-10-21T12:00:00.000Z";
const WEB_ORIGIN = "http://localhost:3000";
const API_ORIGIN = "http://localhost:3001";

const helloPath = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/hello.html");
const helloBytes = readFileSync(helloPath).byteLength;

const artifact = {
  id: ARTIFACT_ID,
  creatorUserId: "user_example",
  organizationId: null,
  accessType: "private",
  filename: `${ARTIFACT_ID}.html`,
  name: "hello",
  mimeType: "text/html",
  sizeBytes: helloBytes,
  createdAt: UPLOADED_AT,
  updatedAt: UPLOADED_AT,
  uploadedAt: UPLOADED_AT,
  viewerUrl: `${WEB_ORIGIN}/artifacts/${ARTIFACT_ID}`,
  contentUrl: `${API_ORIGIN}/api/v1/artifacts/${ARTIFACT_ID}/content`,
  shared: false,
  passwordProtected: false,
};

const publicArtifact = {
  id: ARTIFACT_ID,
  filename: `${ARTIFACT_ID}.html`,
  name: "hello",
  mimeType: "text/html",
  sizeBytes: helloBytes,
  uploadedAt: UPLOADED_AT,
  contentUrl: `${API_ORIGIN}/api/v1/public/artifacts/${ARTIFACT_ID}/${SHARE_TOKEN}/content`,
  passwordProtected: false,
};

const activeShare = {
  share: {
    shared: true,
    shareUrl: `${WEB_ORIGIN}/share/${ARTIFACT_ID}/${SHARE_TOKEN}`,
    passwordProtected: false,
  },
};

const revokedShare = {
  share: {
    shared: false,
    shareUrl: null,
    passwordProtected: false,
  },
};

type JsonExample = {
  example: unknown;
  examples?: Record<string, { summary: string; value: unknown }>;
};

type CodeSample = {
  lang: string;
  label: string;
  source: string;
};

const ERROR_BODIES: Record<string, { code: string; message: string }> = {
  UNAUTHENTICATED: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
  FORBIDDEN: { code: "FORBIDDEN", message: "This request origin is not allowed." },
  ARTIFACT_NOT_FOUND: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." },
  FILE_TOO_LARGE: { code: "FILE_TOO_LARGE", message: "The file exceeds the 10 MiB limit." },
  UNSUPPORTED_FILE_TYPE: { code: "UNSUPPORTED_FILE_TYPE", message: "Only .html and .htm files are supported." },
  STORAGE_UNAVAILABLE: { code: "STORAGE_UNAVAILABLE", message: "Object storage is unavailable." },
  CONTENT_CONFLICT: {
    code: "CONTENT_CONFLICT",
    message: "Another replace finished first. Upload again to replace the current content.",
  },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
  CONTENT_TOO_LARGE: { code: "CONTENT_TOO_LARGE", message: "HTML exceeds the Markdown conversion limit." },
  CONTENT_TOO_COMPLEX: { code: "CONTENT_TOO_COMPLEX", message: "HTML took too long to convert to Markdown." },
  CONVERSION_UNAVAILABLE: { code: "CONVERSION_UNAVAILABLE", message: "Markdown conversion is busy. Try again." },
  PASSWORD_REQUIRED: { code: "PASSWORD_REQUIRED", message: "This link needs a password." },
  PASSWORD_INCORRECT: { code: "PASSWORD_INCORRECT", message: "That password is not right." },
  UNLOCK_UNAVAILABLE: { code: "UNLOCK_UNAVAILABLE", message: "Password verification is busy. Try again." },
  ORGANIZATION_REQUIRED: {
    code: "ORGANIZATION_REQUIRED",
    message: "Organization sharing requires membership in an organization.",
  },
};

const REQUEST_EXAMPLES: Record<string, unknown> = {
  CreateApiKeyRequest: { name: "cli" },
  DeleteApiKeyRequest: { keyId: "key_example" },
  SignUpEmailRequest: {
    name: "Local Owner",
    email: "owner@example.com",
    password: "replace-this-password",
  },
  SignInEmailRequest: {
    email: "owner@example.com",
    password: "replace-this-password",
  },
  CreateShareRequest: { password: "example-link-password" },
  ShareWithOrganizationRequest: { accessType: "org_shared" },
  PublicUnlockRequest: { password: "example-link-password" },
};

export function requestExampleFor(schemaName: string): unknown | undefined {
  return REQUEST_EXAMPLES[schemaName];
}

export function codeSamplesFor(operationId: string): CodeSample[] | undefined {
  if (operationId === "uploadArtifact") {
    return uploadSamples("POST");
  }
  if (operationId === "replaceArtifactContent") {
    return uploadSamples("PUT");
  }
  if (operationId === "createApiKey") {
    return createKeySamples();
  }
  return undefined;
}

export function responseExampleFor(
  operationId: string,
  status: string,
  schemaName: string | undefined,
  description: string,
): JsonExample | undefined {
  const success = successExample(operationId, schemaName);
  if (success !== undefined) {
    return { example: success };
  }
  if (schemaName !== "ApiError") {
    return undefined;
  }
  const codes = [...description.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((match) => match[1] ?? "");
  const bodies = codes
    .map((code) => errorBody(code, description))
    .filter((body): body is { code: string; message: string } => body !== undefined);
  if (bodies.length === 0) {
    const fallback = fallbackError(operationId, status);
    return fallback ? { example: { error: fallback } } : undefined;
  }
  const example = { error: bodies[0] };
  if (bodies.length === 1) {
    return { example };
  }
  const examples: Record<string, { summary: string; value: unknown }> = {};
  for (const body of bodies) {
    examples[body.code] = { summary: body.code, value: { error: body } };
  }
  return { example, examples };
}

function successExample(operationId: string, schemaName: string | undefined): unknown | undefined {
  if (schemaName === "ArtifactEnvelope") {
    if (operationId === "shareArtifactWithOrganization") {
      return {
        artifact: {
          ...artifact,
          organizationId: "org_example",
          accessType: "org_shared",
        },
      };
    }
    return { artifact };
  }
  if (schemaName === "ArtifactListEnvelope") {
    return { items: [artifact] };
  }
  if (schemaName === "HealthEnvelope") {
    return { status: "ok" };
  }
  if (schemaName === "ContextEnvelope") {
    return { user: { id: "user_example", name: "Example User" }, organization: null };
  }
  if (schemaName === "PublicArtifactEnvelope") {
    return { artifact: publicArtifact };
  }
  if (schemaName === "PublicUnlockEnvelope") {
    return {
      grant: {
        token: "g1.example",
        expiresAt: "2026-10-21T12:15:00.000Z",
      },
    };
  }
  if (schemaName === "ShareEnvelope") {
    return operationId === "revokeArtifactShare" ? revokedShare : activeShare;
  }
  if (schemaName === "CreateApiKeyResponse") {
    return {
      id: "key_example",
      name: "cli",
      start: "ftrv_example1",
      key: "ftrv_example_key_shown_once",
    };
  }
  if (schemaName === "ListApiKeysResponse") {
    return {
      apiKeys: [{ id: "key_example", name: "cli", start: "ftrv_example1" }],
      total: 1,
    };
  }
  if (schemaName === "DeleteApiKeyResponse") {
    return { success: true };
  }
  return undefined;
}

function fallbackError(operationId: string, status: string): { code: string; message: string } | undefined {
  if (status === "500") {
    return ERROR_BODIES.INTERNAL_ERROR;
  }
  if (status === "400" && operationId === "createArtifactShare") {
    return { code: "INVALID_REQUEST", message: "Send an optional password string." };
  }
  if (status === "400") {
    return { code: "INVALID_REQUEST", message: "Artifact id must be a UUID." };
  }
  return undefined;
}

function errorBody(code: string, description: string): { code: string; message: string } | undefined {
  if (code === "RATE_LIMITED") {
    const password = /password/i.test(description);
    return {
      code,
      message: password ? "Too many password attempts. Try again later." : "Too many requests. Try again later.",
    };
  }
  if (code === "INVALID_REQUEST") {
    return { code, message: invalidRequestMessage(description) };
  }
  return ERROR_BODIES[code];
}

function invalidRequestMessage(description: string): string {
  if (/shares a private artifact/i.test(description)) {
    return SHARE_WITH_ORGANIZATION_REQUEST_MESSAGE;
  }
  if (/not a UUID/i.test(description)) {
    return "Artifact id must be a UUID.";
  }
  if (/\bview\b/i.test(description)) {
    return "view must be mine or org.";
  }
  if (/\bformat\b/i.test(description)) {
    return "format must be html or markdown.";
  }
  if (/accessType on replace/i.test(description)) {
    return "accessType cannot be changed when replacing content.";
  }
  if (/non-JSON/i.test(description)) {
    return "Send the password as a string.";
  }
  if (/password/i.test(description)) {
    return "Send an optional password string.";
  }
  if (/UTF-8/i.test(description)) {
    return "The file is not valid UTF-8.";
  }
  return "Send exactly one file.";
}

function uploadSamples(method: "POST" | "PUT"): CodeSample[] {
  const label = method === "POST" ? "Upload hello.html" : "Replace with hello.html";
  const curlUrl = method === "POST"
    ? `${API_ORIGIN}/api/v1/artifacts`
    : `${API_ORIGIN}/api/v1/artifacts/$artifact_id/content`;
  const fetchUrl = method === "POST"
    ? `"${API_ORIGIN}/api/v1/artifacts"`
    : `\`\${API_ORIGIN}/api/v1/artifacts/\${artifactId}/content\``;
  const pythonCall = method === "POST"
    ? [
        `    response = requests.post(`,
        `        "${API_ORIGIN}/api/v1/artifacts",`,
      ]
    : [
        `    response = requests.put(`,
        `        f"${API_ORIGIN}/api/v1/artifacts/{os.environ['ARTIFACT_ID']}/content",`,
      ];
  const javascriptPrelude = method === "POST"
    ? []
    : [`const artifactId = process.env.ARTIFACT_ID;`, `const API_ORIGIN = "${API_ORIGIN}";`, ``];
  return [
    {
      lang: "bash",
      label,
      source: [
        `curl -sS -X ${method} "${curlUrl}" \\`,
        `  -H "Authorization: Bearer $FACTROVE_API_KEY" \\`,
        `  -F "file=@./fixtures/hello.html"`,
      ].join("\n"),
    },
    {
      lang: "javascript",
      label,
      source: [
        `import { readFile } from "node:fs/promises";`,
        ``,
        ...javascriptPrelude,
        `const bytes = await readFile("./fixtures/hello.html");`,
        `const htmlBlob = new Blob([bytes], { type: "text/html" });`,
        `const form = new FormData();`,
        `form.append("file", htmlBlob, "hello.html");`,
        ``,
        `const response = await fetch(${fetchUrl}, {`,
        `  method: "${method}",`,
        `  headers: { Authorization: \`Bearer \${process.env.FACTROVE_API_KEY}\` },`,
        `  body: form,`,
        `});`,
      ].join("\n"),
    },
    {
      lang: "python",
      label,
      source: [
        `import os`,
        `import requests`,
        ``,
        `with open("./fixtures/hello.html", "rb") as handle:`,
        ...pythonCall,
        `        headers={"Authorization": f"Bearer {os.environ['FACTROVE_API_KEY']}"},`,
        `        files={"file": ("hello.html", handle, "text/html")},`,
        `    )`,
      ].join("\n"),
    },
  ];
}

function createKeySamples(): CodeSample[] {
  return [
    {
      lang: "bash",
      label: "Sign in and create a key",
      source: [
        `api=http://localhost:3001`,
        `origin=http://localhost:3000`,
        `jar=$(mktemp)`,
        ``,
        `curl -sS -c "$jar" -X POST "$api/api/auth/sign-up/email" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Origin: $origin" \\`,
        `  -d '{"name":"Local Owner","email":"owner@example.com","password":"replace-this-password"}'`,
        ``,
        `curl -sS -b "$jar" -X POST "$api/api/auth/api-key/create" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Origin: $origin" \\`,
        `  -d '{"name":"cli"}'`,
      ].join("\n"),
    },
    {
      lang: "javascript",
      label: "Browser on the web origin",
      source: [
        `const response = await fetch("http://localhost:3001/api/auth/api-key/create", {`,
        `  method: "POST",`,
        `  credentials: "include",`,
        `  headers: { "Content-Type": "application/json" },`,
        `  body: JSON.stringify({ name: "cli" }),`,
        `});`,
      ].join("\n"),
    },
  ];
}
