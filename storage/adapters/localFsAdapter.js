/**
 * Local-filesystem StorageAdapter — reads/writes files from a local directory.
 * Suitable for the testbed and single-server deployments.
 *
 * @type {import("../StorageAdapter.js").StorageAdapter}
 */
export const localFsStorageAdapter = {
  async upload(file, destPrefix = "uploads") {
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.join(process.env.LOCAL_STORAGE_DIR || "./tmp/uploads", destPrefix);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, file.originalname || `import-${Date.now()}`);
    fs.copyFileSync(file.path, dest);
    return { publicId: dest, secureUrl: dest, url: dest };
  },

  async download(bucketName, objectPath, destPath) {
    const fs = await import("fs");
    const path = await import("path");
    if (!destPath) {
      const basename = objectPath.split("/").pop() || `import-${Date.now()}`;
      destPath = `/tmp/${basename}`;
    }
    const src = path.join(bucketName, objectPath);
    if (!fs.existsSync(src)) {
      throw new Error(`File not found: ${src}`);
    }
    fs.copyFileSync(src, destPath);
    return destPath;
  },

  async generateUploadUrl(tenantId, importJobId, fileName) {
    const objectPath = `${tenantId}/${importJobId}/${fileName}`;
    return { uploadUrl: `local://${objectPath}`, objectPath, bucketName: process.env.LOCAL_STORAGE_DIR || "./tmp/uploads" };
  },

  async verifyUpload(bucketName, objectPath) {
    const fs = await import("fs");
    const path = await import("path");
    const fullPath = path.join(bucketName, objectPath);
    if (!fs.existsSync(fullPath)) return { exists: false };
    const stat = fs.statSync(fullPath);
    return { exists: true, sizeBytes: stat.size };
  },

  async triggerProcessingJob(tenantId, importJobId, opts) {
    return { executionName: `local-${tenantId}-${importJobId}` };
  },
};
