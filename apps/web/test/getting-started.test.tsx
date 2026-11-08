import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { ContextEnvelope } from "@factrove/contracts";
import { DOCS_BASE_URL } from "../src/docs";
import { gettingStartedCopy } from "../src/library/getting-started";
import { LibraryScreen } from "../src/library/library-screen";

const context: ContextEnvelope = {
  user: { id: "local-user", name: "Local User" },
  organization: { id: "local-org", name: "Local Organization" },
};

afterEach(() => {
  delete process.env.BROWSER_API_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  delete process.env.INTERNAL_API_URL;
});

describe("getting started copy", () => {
  it("uses npm install, factrove configure with the API origin, and factrove upload", () => {
    const copy = gettingStartedCopy({ apiOrigin: "https://api.example.com" });
    expect(copy.installCommand).toBe("npm i -g factrove");
    expect(copy.npxCommand).toBe("npx factrove");
    expect(copy.configureCommand).toBe("factrove configure --api-url https://api.example.com");
    expect(copy.uploadCommand).toBe("factrove upload plan.html");
    expect(copy.orgUploadCommand).toBe("factrove upload plan.html --access org_shared");
    expect(copy.docsUrl).toBe(`${DOCS_BASE_URL}/cli-reference/overview`);
    expect(copy.agentPrompt).toContain("npm i -g factrove");
    expect(copy.agentPrompt).toContain(copy.configureCommand);
    expect(copy.agentPrompt).toContain(copy.uploadCommand);
    expect(copy.agentPrompt).toContain(`printf '%s\\n' "$FACTROVE_API_KEY" | ${copy.configureCommand}`);
    expect(copy.agentPrompt).toContain("npx factrove");
    expect(copy.agentPrompt).toContain("Do not pass the key with --api-key");
    expect(copy.agentPrompt).not.toContain("git clone");
    expect(copy.agentPrompt).not.toContain("pnpm factrove");
  });

  it("quotes an API origin that is not a plain URL", () => {
    expect(gettingStartedCopy({ apiOrigin: "https://api.example.com" }).configureCommand).toBe(
      "factrove configure --api-url https://api.example.com",
    );
    expect(gettingStartedCopy({ apiOrigin: "http://localhost:3001" }).configureCommand).toBe(
      "factrove configure --api-url http://localhost:3001",
    );
    expect(gettingStartedCopy({ apiOrigin: "http://[::1]:3001" }).configureCommand).toBe(
      "factrove configure --api-url 'http://[::1]:3001'",
    );
    expect(gettingStartedCopy({ apiOrigin: "https://api;true" }).configureCommand).toBe(
      "factrove configure --api-url 'https://api;true'",
    );
    expect(gettingStartedCopy({ apiOrigin: "https://api&true" }).configureCommand).toBe(
      "factrove configure --api-url 'https://api&true'",
    );
    expect(gettingStartedCopy({ apiOrigin: "https://api$true" }).configureCommand).toBe(
      "factrove configure --api-url 'https://api$true'",
    );
    expect(gettingStartedCopy({ apiOrigin: "https://api!true" }).configureCommand).toBe(
      "factrove configure --api-url 'https://api!true'",
    );
    expect(gettingStartedCopy({ apiOrigin: "https://api'host.example" }).configureCommand).toBe(
      "factrove configure --api-url 'https://api'\\''host.example'",
    );
  });

  it("renders the deployment API origin into the empty library", () => {
    process.env.BROWSER_API_URL = "https://api.example.com";
    process.env.INTERNAL_API_URL = "http://api:3001";
    process.env.NEXT_PUBLIC_API_URL = "https://baked.example.com";
    const html = renderToStaticMarkup(<LibraryScreen state={{ status: "empty", view: "mine", context }} />);
    expect(html).toContain("factrove configure --api-url https://api.example.com");
    expect(html).not.toContain("https://baked.example.com");
    expect(html).not.toContain("http://api:3001");
    expect(html).toContain("Copy install");
    expect(html).toContain("Copy configure");
    expect(html).toContain("Copy upload");
    expect(html).toContain("Copy npx");
    expect(html).toContain("Copy prompt");
    expect(html).toContain("suggests the value from the environment or the saved profile");
    expect(html).not.toContain("Without it, the CLI uses");
    expect(html).toContain('href="/account/api-keys"');
    expect(html).toContain(`href="${DOCS_BASE_URL}/cli-reference/overview"`);
  });
});
