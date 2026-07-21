/**
 * Minimal standalone Express server that mounts the onboarder upload routes
 * + Swagger UI. Useful for development, demo, and documentation.
 *
 * Usage:
 *   export QUEUE_ADAPTER=in-memory
 *   export STORAGE_ADAPTER=local-fs
 *   export CONNECTION_ADAPTER=single
 *   node http/swaggerServer.js
 *
 * Then open http://localhost:3099/docs for Swagger UI.
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";
import uploadRoutes from "./uploadRoutes.js";
import { getOpenapiSpec, setupSwagger } from "./swaggerConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3099;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());

// ── Swagger UI at /docs ───────────────────────────────────────────────────
const openapiSpec = getOpenapiSpec();
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "Universal Data Onboarding Engine — API Docs",
}));

// Raw JSON spec at /docs/openapi.json (useful for code generation tools)
app.get("/docs/openapi.json", (_req, res) => {
  res.json(openapiSpec);
});

// ── Upload routes ──────────────────────────────────────────────────────────
// In standalone mode, tenantId is read from env or defaults to "standalone".
app.use("/api", (req, _res, next) => {
  req.tenantId = process.env.TENANT_ID || "standalone";
  req.db = null; // Will be resolved by the connection adapter
  next();
});
app.use("/api", uploadRoutes);

// ── Health ─────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[onboarder] Swagger UI: http://localhost:${PORT}/docs`);
  console.log(`[onboarder] API base:   http://localhost:${PORT}/api`);
  console.log(`[onboarder] Health:     http://localhost:${PORT}/health`);
});

export default app;
