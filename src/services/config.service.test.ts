import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConfigService } from "./config.service";
import { DynamoDBService } from "./dynamodb.service";
import { DEFAULT_RATE_LIMITS } from "../types";

// Mock DynamoDB service
vi.mock("./dynamodb.service");

describe("ConfigService", () => {
  let configService: ConfigService;
  let mockDynamoService: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock DynamoDB service
    mockDynamoService = {
      getConfig: vi.fn(),
      saveConfig: vi.fn(),
      getAllConfigs: vi.fn(),
      deleteConfig: vi.fn(),
    };

    configService = new ConfigService(mockDynamoService);
  });

  describe("getServiceConfig", () => {
    it("should return custom config from database when exists", async () => {
      const mockConfig = {
        serviceId: "test-service",
        config: {
          default: { windowMs: 5000, maxRequests: 10 },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockDynamoService.getConfig.mockResolvedValue(mockConfig);

      const result = await configService.getServiceConfig("test-service");

      expect(result).toEqual({
        serviceId: "test-service",
        rules: mockConfig.config,
      });
      expect(mockDynamoService.getConfig).toHaveBeenCalledWith("test-service");
    });

    it("should return default config when no custom config exists", async () => {
      mockDynamoService.getConfig.mockResolvedValue(null);

      const result = await configService.getServiceConfig("upload-images");

      expect(result).toEqual({
        serviceId: "upload-images",
        rules: DEFAULT_RATE_LIMITS["upload-images"],
      });
    });

    it("should throw error for unknown service without default", async () => {
      mockDynamoService.getConfig.mockResolvedValue(null);

      await expect(
        configService.getServiceConfig("unknown-service")
      ).rejects.toThrow("No configuration found for service: unknown-service");
    });
  });

  describe("getRateLimit", () => {
    it("should return rate limit for specific tier", async () => {
      mockDynamoService.getConfig.mockResolvedValue(null);

      const result = await configService.getRateLimit("upload-images", "pro");

      expect(result).toEqual({
        serviceId: "upload-images",
        tier: "pro",
        windowMs: 3600000,
        maxRequests: 5,
      });
    });

    it("should fall back to default tier when tier not found", async () => {
      mockDynamoService.getConfig.mockResolvedValue(null);

      const result = await configService.getRateLimit(
        "upload-images",
        "nonexistent"
      );

      expect(result).toEqual({
        serviceId: "upload-images",
        tier: "nonexistent",
        windowMs: 7200000, // default tier values
        maxRequests: 2,
      });
    });
  });

  describe("saveServiceConfig", () => {
    it("should validate and save configuration", async () => {
      const config = {
        serviceId: "test-service",
        rules: {
          default: { windowMs: 5000, maxRequests: 10 },
        },
      };

      await configService.saveServiceConfig(config);

      expect(mockDynamoService.saveConfig).toHaveBeenCalledWith({
        serviceId: "test-service",
        config: config.rules,
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      });
    });

    it("should throw error for invalid configuration", async () => {
      const invalidConfig = {
        serviceId: "",
        rules: {},
      };

      await expect(
        configService.saveServiceConfig(invalidConfig)
      ).rejects.toThrow("Service ID is required and must be a string");
    });

    it("should throw error when default tier is missing", async () => {
      const invalidConfig = {
        serviceId: "test-service",
        rules: {
          pro: { windowMs: 5000, maxRequests: 10 },
        },
      };

      await expect(
        configService.saveServiceConfig(invalidConfig)
      ).rejects.toThrow("Default tier configuration is required");
    });
  });

  describe("hasCustomConfig", () => {
    it("should return true when custom config exists", async () => {
      mockDynamoService.getConfig.mockResolvedValue({
        serviceId: "test-service",
        config: {},
      });

      const result = await configService.hasCustomConfig("test-service");

      expect(result).toBe(true);
    });

    it("should return false when no custom config exists", async () => {
      mockDynamoService.getConfig.mockResolvedValue(null);

      const result = await configService.hasCustomConfig("test-service");

      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockDynamoService.getConfig.mockRejectedValue(new Error("DB Error"));

      const result = await configService.hasCustomConfig("test-service");

      expect(result).toBe(false);
    });
  });

  describe("getAvailableTiers", () => {
    it("should return available tiers for a service", async () => {
      mockDynamoService.getConfig.mockResolvedValue(null);

      const result = await configService.getAvailableTiers("upload-images");

      expect(result).toEqual(["default", "pro", "enterprise"]);
    });
  });

  describe("createDefaultConfig", () => {
    it("should create and save default configuration", async () => {
      const result = await configService.createDefaultConfig("new-service");

      expect(result).toEqual({
        serviceId: "new-service",
        rules: {
          default: { windowMs: 3600000, maxRequests: 10 },
          pro: { windowMs: 3600000, maxRequests: 50 },
          enterprise: { windowMs: 3600000, maxRequests: 200 },
        },
      });

      expect(mockDynamoService.saveConfig).toHaveBeenCalled();
    });
  });
});
