import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RateLimitService } from "./rate-limit.service";
import { DynamoDBService } from "./dynamodb.service";
import { ConfigService } from "./config.service";
import type { RateLimitRequest, RateLimitResponse } from "../types";

// Mock services
vi.mock("./dynamodb.service");
vi.mock("./config.service");

describe("RateLimitService", () => {
  let rateLimitService: RateLimitService;
  let mockDynamoService: any;
  let mockConfigService: any;

  // Test data
  const mockRateLimit = {
    serviceId: "test-service",
    tier: "default",
    windowMs: 60000, // 1 minute
    maxRequests: 5,
  };

  const mockRequest: RateLimitRequest = {
    serviceId: "test-service",
    clientId: "test-client-123",
    metadata: {
      userTier: "default",
      userId: "user-456",
    },
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock DynamoDBService
    mockDynamoService = {
      getUsageInWindow: vi.fn(),
      recordUsage: vi.fn(),
      cleanupOldUsage: vi.fn(),
    };

    // Mock ConfigService
    mockConfigService = {
      getRateLimit: vi.fn(),
      getServiceConfig: vi.fn(),
    };

    // Create service instance with mocked dependencies
    rateLimitService = new RateLimitService(
      mockDynamoService,
      mockConfigService
    );

    // Setup default mock responses
    mockConfigService.getRateLimit.mockResolvedValue(mockRateLimit);
    mockDynamoService.getUsageInWindow.mockResolvedValue([]);
    mockDynamoService.recordUsage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkRateLimit", () => {
    describe("🟢 Happy Path - Allow requests", () => {
      it("should allow request when under rate limit", async () => {
        // Setup: 2 existing requests, limit is 5
        const existingUsage = [
          { timestamp: Date.now() - 30000, pk: "test", sk: "1" },
          { timestamp: Date.now() - 20000, pk: "test", sk: "2" },
        ];
        mockDynamoService.getUsageInWindow.mockResolvedValue(existingUsage);

        const result = await rateLimitService.checkRateLimit(mockRequest);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(2); // 5 max - 2 existing - 1 current = 2
        expect(result.resetTime).toBeGreaterThan(Date.now());
        expect(result.metadata.serviceId).toBe("test-service");
        expect(result.metadata.maxRequests).toBe(5);
        expect(result.metadata.windowMs).toBe(60000);
        expect(mockDynamoService.recordUsage).toHaveBeenCalledWith(
          "test-service",
          "test-client-123"
        );
      });

      it("should allow first request for new client", async () => {
        mockDynamoService.getUsageInWindow.mockResolvedValue([]);

        const result = await rateLimitService.checkRateLimit(mockRequest);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4); // 5 max - 0 existing - 1 current = 4
        expect(result.retryAfter).toBeUndefined();
        expect(mockDynamoService.recordUsage).toHaveBeenCalled();
      });

      it("should handle different user tiers", async () => {
        const proRateLimit = {
          ...mockRateLimit,
          tier: "pro",
          maxRequests: 20,
        };
        mockConfigService.getRateLimit.mockResolvedValue(proRateLimit);

        const proRequest = {
          ...mockRequest,
          metadata: { userTier: "pro" as const },
        };

        const result = await rateLimitService.checkRateLimit(proRequest);

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(19);
        expect(mockConfigService.getRateLimit).toHaveBeenCalledWith(
          "test-service",
          "pro"
        );
      });
    });

    describe("🚫 Rate Limit Exceeded", () => {
      it("should block request when rate limit is exceeded", async () => {
        // Setup: 5 existing requests, limit is 5
        const existingUsage = Array.from({ length: 5 }, (_, i) => ({
          timestamp: Date.now() - (i + 1) * 10000,
          pk: "test",
          sk: (i + 1).toString(),
        }));
        mockDynamoService.getUsageInWindow.mockResolvedValue(existingUsage);

        const result = await rateLimitService.checkRateLimit(mockRequest);

        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
        expect(result.retryAfter).toBeGreaterThan(0);
        expect(mockDynamoService.recordUsage).not.toHaveBeenCalled();
      });

      it("should calculate correct retryAfter time", async () => {
        const now = Date.now();
        const oldestRequestTime = now - 30000; // 30 seconds ago
        const existingUsage = [
          { timestamp: oldestRequestTime, pk: "test", sk: "1" },
          { timestamp: now - 20000, pk: "test", sk: "2" },
          { timestamp: now - 10000, pk: "test", sk: "3" },
          { timestamp: now - 5000, pk: "test", sk: "4" },
          { timestamp: now - 1000, pk: "test", sk: "5" },
        ];
        mockDynamoService.getUsageInWindow.mockResolvedValue(existingUsage);

        const result = await rateLimitService.checkRateLimit(mockRequest);

        expect(result.allowed).toBe(false);
        expect(result.retryAfter).toBe(30); // 60000ms window - 30000ms = 30 seconds
      });

      it("should not include retryAfter when no existing usage", async () => {
        // Edge case: somehow blocked but no usage records
        mockDynamoService.getUsageInWindow.mockResolvedValue([]);
        mockConfigService.getRateLimit.mockResolvedValue({
          ...mockRateLimit,
          maxRequests: 0, // No requests allowed
        });

        const result = await rateLimitService.checkRateLimit(mockRequest);

        expect(result.allowed).toBe(false);
        expect(result.retryAfter).toBeUndefined();
      });
    });

    describe("⚠️ Error Handling", () => {
      it("should throw error for invalid serviceId", async () => {
        const invalidRequest = {
          ...mockRequest,
          serviceId: "",
        };

        await expect(
          rateLimitService.checkRateLimit(invalidRequest)
        ).rejects.toThrow("Service ID is required and must be a string");
      });

      it("should throw error for invalid clientId", async () => {
        const invalidRequest = {
          ...mockRequest,
          clientId: "",
        };

        await expect(
          rateLimitService.checkRateLimit(invalidRequest)
        ).rejects.toThrow("Client ID is required and must be a string");
      });

      it("should throw error for invalid user tier", async () => {
        const invalidRequest = {
          ...mockRequest,
          metadata: { userTier: "invalid-tier" as any },
        };

        await expect(
          rateLimitService.checkRateLimit(invalidRequest)
        ).rejects.toThrow("Invalid user tier specified");
      });

      it("should handle DynamoDB service errors", async () => {
        mockDynamoService.getUsageInWindow.mockRejectedValue(
          new Error("DynamoDB connection failed")
        );

        await expect(
          rateLimitService.checkRateLimit(mockRequest)
        ).rejects.toThrow("DynamoDB connection failed");
      });

      it("should handle config service errors", async () => {
        mockConfigService.getRateLimit.mockRejectedValue(
          new Error("Config not found")
        );

        await expect(
          rateLimitService.checkRateLimit(mockRequest)
        ).rejects.toThrow("Config not found");
      });
    });

    describe("🕐 Time Window Calculations", () => {
      it("should correctly calculate reset time", async () => {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now);

        const result = await rateLimitService.checkRateLimit(mockRequest);

        expect(result.resetTime).toBe(now + mockRateLimit.windowMs);

        vi.restoreAllMocks();
      });

      it("should handle requests at window boundaries", async () => {
        const now = Date.now();
        const windowStart = now - mockRateLimit.windowMs;

        // Request exactly at window boundary
        const boundaryUsage = [
          { timestamp: windowStart + 1, pk: "test", sk: "1" },
        ];
        mockDynamoService.getUsageInWindow.mockResolvedValue(boundaryUsage);

        const result = await rateLimitService.checkRateLimit(mockRequest);

        expect(result.allowed).toBe(true);
        expect(mockDynamoService.getUsageInWindow).toHaveBeenCalledWith(
          "test-service",
          "test-client-123",
          windowStart
        );
      });
    });
  });

  describe("getUsageStats", () => {
    it("should return current usage statistics", async () => {
      const existingUsage = [
        { timestamp: Date.now() - 30000, pk: "test", sk: "1" },
        { timestamp: Date.now() - 20000, pk: "test", sk: "2" },
      ];
      mockDynamoService.getUsageInWindow.mockResolvedValue(existingUsage);

      const result = await rateLimitService.getUsageStats(
        "test-service",
        "test-client-123"
      );

      expect(result).toEqual({
        currentUsage: 2,
        maxRequests: 5,
        windowMs: 60000,
        resetTime: expect.any(Number),
        remaining: 3,
      });
    });

    it("should handle different tiers in usage stats", async () => {
      const proRateLimit = {
        ...mockRateLimit,
        tier: "pro",
        maxRequests: 20,
      };
      mockConfigService.getRateLimit.mockResolvedValue(proRateLimit);

      const result = await rateLimitService.getUsageStats(
        "test-service",
        "test-client-123",
        "pro"
      );

      expect(result.maxRequests).toBe(20);
      expect(mockConfigService.getRateLimit).toHaveBeenCalledWith(
        "test-service",
        "pro"
      );
    });
  });

  describe("resetRateLimit", () => {
    it("should reset rate limit for a client", async () => {
      await rateLimitService.resetRateLimit("test-service", "test-client-123");

      expect(mockDynamoService.cleanupOldUsage).toHaveBeenCalledWith(
        "test-service",
        "test-client-123",
        expect.any(Number)
      );
    });

    it("should handle errors during reset", async () => {
      mockDynamoService.cleanupOldUsage.mockRejectedValue(
        new Error("Cleanup failed")
      );

      await expect(
        rateLimitService.resetRateLimit("test-service", "test-client-123")
      ).rejects.toThrow("Cleanup failed");
    });
  });

  describe("checkMultipleRateLimits", () => {
    it("should process multiple requests in parallel", async () => {
      const requests: RateLimitRequest[] = [
        { ...mockRequest, clientId: "client-1" },
        { ...mockRequest, clientId: "client-2" },
        { ...mockRequest, clientId: "client-3" },
      ];

      const results = await rateLimitService.checkMultipleRateLimits(requests);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.allowed)).toBe(true);
      expect(mockConfigService.getRateLimit).toHaveBeenCalledTimes(3);
      expect(mockDynamoService.getUsageInWindow).toHaveBeenCalledTimes(3);
    });

    it("should handle mixed allowed/blocked results", async () => {
      const requests: RateLimitRequest[] = [
        { ...mockRequest, clientId: "client-1" },
        { ...mockRequest, clientId: "client-2" },
      ];

      // First client: no usage (allowed)
      // Second client: at limit (blocked)
      mockDynamoService.getUsageInWindow
        .mockResolvedValueOnce([]) // client-1: no usage
        .mockResolvedValueOnce(
          Array.from({ length: 5 }, (_, i) => ({
            timestamp: Date.now() - i * 1000,
            pk: "test",
            sk: i.toString(),
          }))
        ); // client-2: at limit

      const results = await rateLimitService.checkMultipleRateLimits(requests);

      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(false);
    });
  });

  describe("isBlocked", () => {
    it("should return true when client is blocked", async () => {
      // Mock getUsageStats to return 0 remaining
      vi.spyOn(rateLimitService, "getUsageStats").mockResolvedValue({
        currentUsage: 5,
        maxRequests: 5,
        windowMs: 60000,
        resetTime: Date.now() + 60000,
        remaining: 0,
      });

      const result = await rateLimitService.isBlocked(
        "test-service",
        "test-client-123"
      );

      expect(result).toBe(true);
    });

    it("should return false when client is not blocked", async () => {
      vi.spyOn(rateLimitService, "getUsageStats").mockResolvedValue({
        currentUsage: 2,
        maxRequests: 5,
        windowMs: 60000,
        resetTime: Date.now() + 60000,
        remaining: 3,
      });

      const result = await rateLimitService.isBlocked(
        "test-service",
        "test-client-123"
      );

      expect(result).toBe(false);
    });

    it("should fail open on error", async () => {
      vi.spyOn(rateLimitService, "getUsageStats").mockRejectedValue(
        new Error("Stats error")
      );

      const result = await rateLimitService.isBlocked(
        "test-service",
        "test-client-123"
      );

      expect(result).toBe(false); // Fail open
    });
  });

  describe("getTimeUntilReset", () => {
    it("should return time until reset", async () => {
      const futureResetTime = Date.now() + 30000; // 30 seconds from now
      vi.spyOn(rateLimitService, "getUsageStats").mockResolvedValue({
        currentUsage: 3,
        maxRequests: 5,
        windowMs: 60000,
        resetTime: futureResetTime,
        remaining: 2,
      });

      const result = await rateLimitService.getTimeUntilReset(
        "test-service",
        "test-client-123"
      );

      expect(result).toBeGreaterThan(25000); // Should be close to 30 seconds
      expect(result).toBeLessThan(35000);
    });

    it("should return 0 when reset time has passed", async () => {
      const pastResetTime = Date.now() - 10000; // 10 seconds ago
      vi.spyOn(rateLimitService, "getUsageStats").mockResolvedValue({
        currentUsage: 1,
        maxRequests: 5,
        windowMs: 60000,
        resetTime: pastResetTime,
        remaining: 4,
      });

      const result = await rateLimitService.getTimeUntilReset(
        "test-service",
        "test-client-123"
      );

      expect(result).toBe(0);
    });
  });

  describe("getRateLimitInfo", () => {
    it("should return rate limit configuration", async () => {
      const result = await rateLimitService.getRateLimitInfo("test-service");

      expect(result).toEqual(mockRateLimit);
      expect(mockConfigService.getRateLimit).toHaveBeenCalledWith(
        "test-service",
        "default"
      );
    });

    it("should handle different tiers", async () => {
      await rateLimitService.getRateLimitInfo("test-service", "pro");

      expect(mockConfigService.getRateLimit).toHaveBeenCalledWith(
        "test-service",
        "pro"
      );
    });
  });

  describe("preloadConfigurations", () => {
    it("should preload configurations for multiple services", async () => {
      const serviceIds = ["service-1", "service-2", "service-3"];

      await rateLimitService.preloadConfigurations(serviceIds);

      expect(mockConfigService.getServiceConfig).toHaveBeenCalledTimes(3);
      expect(mockConfigService.getServiceConfig).toHaveBeenCalledWith(
        "service-1"
      );
      expect(mockConfigService.getServiceConfig).toHaveBeenCalledWith(
        "service-2"
      );
      expect(mockConfigService.getServiceConfig).toHaveBeenCalledWith(
        "service-3"
      );
    });

    it("should not throw on preload errors", async () => {
      mockConfigService.getServiceConfig.mockRejectedValue(
        new Error("Preload failed")
      );

      // Should not throw
      await expect(
        rateLimitService.preloadConfigurations(["service-1"])
      ).resolves.toBeUndefined();
    });
  });

  describe("🔧 Edge Cases and Performance", () => {
    it("should handle concurrent requests for same client", async () => {
      const concurrentRequests = Array.from({ length: 3 }, () =>
        rateLimitService.checkRateLimit(mockRequest)
      );

      const results = await Promise.all(concurrentRequests);

      // All should be processed (though actual behavior depends on implementation)
      expect(results).toHaveLength(3);
      expect(results.every((r) => typeof r.allowed === "boolean")).toBe(true);
    });

    it("should handle very large usage numbers", async () => {
      const largeUsage = Array.from({ length: 1000 }, (_, i) => ({
        timestamp: Date.now() - i * 1000,
        pk: "test",
        sk: i.toString(),
      }));
      mockDynamoService.getUsageInWindow.mockResolvedValue(largeUsage);

      const result = await rateLimitService.checkRateLimit(mockRequest);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("should handle empty service and client IDs gracefully", async () => {
      const invalidRequest = {
        serviceId: "",
        clientId: "",
      };

      await expect(
        rateLimitService.checkRateLimit(invalidRequest as RateLimitRequest)
      ).rejects.toThrow();
    });
  });
});
