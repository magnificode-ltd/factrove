import { z } from "zod";
import { apiErrorCatalog } from "./errors.js";
import { httpOperations, namedSchemas, type HttpOperation, type HttpSecurity } from "./http.js";
import { apiErrorSchema } from "./index.js";

export type OpenApiDocument = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  jsonSchemaDialect: string;
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    headers: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
};

const OPENAPI_VERSION = "3.1.0";
const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export function buildOpenApiDocument(options?: { version?: string }): OpenApiDocument {
  const schemas: Record<string, unknown> = {
    ApiError: apiErrorComponent(),
    ApiErrorCode: {
      type: "string",
      enum: apiErrorCatalog.map((entry) => entry.code),
      description: "Product JSON error codes. Better Auth routes may use a different body."
    }
  };

  for (const [name, schema] of Object.entries(namedSchemas)) {
    Object.assign(schemas, collectJsonSchemas(name, schema));
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of httpOperations) {
    const pathItem = paths[operation.path] ?? {};
    pathItem[operation.method] = operationToPathItem(operation);
    paths[operation.path] = pathItem;
  }

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "Factrove HTTP API",
      version: options?.version ?? "0.1.0",
      description: [
        "Generated from `@factrove/contracts` schemas and the HTTP operation catalog.",
        "Product routes live under `/api/v1`. Auth and API key management live under `/api/auth`.",
        "Do not treat this file as hand-written. Run `pnpm docs:openapi` after contract or route-catalog changes."
      ].join(" ")
    },
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    servers: [
      { url: "http://localhost:3001", description: "Local development API origin" },
      { url: "https://api.example.com", description: "Example self-hosted API origin" }
    ],
    tags: [
      { name: "Health", description: "Process liveness." },
      { name: "Auth", description: "Sessions and API keys." },
      { name: "Artifacts", description: "Upload, list, detail, and content." },
      { name: "Shares", description: "Owner public-link and password controls." },
      { name: "Public", description: "Anonymous share detail, unlock, and HTML." }
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Factrove API key, usually prefixed `ftrv_`. Send `Authorization: Bearer <key>`. Product routes do not accept `x-api-key` as a credential. A present Authorization header that is not a valid key does not fall back to the session cookie."
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description:
            "Better Auth session cookie from email/password sign-in. The cookie may use a `__Secure-` or `__Host-` prefix depending on the origin. Host-only unless AUTH_COOKIE_DOMAIN is set."
        },
        accessGrant: {
          type: "apiKey",
          in: "query",
          name: "access",
          description:
            "Short-lived HMAC grant for HTML content in the viewer iframe. HTML only, at most five minutes. A present Authorization or x-api-key header disables the grant. Markdown ignores it. A valid grant returns 200 without a session cookie or bearer key."
        }
      },
      headers: {
        RetryAfter: {
          description:
            "Seconds to wait before retrying. The API sets this when an `ApiErrorException` includes `retryAfterSeconds`: share-lock 429 RATE_LIMITED and 503 UNLOCK_UNAVAILABLE. Public-view 429 and Markdown 503 CONVERSION_UNAVAILABLE do not set it.",
          schema: { type: "integer", minimum: 1 }
        }
      },
      schemas
    }
  };
}

function apiErrorComponent(): Record<string, unknown> {
  const converted = zodToJsonSchema(apiErrorSchema);
  const codeEnum = apiErrorCatalog.map((entry) => entry.code);
  return {
    ...converted,
    description:
      "Product error envelope. Better Auth `/api/auth` routes may return a different JSON shape.",
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        additionalProperties: false,
        properties: {
          code: {
            type: "string",
            enum: codeEnum,
            description: apiErrorCatalog
              .map((entry) => `${catalogStatuses(entry).join("/")} ${entry.code}: ${entry.description}`)
              .join(" ")
          },
          message: { type: "string" }
        }
      }
    }
  };
}

