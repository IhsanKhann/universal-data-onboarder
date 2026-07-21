/**
 * Default (noop) middleware for standalone/development mode.
 *
 * The engine's uploadRoutes.js was extracted from OfferBerries, which used
 * domain-specific auth/middleware (authenticate, authorize, validateParams,
 * etc.). In standalone mode these are replaced with noop implementations
 * that allow all requests through.
 *
 * Production deployments should replace these with real implementations
 * before exposing the routes publicly.
 */

/**
 * Noop auth — just calls next(). In production, validate JWT/session here.
 */
export function authenticate(req, _res, next) {
  req.user = req.user || { _id: "standalone-actor" };
  next();
}

/**
 * Noop authorize — always passes. In production, check permissions against
 * the route's required permission.
 */
export function authorize(_permission) {
  return (_req, _res, next) => next();
}

/**
 * Noop param validation — just calls next(). In production, validate
 * req.params against a Joi schema.
 */
export function validateParams(_schema) {
  return (req, _res, next) => {
    req.validatedParams = req.params;
    next();
  };
}

/**
 * Noop query validation — just calls next(). In production, validate
 * req.query against a Joi schema.
 */
export function validateQuery(_schema) {
  return (req, _res, next) => {
    req.validatedQuery = req.query;
    next();
  };
}

/**
 * Noop body validation — just calls next(). In production, validate
 * req.body against a Joi schema with stripUnknown.
 */
export function validationMiddleware(_schema) {
  return (req, _res, next) => {
    req.validatedBody = req.body;
    next();
  };
}

/**
 * Default permissions object (all strings).
 */
export const PERMISSIONS = {
  MANAGE_MIGRATIONS: "manage_migrations",
  VIEW_MIGRATIONS: "view_migrations",
};

/**
 * Multer upload factory — creates a single-file multer uploader with
 * the given byte limit.
 */
import multer from "multer";

export function makeUploader(maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
  });
}

/**
 * Resolve import targets for modules — standalone fallback returns null
 * (all targets allowed).
 */
export function resolveImportTargetsForModules(_modules) {
  return null;
}
