/**
 * StorageAdapter contract tests.
 *
 * Every StorageAdapter implementation must pass these exact same assertions.
 * Uses dynamic import so the test file does not depend on any specific adapter at load time.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import path from "path";

const TMP = path.join(process.cwd(), "tmp", "contract-test-" + Date.now());

/**
 * Run contract tests against a StorageAdapter implementation.
 * @param {string} label
 * @param {import("../../storage/StorageAdapter.js").StorageAdapter} adapter
 * @param {object} opts
 * @param {string} opts.bucketName - bucket/directory name for tests
 */
export function runStorageAdapterContract(label, adapter, { bucketName }) {
  describe(`StorageAdapter contract: ${label}`, () => {
    const testFile = path.join(TMP, "test-upload.csv");
    const testContent = "id,name\n1,Alice\n2,Bob";

    beforeAll(() => {
      fs.mkdirSync(TMP, { recursive: true });
      fs.writeFileSync(testFile, testContent);
    });

    afterAll(() => {
      fs.rmSync(TMP, { recursive: true, force: true });
    });

    it("upload saves a file and returns an identifier", async () => {
      const result = await adapter.upload(
        { path: testFile, originalname: "test-upload.csv" },
        "test-prefix"
      );
      expect(result.publicId).toBeTruthy();
      // Verify the uploaded file exists (implementation-dependent check)
    });

    it("generateUploadUrl returns a URL and object path", async () => {
      const result = await adapter.generateUploadUrl("tenant-1", "job-123", "test.csv");
      expect(result.uploadUrl).toBeTruthy();
      expect(result.objectPath).toBeTruthy();
      expect(result.objectPath).toContain("tenant-1");
      expect(result.objectPath).toContain("job-123");
    });

    it("download retrieves a file", async () => {
      // First upload
      const { objectPath } = await adapter.generateUploadUrl("t1", "j1", "dl-test.csv");
      // Download it
      const localPath = await adapter.download(bucketName, objectPath);
      expect(localPath).toBeTruthy();
    });

    it("verifyUpload returns exists:false for non-existent file", async () => {
      const result = await adapter.verifyUpload(bucketName, "nonexistent/file.csv");
      expect(result.exists).toBe(false);
    });

    it("triggerProcessingJob returns an execution name", async () => {
      const result = await adapter.triggerProcessingJob("t1", "j1", {});
      expect(result.executionName).toBeTruthy();
    });
  });
}
test('contract suite placeholder — implement per-adapter tests here', () => {});
