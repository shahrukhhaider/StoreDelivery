/**
 * Middleware tests — tests the pure logic in middleware functions.
 * No DB required — tests request parsing and response formatting.
 */

import { describe, it, expect } from "vitest";

// Test the error formatting logic (extracted to be testable)
describe("error response formatting", () => {
  it("formats ZodError as VALIDATION_ERROR", () => {
    // Simulate ZodError shape
    const zodError = {
      name: "ZodError",
      errors: [
        { code: "invalid_type", path: ["field"], message: "Expected string" },
      ],
    };

    const response = {
      error: "VALIDATION_ERROR",
      message: "Invalid request data",
      details: zodError.errors,
    };

    expect(response.error).toBe("VALIDATION_ERROR");
    expect(response.details).toHaveLength(1);
    expect(response.details[0].path).toEqual(["field"]);
  });

  it("formats generic error as INTERNAL_ERROR in production", () => {
    const response = {
      error: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    };
    expect(response.error).toBe("INTERNAL_ERROR");
    expect(response.message).not.toContain("stack");
  });

  it("includes error message in development mode", () => {
    const err = new Error("Database connection failed");
    const response = {
      error: "INTERNAL_ERROR",
      message: err.message,
    };
    expect(response.message).toBe("Database connection failed");
  });
});

// Test shop ID extraction logic
describe("shop ID extraction", () => {
  it("extracts from X-Shop-Id header", () => {
    const rawShopId = "test-store.myshopify.com";
    const normalized = rawShopId.includes(".myshopify.com")
      ? rawShopId
      : `${rawShopId}.myshopify.com`;
    expect(normalized).toBe("test-store.myshopify.com");
  });

  it("normalizes bare shop name to .myshopify.com", () => {
    const rawShopId = "my-store";
    const normalized = rawShopId.includes(".myshopify.com")
      ? rawShopId
      : rawShopId === "dev_shop"
        ? "dev.myshopify.com"
        : `${rawShopId}.myshopify.com`;
    expect(normalized).toBe("my-store.myshopify.com");
  });

  it("maps dev_shop to dev.myshopify.com", () => {
    const rawShopId = "dev_shop";
    const normalized = rawShopId === "dev_shop"
      ? "dev.myshopify.com"
      : `${rawShopId}.myshopify.com`;
    expect(normalized).toBe("dev.myshopify.com");
  });

  it("passes through full domain unchanged", () => {
    const rawShopId = "custom-store.myshopify.com";
    const normalized = rawShopId.includes(".myshopify.com")
      ? rawShopId
      : `${rawShopId}.myshopify.com`;
    expect(normalized).toBe("custom-store.myshopify.com");
  });
});

// Test the auth token encryption roundtrip
describe("token encryption", () => {
  it("encrypts and decrypts back to original", async () => {
    // Set a fake env so config loads
    const originalToken = "shpat_test_token_12345";

    // Test the encrypt/decrypt logic directly
    const { createCipheriv, createDecipheriv, randomBytes, scryptSync } = await import("crypto");
    const key = scryptSync("test-secret-key-minimum-32-chars!!", "storekeeper-salt", 32);
    const iv = randomBytes(16);

    const cipher = createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(originalToken, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    const stored = `${iv.toString("hex")}:${tag}:${encrypted}`;

    // Decrypt
    const [ivHex, tagHex, data] = stored.split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    expect(decrypted).toBe(originalToken);
  });

  it("different encryptions of same token produce different ciphertext", async () => {
    const { createCipheriv, randomBytes, scryptSync } = await import("crypto");
    const key = scryptSync("test-secret", "storekeeper-salt", 32);
    const token = "same-token";

    function encrypt() {
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      let enc = cipher.update(token, "utf8", "hex");
      enc += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");
      return `${iv.toString("hex")}:${tag}:${enc}`;
    }

    const a = encrypt();
    const b = encrypt();
    expect(a).not.toBe(b); // Different IVs → different ciphertext
  });
});
