/**
 * StorageAdapter interface — upload, download, and manage import files.
 *
 * Replaces the old `#sharedServices/fileStorage.service` (Cloudinary) and
 * `#sharedServices/gcsStorage.service` imports from OfferBerries.
 *
 * @typedef {Object} StorageAdapter
 * @property {(file: {path: string, originalname?: string}, destPrefix?: string) => Promise<{publicId?: string, secureUrl?: string, url?: string}>} upload
 *   Upload a local file to storage. Returns the uploaded file's identifiers.
 * @property {(bucketName: string, objectPath: string, destPath?: string) => Promise<string>} download
 *   Download a file from storage to a local path. Returns the local path.
 * @property {(tenantId: string, importJobId: string, fileName: string) => Promise<{uploadUrl: string, objectPath: string, bucketName: string}>} generateUploadUrl
 *   Generate a pre-signed upload URL for direct browser-to-storage uploads.
 * @property {(bucketName: string, objectPath: string) => Promise<{exists: boolean, sizeBytes?: number}>} verifyUpload
 *   Verify a file exists in storage and return its metadata.
 * @property {(tenantId: string, importJobId: string, opts?: object) => Promise<{executionName: string}>} triggerProcessingJob
 *   Trigger a processing job (e.g. Cloud Run) for the uploaded file.
 */

export { localFsStorageAdapter } from "./adapters/localFsAdapter.js";
export { gcsStorageAdapter } from "./adapters/gcsAdapter.js";
