/**
 * ConnectionResolver contract tests.
 *
 * Every ConnectionResolver implementation must pass these exact same assertions.
 */

import { describe, it, expect } from "@jest/globals";

/**
 * Run contract tests against a ConnectionResolver implementation.
 * @param {string} label
 * @param {import("../../topology/ConnectionResolver.js").ConnectionResolver} resolver
 */
export function runConnectionResolverContract(label, resolver) {
  describe(`ConnectionResolver contract: ${label}`, () => {
    it("resolve returns conn and storageMode", async () => {
      const result = await resolver.resolve("test-tenant-id");
      expect(result).toHaveProperty("conn");
      expect(result).toHaveProperty("storageMode");
      expect(typeof result.storageMode).toBe("string");
    });

    it("hasOwnDatabase returns boolean", () => {
      expect(typeof resolver.hasOwnDatabase("shared")).toBe("boolean");
      expect(typeof resolver.hasOwnDatabase("dedicated")).toBe("boolean");
      expect(typeof resolver.hasOwnDatabase("byod")).toBe("boolean");
    });

    it("hasOwnDatabase returns true for dedicated and byod", () => {
      expect(resolver.hasOwnDatabase("dedicated")).toBe(true);
      expect(resolver.hasOwnDatabase("byod")).toBe(true);
    });

    it("hasOwnDatabase returns false for shared and local", () => {
      expect(resolver.hasOwnDatabase("shared")).toBe(false);
      // local mode does not have its own database
    });
  });
}
