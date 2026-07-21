/**
 * Generic target descriptor registry.
 *
 * Provides the write side (registerTarget) and read side (getTargetDescriptor,
 * listTargetModules, listTargetEntities) of the target descriptor system.
 * The engine's core/ and orchestration/ code depends ONLY on this file and
 * resolveDescriptor.js — never on concrete OfferBerries model imports.
 *
 * @module registry/registerTarget
 */

/** @type {Map<string, object>} */
const _registry = new Map();

/**
 * Register a target descriptor.
 *
 * @param {object} descriptor - Must conform to the TargetDescriptor contract
 * @param {string} descriptor.namespace
 * @param {string} descriptor.entityKey
 * @returns {void}
 */
export function registerTarget(descriptor) {
  if (!descriptor.namespace || !descriptor.entityKey) {
    throw new Error(
      `registerTarget requires both "namespace" and "entityKey". Received: ${JSON.stringify({ namespace: descriptor.namespace, entityKey: descriptor.entityKey })}`
    );
  }
  const key = `${descriptor.namespace}:${descriptor.entityKey}`;
  if (_registry.has(key)) {
    throw new Error(`Target descriptor already registered for "${key}"`);
  }
  _registry.set(key, descriptor);
}

/**
 * Retrieve a registered target descriptor.
 *
 * @param {string} namespace
 * @param {string} entityKey
 * @returns {object}
 * @throws {Error} 404-style error if not found
 */
export function getTargetDescriptor(namespace, entityKey) {
  const key = `${namespace}:${entityKey}`;
  const descriptor = _registry.get(key);
  if (!descriptor) {
    const error = new Error(
      `No target descriptor registered for namespace "${namespace}", entity "${entityKey}". ` +
      `Registered: ${listAllKeys().join(", ") || "none"}`
    );
    error.statusCode = 400;
    throw error;
  }
  return descriptor;
}

/**
 * List all registered namespace names.
 * @returns {string[]}
 */
export function listTargetModules() {
  const namespaces = new Set();
  for (const key of _registry.keys()) {
    namespaces.add(key.split(":")[0]);
  }
  return [...namespaces];
}

/**
 * List all entities registered under a namespace.
 * @param {string} namespace
 * @returns {Array<{entityKey: string, label?: string, icon?: string, destination?: string, fields?: Array}>}
 */
export function listTargetEntities(namespace) {
  const entities = [];
  for (const [key, descriptor] of _registry.entries()) {
    const [ns, ek] = key.split(":");
    if (ns === namespace) {
      entities.push({
        entityKey: ek,
        label: descriptor.label,
        icon: descriptor.icon,
        destination: descriptor.destination,
        fields: descriptor.fields,
      });
    }
  }
  return entities;
}

function listAllKeys() {
  return [..._registry.keys()];
}

/**
 * Clear all registered targets (for testing).
 */
export function resetRegistry() {
  _registry.clear();
}
