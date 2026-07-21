/**
 * Convenience re-exports from the generic registry.
 *
 * This file exists so that files referencing `registry/resolveDescriptor.js`
 * get the same API as the old `#sharedServices/importTargetRegistry.service`
 * but without any OfferBerries domain model coupling.
 *
 * The registry itself lives in `registerTarget.js` (write side) and is read
 * through the exported getters below (read side).
 */

export {
  getTargetDescriptor,
  listTargetModules,
  listTargetEntities,
  registerTarget,
  resetRegistry,
} from "./registerTarget.js";
