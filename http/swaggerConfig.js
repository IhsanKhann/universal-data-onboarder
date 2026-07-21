/**
 * Universal Data Onboarding Engine — Swagger/OpenAPI configuration.
 *
 * Mounted at GET /docs by the server. Defines every REST endpoint exposed
 * by http/uploadRoutes.js.
 *
 * Usage:
 *   import { setupSwagger } from "./http/swaggerConfig.js";
 *   app.use("/docs", setupSwagger(app));
 */

import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const OPENAPI_VERSION = "3.0.3";
const API_VERSION = "0.1.0";

const swaggerDefinition = {
  openapi: OPENAPI_VERSION,
  info: {
    title: "Universal Data Onboarding Engine",
    version: API_VERSION,
    description: `Streaming-safe, adapter-driven data onboarding pipeline.

Accepts CSV, JSON, XLSX, and SQL dump files, parses them server-side,
maps columns to target entity fields, validates rows, and commits
idempotently via injected TargetDescriptors.

**Adapters are swappable via env vars** — this API works identically
with Mongoose/in-memory job stores, BullMQ/in-memory queues,
GCS/local-fs/S3 storage, and single/multi-tenant connection resolvers.

See the [Architecture Guide](https://github.com/IhsanKhann/universal-data-onboarder#readme)
for adapter configuration.`,
    contact: {
      name: "Engineering",
      url: "https://github.com/IhsanKhann/universal-data-onboarder",
    },
    license: {
      name: "MIT",
      url: "https://github.com/IhsanKhann/universal-data-onboarder/blob/main/LICENSE",
    },
  },
  servers: [
    { url: "/", description: "Development server" },
  ],
  tags: [
    { name: "Imports", description: "File upload, mapping, validation, and commit lifecycle" },
    { name: "Sessions", description: "Multi-job migration sessions with dependency ordering" },
    { name: "Targets", description: "Entity schema discovery for target descriptors" },
    { name: "Mappings", description: "Column→field mapping profiles" },
  ],
  components: {
    schemas: {
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", enum: [false] },
          message: { type: "string" },
          code: { type: "string", nullable: true },
          upgrade: { type: "object", nullable: true },
          guardrail: { type: "object", nullable: true },
        },
      },
      ImportJob: {
        type: "object",
        properties: {
          _id: { type: "string", description: "MongoDB ObjectId" },
          tenantId: { type: "string" },
          module: { type: "string" },
          sourceFormat: { type: "string", enum: ["csv", "xlsx", "json", "sql"] },
          status: {
            type: "string",
            enum: [
              "pending_upload", "uploaded", "guardrail_rejected", "staged",
              "mapped", "validated", "committing", "completed",
              "completed_with_errors", "commit_failed", "failed",
            ],
          },
          totalRows: { type: "integer" },
          validCount: { type: "integer" },
          invalidCount: { type: "integer" },
          fileName: { type: "string" },
          fileSizeBytes: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      TargetEntity: {
        type: "object",
        properties: {
          entityKey: { type: "string" },
          label: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                label: { type: "string" },
                type: { type: "string", enum: ["string", "number", "boolean", "date", "enum"] },
                required: { type: "boolean" },
                options: { type: "array", items: { type: "string" }, description: "For enum types" },
              },
            },
          },
        },
      },
      ModuleGroup: {
        type: "object",
        properties: {
          module: { type: "string" },
          label: { type: "string" },
          entities: { type: "array", items: { $ref: "#/components/schemas/TargetEntity" } },
        },
      },
      Session: {
        type: "object",
        properties: {
          _id: { type: "string" },
          tenantId: { type: "string" },
          label: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "processing", "completed", "completed_with_errors", "failed"],
          },
          jobs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                importJobId: { type: "string" },
                module: { type: "string" },
                entityKey: { type: "string" },
                status: { type: "string" },
              },
            },
          },
          executionOrder: {
            type: "array",
            items: { type: "string" },
            description: "Topologically-sorted importJobIds",
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
    parameters: {
      importId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
        description: "Import job ObjectId",
      },
      sessionId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
        description: "Session ObjectId",
      },
      rowId: {
        name: "rowId",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[0-9a-fA-F]{24}$" },
        description: "Staged record row ObjectId",
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: ["./http/uploadRoutes.js"],
};

/**
 * Factory: wrap the swagger-jsdoc spec into swagger-ui-express middleware.
 * @param {import("express").Express} app
 */
export function setupSwagger(app) {
  const openapiSpec = swaggerJsdoc(options);
  return swaggerUi.serveWithOptions({ redirect: false });
}

/** Raw spec for downstream tools (redoc, codegen, etc.). */
export function getOpenapiSpec() {
  return swaggerJsdoc(options);
}

export default swaggerUi.setup(swaggerJsdoc(options));
