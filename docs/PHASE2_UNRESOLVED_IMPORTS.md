# Phase 2 — Unresolved Imports (Design Decisions Required)

## Files with OfferBerries-specific imports that could not be fully decoupled

### 1. `registry/importTargetRegistry.service.js` — OfferBerries domain model imports

This 1392-line file contains 13 target descriptors that import directly from
OfferBerries models and services (party.service, role.service, orgUnit.service,
all 6 facades: `#hr`, `#finance`, `#biz`, `#communication`). These are:

- `#sharedServices/party.service` → `createParty`
- `#sharedModels/Party.model` → `getPartyModel`
- `#sharedModels/PartyRoleDefinition.model` → `getPartyRoleDefinitionModel`
- `#sharedServices/role.service` → `createRole`
- `#sharedServices/orgUnit.service` → `createOrgUnit`
- `#sharedModels/OrgUnit` → `getOrgUnitModel`
- `#sharedModels/Role.model` → `getRoleModel`
- `#sharedModels/BranchModel` → `getBranchModel`
- `#sharedModels/FinalizedEmployees.model` → `getFinalizedEmployeeModel`
- `#sharedModels/RoleAssignment.model` → `getRoleAssignmentModel`
- `#sharedModels/DocumentType.model` → `getDocumentTypeModel`
- `#hr` facade → `registerEmployee`, `assignEmployeePost`, etc.
- `#finance` facade → `getSalaryBreakupModel`, `createInvoice`, etc.
- `#biz` facade → `getRiderModel`, `getCycleModel`, `getOrderModel`
- `#communication` facade → `createDocumentType`

**Resolution Plan (Phase 3):** Each descriptor block should be extracted into
`examples/offerberries-targets/<entityKey>.target.js`, where OfferBerries
domain imports are explicitly allowed. The generic registry will only contain
the `registerTarget()` / `resolveDescriptor()` / `listTargetEntities()` API.

### 2. `http/uploadRoutes.js` — OfferBerries middleware & permission imports

- `#middlewares/authMiddlewares` → `authenticate`, `authorize`
- `#middlewares/validation.middleware` → `validationMiddleware`, `validateParams`, `validateQuery`
- `#middlewares/mutlerMiddleware` → `makeUploader`
- `#middlewares/requireMigrationTarget` → `requireMigrationTarget`
- `#configs/permissions` → `PERMISSIONS`
- `#services/platform/wizardStageCatalog` → `resolveImportTargetsForModules`
- `#shared` → `MODULE_LABELS`

**Resolution:** `authenticate/authorize` are Express middleware hooks that
consumers must provide. `resolveImportTargetsForModules` is replaced with a
registry-based lookup (partially done). Multer's `makeUploader` is replaced
with direct `multer()` config.

### 3. `http/b2bUploadRoutes.js` — B2B auth middleware

- `#middlewares/b2bAuth` → `b2bInboundAuth`, `requireB2BScope`
- `#utils/b2bEnvelope` → `b2bError`

**Resolution:** B2B auth is consumer-provided middleware. The error envelope
is replaced with an inline generic JSON envelope.

### 4. `worker/cloudRunEntrypoint.js` — Control plane & encryption

- `#conn/controlPlane` → `getControlPlaneConnection`
- `#platformModels/Tenant.model` → `getTenantModel`, `hasOwnDatabase`
- `#utils/encryption` → `decrypt`

**Resolution:** These are replaced by the `ConnectionResolver` interface
(partially done). The tenant model and encryption are adapter concerns.

### 5. `worker/bullmqCommitWorker.js` — Tenant DB resolution

- `#conn/registry` → `resolveTenantDB`

**Resolution:** Replaced by `singleConnectionResolver.resolve()` (done).

## Summary

- **39 #-alias imports** across Phase 2 files
- **~25 resolved** via relative imports to sibling files or interface stubs
- **~14 OfferBerries-specific** (all in `registry/` and `http/`)
  - 12 in `registry/importTargetRegistry.service.js` → Phase 3 extraction
  - 2 in `http/` middleware → consumer provides their own
