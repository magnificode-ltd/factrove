import {
  apiErrorSchema,
  artifactEnvelopeSchema,
  artifactListEnvelopeSchema,
  contextEnvelopeSchema,
  type AccessType,
  type ArtifactEnvelope,
  type ArtifactListEnvelope,
  type ContextEnvelope
} from "@factrove/contracts";

const API_PREFIX = "/api/v1";

export class FactroveApiError extends Error {
  readonly status: number | null;
  readonly code: string;

  constructor(message: string, options: { status: number | null; code: string }) {
    super(message);
    this.name = "FactroveApiError";
    this.status = options.status;
    this.code = options.code;
  }
}

export interface FactroveClientOptions {
  /** API origin, such as http://localhost:3001. A trailing /api/v1 is accepted. */
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface UploadArtifactInput {
  file: Blob;
  filename: string;
  accessType?: AccessType;
}

export interface FactroveClient {
  getContext(): Promise<ContextEnvelope>;
  uploadArtifact(input: UploadArtifactInput): Promise<ArtifactEnvelope>;
  listArtifacts(input?: { view?: "mine" | "org" }): Promise<ArtifactListEnvelope>;
  getArtifact(id: string): Promise<ArtifactEnvelope>;
}

function normalizeBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS");
  }
  parsed.search = "";
  parsed.hash = "";
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith(API_PREFIX)) pathname = pathname.slice(0, -API_PREFIX.length);
  return `${parsed.origin}${pathname}`.replace(/\/$/, "");
}

function parseErrorPayload(payload: unknown, status: number): FactroveApiError {
  const parsed = apiErrorSchema.safeParse(payload);
  if (parsed.success) {
    return new FactroveApiError(parsed.data.error.message, {
      status,
      code: parsed.data.error.code
    });
  }
  return new FactroveApiError(`Request failed with HTTP ${status}`, {
    status,
    code: "INVALID_RESPONSE"
  });
}

export function createFactroveClient(options: FactroveClientOptions): FactroveClient {
  const root = `${normalizeBaseUrl(options.baseUrl)}${API_PREFIX}`;
  const requestFetch = options.fetch ?? globalThis.fetch;

  async function request<T>(path: string, init: RequestInit, schema: { parse(value: unknown): T }): Promise<T> {
    let response: Response;
    try {
      response = await requestFetch(`${root}${path}`, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network request failed";
      throw new FactroveApiError(message, { status: null, code: "NETWORK_ERROR" });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) throw parseErrorPayload(null, response.status);
      throw new FactroveApiError("The API returned an invalid JSON response", {
        status: response.status,
        code: "INVALID_RESPONSE"
      });
    }

    if (!response.ok) throw parseErrorPayload(payload, response.status);
    try {
      return schema.parse(payload);
    } catch {
      throw new FactroveApiError("The API response did not match the expected format", {
        status: response.status,
        code: "INVALID_RESPONSE"
      });
    }
  }

  return {
    getContext: () => request("/context", { method: "GET" }, contextEnvelopeSchema),
    uploadArtifact: ({ file, filename, accessType }) => {
      const form = new FormData();
      form.append("file", file, filename);
      if (accessType !== undefined) form.append("accessType", accessType);
      return request("/artifacts", { method: "POST", body: form }, artifactEnvelopeSchema);
    },
    listArtifacts: ({ view = "mine" } = {}) => {
      const query = new URLSearchParams({ view });
      return request(`/artifacts?${query.toString()}`, { method: "GET" }, artifactListEnvelopeSchema);
    },
    getArtifact: (id) => request(`/artifacts/${encodeURIComponent(id)}`, { method: "GET" }, artifactEnvelopeSchema)
  };
}
