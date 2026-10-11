import { describe, expect, it, vi } from "vitest";
import { createFactroveClient, FactroveApiError } from "../src/index.js";

const artifact = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  creatorUserId: "local-user",
  organizationId: "local-org",
  accessType: "private",
  filename: "hello.html",
  mimeType: "text/html",
  sizeBytes: 13,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
  uploadedAt: "2026-10-11T10:00:00.000Z",
  viewerUrl: "http://localhost:3000/artifacts/123e4567-e89b-42d3-a456-426614174000",
  contentUrl: "http://localhost:3001/api/v1/artifacts/123e4567-e89b-42d3-a456-426614174000/content"
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Factrove API client", () => {
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
