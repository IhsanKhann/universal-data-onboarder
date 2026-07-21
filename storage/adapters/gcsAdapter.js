/**
 * Google Cloud Storage (GCS) StorageAdapter.
 *
 * Uses @google-cloud/storage for upload, download, pre-signed URLs,
 * HEAD verification, and Cloud Run Job triggering.
 *
 * @type {import("../StorageAdapter.js").StorageAdapter}
 */
export const gcsStorageAdapter = {
  async upload(file, destPrefix = "migration-imports") {
    const { Storage } = await import("@google-cloud/storage");
    const path = await import("path");
    const storage = new Storage();
    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) throw new Error("GCS_BUCKET_NAME is required for gcsStorageAdapter");
    const destPath = `${destPrefix}/${file.originalname || `import-${Date.now()}`}`;
    await storage.bucket(bucketName).upload(file.path, { destination: destPath });
    return { publicId: destPath, secureUrl: `gs://${bucketName}/${destPath}`, url: `https://storage.googleapis.com/${bucketName}/${destPath}` };
  },

  async download(bucketName, objectPath, destPath) {
    const { Storage } = await import("@google-cloud/storage");
    const path = await import("path");
    const storage = new Storage();
    if (!destPath) {
      const basename = objectPath.split("/").pop() || `import-${Date.now()}`;
      destPath = `/tmp/${basename}`;
    }
    await storage.bucket(bucketName).file(objectPath).download({ destination: destPath });
    return destPath;
  },

  async generateUploadUrl(tenantId, importJobId, fileName) {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) throw new Error("GCS_BUCKET_NAME is required for gcsStorageAdapter");
    const objectPath = `${tenantId}/${importJobId}/${fileName}`;
    const [uploadUrl] = await storage.bucket(bucketName).file(objectPath).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
      contentType: "application/octet-stream",
    });
    return { uploadUrl, objectPath, bucketName };
  },

  async verifyUpload(bucketName, objectPath) {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const [exists] = await storage.bucket(bucketName).file(objectPath).exists();
    if (!exists) return { exists: false };
    const [metadata] = await storage.bucket(bucketName).file(objectPath).getMetadata();
    return { exists: true, sizeBytes: Number(metadata.size) };
  },

  async triggerProcessingJob(tenantId, importJobId, opts = {}) {
    const { v2 } = await import("@google-cloud/run");
    const { default: path } = await import("path");
    const jobsClient = new v2.JobsClient();
    const parent = `projects/${process.env.GCP_PROJECT_ID || ""}/locations/${process.env.GCP_REGION || "us-central1"}/jobs/${process.env.CLOUD_RUN_JOB || ""}`;
    const [operation] = await jobsClient.runJob({ name: parent });
    const [execution] = await operation.promise();
    return { executionName: execution.name };
  },
};
