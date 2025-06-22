import type {
  RateLimitConfig,
  RateLimitConfigRecord,
  ConfigurationError,
} from "../types";
import { DEFAULT_RATE_LIMITS } from "../types";
import { DynamoDBService } from "./dynamodb.service";

export class ConfigService {
  private readonly dynamoService: DynamoDBService;

  constructor(dynamoService?: DynamoDBService) {
    this.dynamoService = dynamoService || new DynamoDBService();
  }

  /**
   * Get configuration for a service, falling back to defaults
   */
  async getServiceConfig(serviceId: string): Promise<RateLimitConfig> {
    try {
      // Try to get from database first
      const configRecord = await this.dynamoService.getConfig(serviceId);

      if (configRecord) {
        return {
          serviceId,
          rules: configRecord.config,
        };
      }

      // Fall back to default configuration
      const defaultRules = DEFAULT_RATE_LIMITS[serviceId];
      if (!defaultRules) {
        throw new Error(`No configuration found for service: ${serviceId}`);
      }

      return {
        serviceId,
        rules: defaultRules,
      };
    } catch (error) {
      console.error(`Error getting config for service ${serviceId}:`, error);
      throw error;
    }
  }

  /**
   * Get rate limit rule for specific tier
   */
  async getRateLimit(serviceId: string, tier: string = "default") {
    const config = await this.getServiceConfig(serviceId);

    // Try specific tier first, fall back to default
    const rule = config.rules[tier] || config.rules.default;

    if (!rule) {
      throw new Error(
        `No rate limit rule found for service ${serviceId} and tier ${tier}`
      );
    }

    return {
      serviceId,
      tier,
      ...rule,
    };
  }

  /**
   * Save or update configuration for a service
   */
  async saveServiceConfig(config: RateLimitConfig): Promise<void> {
    try {
      // Validate the configuration
      this.validateConfig(config);

      const configRecord: RateLimitConfigRecord = {
        serviceId: config.serviceId,
        config: config.rules,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await this.dynamoService.saveConfig(configRecord);
    } catch (error) {
      console.error(
        `Error saving config for service ${config.serviceId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all service configurations
   */
  async getAllServiceConfigs(): Promise<RateLimitConfig[]> {
    try {
      // Get custom configs from database
      const customConfigs = await this.dynamoService.getAllConfigs();

      // Convert to RateLimitConfig format
      const configs: RateLimitConfig[] = customConfigs.map((record) => ({
        serviceId: record.serviceId,
        rules: record.config,
      }));

      // Add default configs for services not in database
      const existingServiceIds = new Set(configs.map((c) => c.serviceId));

      for (const [serviceId, rules] of Object.entries(DEFAULT_RATE_LIMITS)) {
        if (!existingServiceIds.has(serviceId)) {
          configs.push({
            serviceId,
            rules,
          });
        }
      }

      return configs;
    } catch (error) {
      console.error("Error getting all service configs:", error);
      throw error;
    }
  }

  /**
   * Update configuration for a service
   */
  async updateServiceConfig(
    serviceId: string,
    rules: RateLimitConfig["rules"]
  ): Promise<void> {
    const config: RateLimitConfig = { serviceId, rules };
    await this.saveServiceConfig(config);
  }

  /**
   * Delete custom configuration (falls back to default)
   */
  async deleteServiceConfig(serviceId: string): Promise<void> {
    try {
      await this.dynamoService.deleteConfig(serviceId);
    } catch (error) {
      console.error(`Error deleting config for service ${serviceId}:`, error);
      throw error;
    }
  }

  /**
   * Check if a service has custom configuration
   */
  async hasCustomConfig(serviceId: string): Promise<boolean> {
    try {
      const configRecord = await this.dynamoService.getConfig(serviceId);
      return configRecord !== null;
    } catch (error) {
      console.error(
        `Error checking custom config for service ${serviceId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Get available tiers for a service
   */
  async getAvailableTiers(serviceId: string): Promise<string[]> {
    const config = await this.getServiceConfig(serviceId);
    return Object.keys(config.rules);
  }

  /**
   * Validate configuration structure
   */
  private validateConfig(config: RateLimitConfig): void {
    if (!config.serviceId || typeof config.serviceId !== "string") {
      throw new Error("Service ID is required and must be a string");
    }

    if (!config.rules || typeof config.rules !== "object") {
      throw new Error("Rules are required and must be an object");
    }

    // Ensure default tier exists
    if (!config.rules.default) {
      throw new Error("Default tier configuration is required");
    }

    // Validate each rule
    for (const [tier, rule] of Object.entries(config.rules)) {
      if (typeof rule !== "object") {
        throw new Error(`Rule for tier '${tier}' must be an object`);
      }

      if (typeof rule.windowMs !== "number" || rule.windowMs <= 0) {
        throw new Error(
          `windowMs for tier '${tier}' must be a positive number`
        );
      }

      if (typeof rule.maxRequests !== "number" || rule.maxRequests <= 0) {
        throw new Error(
          `maxRequests for tier '${tier}' must be a positive number`
        );
      }
    }
  }

  /**
   * Create a new service configuration with default values
   */
  async createDefaultConfig(serviceId: string): Promise<RateLimitConfig> {
    const defaultRules = {
      default: { windowMs: 3600000, maxRequests: 10 }, // 1 hour, 10 requests
      pro: { windowMs: 3600000, maxRequests: 50 }, // 1 hour, 50 requests
      enterprise: { windowMs: 3600000, maxRequests: 200 }, // 1 hour, 200 requests
    };

    const config: RateLimitConfig = {
      serviceId,
      rules: defaultRules,
    };

    await this.saveServiceConfig(config);
    return config;
  }
}
