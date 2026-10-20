/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createPublicBrowserClient } from "../src/api/client";
import { PublicShareLoader } from "../src/share/public-share-loader";

const id = "123e4567-e89b-42d3-a456-426614174000";
const token = "a".repeat(43);
let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
});

describe("public share page", () => {
  it("loads the artifact in the browser without a session cookie", async () => {
    const calls: Array<{ url: string; credentials: RequestCredentials | undefined; cookie: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        credentials: init?.credentials,
        cookie: headers.get("cookie")
      });
      return new Response(
        JSON.stringify({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    };

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(PublicShareLoader, { id, token, fetchImpl }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.credentials).toBe("omit");
    expect(calls[0]?.cookie).toBeNull();
    expect(calls[0]?.url).toBe(`http://localhost:3001/api/v1/public/artifacts/${id}/${token}`);
    expect(container.textContent).toContain("This artifact does not exist.");
    expect(container.textContent).not.toContain("Back to library");
  });

  it("strips cookies from a caller-supplied fetch", async () => {
    let credentials: RequestCredentials | undefined;
    let cookie: string | null = "present";
    const client = createPublicBrowserClient(async (_input, init) => {
      credentials = init?.credentials;
      cookie = new Headers(init?.headers).get("cookie");
      return new Response(JSON.stringify({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    });
    await expect(client.getPublicArtifact(id, token)).rejects.toMatchObject({ status: 404, code: "ARTIFACT_NOT_FOUND" });
    expect(credentials).toBe("omit");
    expect(cookie).toBeNull();
  });
});
