import { describe, it, expect } from "vitest";
import {
  DEFAULT_RATE_LIMITS,
  RateLimitError,
  ConfigurationError,
  ValidationError,
} from "./index";

describe("Rate Limit Types", () => {
  describe("Default Rate Limits", () => {
    it("should have upload-images configuration", () => {
      expect(DEFAULT_RATE_LIMITS["upload-images"]).toBeDefined();
      expect(DEFAULT_RATE_LIMITS["upload-images"].default).toEqual({
        windowMs: 7200000, // 2 hours
        maxRequests: 2,
      });
    });

    it("should have api-general configuration", () => {
      expect(DEFAULT_RATE_LIMITS["api-general"]).toBeDefined();
      expect(DEFAULT_RATE_LIMITS["api-general"].default).toEqual({
        windowMs: 3600000, // 1 hour
        maxRequests: 3,
      });
    });

    it("should have auth configuration", () => {
      expect(DEFAULT_RATE_LIMITS["auth"]).toBeDefined();
      expect(DEFAULT_RATE_LIMITS["auth"].default).toEqual({
        windowMs: 900000, // 15 minutes
        maxRequests: 5,
      });
    });

    it("should have tier-based configurations", () => {
      const uploadConfig = DEFAULT_RATE_LIMITS["upload-images"];

      expect(uploadConfig.pro).toBeDefined();
      expect(uploadConfig.enterprise).toBeDefined();

      // Pro tier should have more requests than default
      expect(uploadConfig.pro.maxRequests).toBeGreaterThan(
        uploadConfig.default.maxRequests
      );

      // Enterprise tier should have even more requests
      expect(uploadConfig.enterprise.maxRequests).toBeGreaterThan(
        uploadConfig.pro.maxRequests
      );
    });
  });

  describe("Error Classes", () => {
    it("should create RateLimitError with correct properties", () => {
      const error = new RateLimitError("Test error", 429, { test: true });

      expect(error.name).toBe("RateLimitError");
      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(429);
      expect(error.details).toEqual({ test: true });
    });

    it("should create ConfigurationError with default status code", () => {
      const error = new ConfigurationError("Config error");

      expect(error.name).toBe("ConfigurationError");
      expect(error.statusCode).toBe(400);
    });

    it("should create ValidationError with default status code", () => {
      const error = new ValidationError("Validation error");

      expect(error.name).toBe("ValidationError");
      expect(error.statusCode).toBe(400);
    });

    it("should extend Error class properly", () => {
      const error = new RateLimitError("Test");

      expect(error instanceof Error).toBe(true);
      expect(error instanceof RateLimitError).toBe(true);
    });
  });
});