function operationToPathItem(operation: HttpOperation): Record<string, unknown> {
  const parameters: Record<string, unknown>[] = [];
  for (const parameter of operation.pathParameters ?? []) {
    parameters.push({
      name: parameter.name,
      in: "path",
      required: true,
      description: parameter.description,
      schema: zodToJsonSchema(parameter.schema)
    });
  }
  for (const parameter of operation.queryParameters ?? []) {
    parameters.push({
      name: parameter.name,
      in: "query",
      required: parameter.required,
      description: parameter.description,
      schema: zodToJsonSchema(parameter.schema)
    });
  }
  for (const parameter of operation.headerParameters ?? []) {
    parameters.push({
      name: parameter.name,
      in: "header",
      required: parameter.required,
      description: parameter.description,
      schema: { type: "string" }
    });
  }

  const responses: Record<string, unknown> = {};
  for (const [status, response] of Object.entries(operation.responses)) {
    const headers: Record<string, unknown> = {};
    for (const header of response.headers ?? []) {
      if (header.name === "Retry-After") {
        headers["Retry-After"] = { $ref: "#/components/headers/RetryAfter" };
      } else {
        headers[header.name] = { description: header.description, schema: { type: "string" } };
      }
    }
    const contentTypes = responseContentTypes(response);
    const media =
      contentTypes.length === 0
        ? undefined
        : Object.fromEntries(
            contentTypes.map((contentType) => [
              contentType,
              {
                schema: response.schemaName
                  ? { $ref: `#/components/schemas/${response.schemaName}` }
                  : response.schema
                    ? zodToJsonSchema(response.schema)
                    : contentType === "text/html" || contentType === "text/markdown"
                      ? { type: "string" }
                      : { type: "object" }
              }
            ])
          );
    responses[status] = {
      description: response.description,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(media ? { content: media } : {})
    };
  }

  const body = operation.requestBody;
  let requestBody: Record<string, unknown> | undefined;
  if (body) {
    requestBody = {
      required: body.required,
      description: body.description,
      content: {
        [body.contentType]: {
          schema: { $ref: `#/components/schemas/${body.schemaName}` }
        }
      }
    };
  }

  return {
    operationId: operation.operationId,
    tags: [...operation.tags],
    summary: operation.summary,
    description: operation.description,
    security: securityRequirement(operation.security),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses
  };
}

function securityRequirement(security: HttpSecurity): Record<string, string[]>[] | undefined {
  if (security === "none") {
    return [];
  }
  if (security === "session") {
    return [{ sessionCookie: [] }];
  }
  if (security === "sessionOrApiKeyOrContentGrant") {
    return [{ bearerAuth: [] }, { sessionCookie: [] }, { accessGrant: [] }];
  }
  return [{ bearerAuth: [] }, { sessionCookie: [] }];
}

function responseContentTypes(response: { contentType?: string; contentTypes?: readonly string[]; schemaName?: string; schema?: z.ZodType }): string[] {
  if (response.contentTypes && response.contentTypes.length > 0) {
    return [...response.contentTypes];
  }
  if (response.contentType) {
    return [response.contentType];
  }
  if (response.schemaName || response.schema) {
    return ["application/json"];
  }
  return [];
}

function catalogStatuses(entry: { status: number | readonly number[] }): number[] {
  return typeof entry.status === "number" ? [entry.status] : [...entry.status];
}

function collectJsonSchemas(name: string, schema: z.ZodType): Record<string, unknown> {
  const converted = zodToJsonSchema(schema);
  const defs = asRecord(converted.$defs);
  const rest = { ...converted };
  delete rest.$defs;
  delete rest.$schema;
  if (name === "UploadForm") {
    const properties = asRecord(rest.properties);
    const file = asRecord(properties.file);
    if (Object.keys(file).length > 0) {
      properties.file = { ...file, format: "binary", contentMediaType: "text/html" };
      rest.properties = properties;
    }
  }
  const collected: Record<string, unknown> = { [name]: rest };
  for (const [defName, defSchema] of Object.entries(defs)) {
    if (collected[defName] === undefined) {
      collected[defName] = defSchema;
    }
  }
  return collected;
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any"
  });
  if (typeof converted !== "object" || converted === null || Array.isArray(converted)) {
    return { type: "object" };
  }
  const record = { ...(converted as Record<string, unknown>) };
  delete record.$schema;
  return record;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
