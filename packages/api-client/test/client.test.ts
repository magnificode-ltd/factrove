import { describe, expect, it, vi } from "vitest";
import { createFactroveClient, FactroveApiError } from "../src/index.js";

const artifact = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "private",
  filename: "hello.html",
  name: null,
  mimeType: "text/html",
  sizeBytes: 13,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: "http://localhost:3000/artifacts/123e4567-e89b-42d3-a456-426614174000",
  contentUrl: "http://localhost:3001/api/v1/artifacts/123e4567-e89b-42d3-a456-426614174000/content",
  shared: false,
  passwordProtected: false
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Factrove API client", () => {
  it("posts an organization name for the signed-in user", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ organization: { id: "org-1", name: "Ada Lab" } }, 201);
    });
    const client = createFactroveClient({
      baseUrl: "http://localhost:3001",
      cookie: "session=1",
      fetch: fetchStub as typeof fetch
    });
    await expect(client.createOrganization("Ada Lab")).resolves.toEqual({
      organization: { id: "org-1", name: "Ada Lab" }
    });
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe(JSON.stringify({ name: "Ada Lab" }));
    expect(new Headers(capturedInit?.headers).get("cookie")).toBe("session=1");
  });

  it("posts the documented multipart fields and leaves boundary headers to fetch", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({ artifact });
    });
    const client = createFactroveClient({ baseUrl: "http://localhost:3001/", fetch: fetchStub as typeof fetch });

    await client.uploadArtifact({ file: new Blob(["<h1>Hello</h1>"]), filename: "hello.html", accessType: "org_shared" });

    expect(capturedUrl).toBe("http://localhost:3001/api/v1/artifacts");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toBeUndefined();
    const form = capturedInit?.body as FormData;
    expect(form.get("accessType")).toBe("org_shared");
    expect(form.get("file")).toBeInstanceOf(File);
    const uploadedFile = form.get("file") as File;
    expect(uploadedFile.name).toBe("hello.html");
    expect(await uploadedFile.text()).toBe("<h1>Hello</h1>");
  });

  it("puts replacement HTML on the artifact content route", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({ artifact });
    });
    const client = createFactroveClient({ baseUrl: "http://localhost:3001", fetch: fetchStub as typeof fetch });

    await client.replaceArtifactContent(artifact.id, { file: new Blob(["<p>next</p>"]), filename: "next.html" });

    expect(capturedUrl).toBe(`http://localhost:3001/api/v1/artifacts/${artifact.id}/content`);
    expect(capturedInit?.method).toBe("PUT");
    const form = capturedInit?.body as FormData;
    expect(form.get("accessType")).toBeNull();
    const uploadedFile = form.get("file") as File;
    expect(uploadedFile.name).toBe("next.html");
    expect(await uploadedFile.text()).toBe("<p>next</p>");
  });

  it("patches accessType org_shared on the artifact route", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const shared = { ...artifact, accessType: "org_shared", organizationId: "local-org" };
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({ artifact: shared });
    });
    const client = createFactroveClient({
      baseUrl: "http://localhost:3001",
      apiKey: "ftrv_test",
      fetch: fetchStub as typeof fetch
    });

    await expect(client.shareArtifactWithOrganization(artifact.id, "local-org")).resolves.toEqual({ artifact: shared });

    expect(capturedUrl).toBe(`http://localhost:3001/api/v1/artifacts/${artifact.id}`);
    expect(capturedInit?.method).toBe("PATCH");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer ftrv_test");
    expect(capturedInit?.body).toBe(JSON.stringify({ accessType: "org_shared", organizationId: "local-org" }));
  });

  it("patches a library name and deletes an artifact with an empty success response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const renamed = { ...artifact, name: "Launch notes" };
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ artifact: renamed });
    });
    const client = createFactroveClient({
      baseUrl: "http://localhost:3001",
      apiKey: "ftrv_test",
      fetch: fetchStub as typeof fetch
    });

    await expect(client.renameArtifact(artifact.id, "Launch notes")).resolves.toEqual({ artifact: renamed });
    await expect(client.deleteArtifact(artifact.id)).resolves.toBeUndefined();

    expect(calls[0]?.url).toBe(`http://localhost:3001/api/v1/artifacts/${artifact.id}/name`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer ftrv_test");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "Launch notes" }));
    expect(calls[1]?.url).toBe(`http://localhost:3001/api/v1/artifacts/${artifact.id}`);
    expect(calls[1]?.init?.method).toBe("DELETE");
  });

  it("reads a delete error envelope", async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }, 404)
    );
    const client = createFactroveClient({ baseUrl: "http://localhost:3001", fetch: fetchStub as typeof fetch });
    await expect(client.deleteArtifact(artifact.id)).rejects.toMatchObject({
      status: 404,
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found."
    });
  });

  it("appends /api/v1 once when the origin already includes the prefix", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ items: [artifact] }));
    const client = createFactroveClient({ baseUrl: "http://localhost:3001/api/v1/", fetch: fetchStub as typeof fetch });
    await client.listArtifacts({ view: "org" });
    expect(fetchStub).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/artifacts?view=org",
      { method: "GET" }
    );
  });

  it("parses context and artifact response envelopes", async () => {
    const fetchStub = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/context")
        ? jsonResponse({ user: { id: "local-user", name: "Local User" }, organization: null })
        : jsonResponse({ artifact })
    );
    const client = createFactroveClient({ baseUrl: "https://api.example.test", fetch: fetchStub as typeof fetch });
    expect(await client.getContext()).toEqual({ user: { id: "local-user", name: "Local User" }, organization: null });
    expect((await client.getArtifact(artifact.id)).artifact.id).toBe(artifact.id);
  });

  it("maps documented API error envelopes", async () => {
    const fetchStub = vi.fn(async () => jsonResponse({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact not found" } }, 404));
    const client = createFactroveClient({ baseUrl: "http://localhost:3001", fetch: fetchStub as typeof fetch });
    await expect(client.getArtifact("missing")).rejects.toMatchObject({
      name: "FactroveApiError", status: 404, code: "ARTIFACT_NOT_FOUND", message: "Artifact not found"
    });
  });

  it("reads Retry-After on throttled unlock errors", async () => {
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many password attempts. Try again later." } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "17" }
      })
    );
    const client = createFactroveClient({ baseUrl: "http://localhost:3001", fetch: fetchStub as typeof fetch });
    await expect(client.unlockPublicArtifact(artifact.id, "a".repeat(43), "open sesame 42")).rejects.toMatchObject({
      name: "FactroveApiError",
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 17
    });
  });

  it("reports malformed error and success payloads as invalid responses", async () => {
    const errorClient = createFactroveClient({
      baseUrl: "http://localhost:3001",
      fetch: vi.fn(async () => new Response("not json", { status: 502 })) as typeof fetch
    });
    await expect(errorClient.listArtifacts()).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 502 });

    const successClient = createFactroveClient({
      baseUrl: "http://localhost:3001",
      fetch: vi.fn(async () => jsonResponse({ items: "not an array" })) as typeof fetch
    });
    await expect(successClient.listArtifacts()).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });

  it("reads stored HTML by default and Markdown when format is requested", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const markdown = String(input).includes("format=markdown");
      return new Response(markdown ? "# Hello\n" : "<h1>Hello</h1>", {
        status: 200,
        headers: { "content-type": markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8" }
      });
    });
    const client = createFactroveClient({ baseUrl: "http://localhost:3001", fetch: fetchStub as typeof fetch });

    await expect(client.getArtifactContent(artifact.id)).resolves.toEqual({
      format: "html",
      mediaType: "text/html",
      content: "<h1>Hello</h1>"
    });
    await expect(client.getArtifactContent(artifact.id, { format: "html" })).resolves.toEqual({
      format: "html",
      mediaType: "text/html",
      content: "<h1>Hello</h1>"
    });
    await expect(client.getArtifactContent(artifact.id, { format: "markdown" })).resolves.toEqual({
      format: "markdown",
      mediaType: "text/markdown",
      content: "# Hello\n"
    });

    expect(calls.map((call) => call.url)).toEqual([
      `http://localhost:3001/api/v1/artifacts/${artifact.id}/content`,
      `http://localhost:3001/api/v1/artifacts/${artifact.id}/content`,
      `http://localhost:3001/api/v1/artifacts/${artifact.id}/content?format=markdown`
    ]);
    expect(calls.every((call) => call.init?.method === "GET")).toBe(true);
  });

  it("encodes the artifact id and maps content errors", async () => {
    const fetchStub = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("missing")) {
        return jsonResponse({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } }, 404);
      }
      return new Response("plain", { status: 200, headers: { "content-type": "text/plain" } });
    });
    const client = createFactroveClient({ baseUrl: "http://localhost:3001/api/v1", fetch: fetchStub as typeof fetch });

    await expect(client.getArtifactContent("missing id", { format: "markdown" })).rejects.toMatchObject({
      name: "FactroveApiError",
      status: 404,
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found."
    });
    expect(fetchStub).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/artifacts/missing%20id/content?format=markdown",
      { method: "GET" }
    );

    await expect(client.getArtifactContent(artifact.id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
      message: "The API returned an unexpected content type"
    });
  });

  it("keeps a leading byte order mark in HTML content", async () => {
    const content = "\uFEFF<h1>Hello</h1>";
    const fetchStub = vi.fn(async () => new Response(content, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    }));
    const client = createFactroveClient({ baseUrl: "http://localhost:3001", fetch: fetchStub as typeof fetch });
    await expect(client.getArtifactContent(artifact.id)).resolves.toEqual({
      format: "html",
      mediaType: "text/html",
      content
    });
  });

  it("creates, reads, and revokes a share without sending the token to a different path", async () => {
    const token = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const share = {
      share: {
        shared: true,
        shareUrl: `https://library.example.com/share/${artifact.id}/${token}`,
        passwordProtected: false
      }
    };
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      if (init?.method === "DELETE") {
        return jsonResponse({ share: { shared: false, shareUrl: null, passwordProtected: false } });
      }
      if (String(input).includes("/public/")) {
        return jsonResponse({
          artifact: {
            id: artifact.id,
            filename: `${artifact.id}.html`,
            name: null,
            mimeType: "text/html",
            sizeBytes: 13,
            uploadedAt: artifact.uploadedAt,
            contentUrl: `http://localhost:3001/api/v1/public/artifacts/${artifact.id}/${token}/content`,
            passwordProtected: false
          }
        });
      }
      return jsonResponse(share);
    });
    const client = createFactroveClient({
      baseUrl: "http://localhost:3001",
      apiKey: "ftrv_test_key",
      fetch: fetchStub as typeof fetch
    });
    await expect(client.createArtifactShare(artifact.id)).resolves.toEqual(share);
    await expect(client.getArtifactShare(artifact.id)).resolves.toEqual(share);
    await expect(client.revokeArtifactShare(artifact.id)).resolves.toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });
    const opened = await client.getPublicArtifact(artifact.id, token);
    expect(opened.artifact.id).toBe(artifact.id);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST http://localhost:3001/api/v1/artifacts/${artifact.id}/share`,
      `GET http://localhost:3001/api/v1/artifacts/${artifact.id}/share`,
      `DELETE http://localhost:3001/api/v1/artifacts/${artifact.id}/share`,
      `GET http://localhost:3001/api/v1/public/artifacts/${artifact.id}/${token}`
    ]);
    const authorization = (fetchStub.mock.calls[0]?.[1] as RequestInit | undefined)?.headers;
    expect(new Headers(authorization).get("authorization")).toBe("Bearer ftrv_test_key");
  });

  it("sends share passwords and unlock grants in the body and a header, never in the URL", async () => {
    const token = "c".repeat(43);
    const password = "correct horse battery";
    const grant = "g1.abc.signature";
    const calls: Array<{ url: string; method: string | undefined; headers: Headers; body: unknown }> = [];
    const protectedShare = {
      share: { shared: true, shareUrl: `https://library.example.com/share/${artifact.id}/${token}`, passwordProtected: true }
    };
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method, headers: new Headers(init?.headers), body: init?.body });
      const url = String(input);
      if (url.endsWith("/unlock")) {
        return jsonResponse({ grant: { token: grant, expiresAt: "2026-10-21T10:15:00.000Z" } });
      }
      if (url.includes("/public/")) {
        return jsonResponse({
          artifact: {
            id: artifact.id,
            filename: `${artifact.id}.html`,
            name: null,
            mimeType: "text/html",
            sizeBytes: 13,
            uploadedAt: artifact.uploadedAt,
            contentUrl: `http://localhost:3001/api/v1/public/artifacts/${artifact.id}/${token}/content?ticket=t1.x`,
            passwordProtected: true
          }
        });
      }
      if (url.endsWith("/share/password")) {
        return jsonResponse({ share: { ...protectedShare.share, passwordProtected: false } });
      }
      return jsonResponse(protectedShare);
    });
    const client = createFactroveClient({ baseUrl: "http://localhost:3001", fetch: fetchStub as typeof fetch });

    await expect(client.createArtifactShare(artifact.id, { password })).resolves.toEqual(protectedShare);
    await client.removeArtifactSharePassword(artifact.id);
    await expect(client.unlockPublicArtifact(artifact.id, token, password)).resolves.toEqual({
      grant: { token: grant, expiresAt: "2026-10-21T10:15:00.000Z" }
    });
    await client.getPublicArtifact(artifact.id, token, { grant });
    await client.getPublicArtifact(artifact.id, token);

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST http://localhost:3001/api/v1/artifacts/${artifact.id}/share`,
      `DELETE http://localhost:3001/api/v1/artifacts/${artifact.id}/share/password`,
      `POST http://localhost:3001/api/v1/public/artifacts/${artifact.id}/${token}/unlock`,
      `GET http://localhost:3001/api/v1/public/artifacts/${artifact.id}/${token}`,
      `GET http://localhost:3001/api/v1/public/artifacts/${artifact.id}/${token}`
    ]);
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.body))).toEqual({ password });
    expect(JSON.parse(String(calls[2]?.body))).toEqual({ password });
    expect(calls[3]?.headers.get("x-factrove-share-grant")).toBe(grant);
    expect(calls[4]?.headers.has("x-factrove-share-grant")).toBe(false);
    for (const call of calls) {
      expect(call.url).not.toContain(password);
      expect(call.url).not.toContain(grant);
    }
  });

  it("maps fetch/network failures without inventing an HTTP status", async () => {
    const client = createFactroveClient({
      baseUrl: "http://localhost:3001",
      fetch: vi.fn(async () => { throw new TypeError("connection refused"); }) as typeof fetch
    });
    try {
      await client.listArtifacts();
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FactroveApiError);
      expect(error).toMatchObject({ status: null, code: "NETWORK_ERROR", message: "connection refused" });
    }
  });
});
