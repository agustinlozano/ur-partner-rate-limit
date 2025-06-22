// Service Layer Exports
export { DynamoDBService } from "./dynamodb.service";
export { ConfigService } from "./config.service";
export { RateLimitService } from "./rate-limit.service";

// Re-export types and interfaces
export type { RateLimitResult } from "./rate-limit.service";

// Import for factory
import { DynamoDBService } from "./dynamodb.service";
import { ConfigService } from "./config.service";
import { RateLimitService } from "./rate-limit.service";

// Service Factory - Singleton pattern for better performance
export class ServiceFactory {
  private static dynamoService: DynamoDBService | null = null;
  private static configService: ConfigService | null = null;
  private static rateLimitService: RateLimitService | null = null;

  static getDynamoService(): DynamoDBService {
    if (!this.dynamoService) {
      this.dynamoService = new DynamoDBService();
    }
    return this.dynamoService;
  }

  static getConfigService(): ConfigService {
    if (!this.configService) {
      const dynamoService = this.getDynamoService();
      this.configService = new ConfigService(dynamoService);
    }
    return this.configService;
  }

  static getRateLimitService(): RateLimitService {
    if (!this.rateLimitService) {
      const dynamoService = this.getDynamoService();
      const configService = this.getConfigService();
      this.rateLimitService = new RateLimitService(
        dynamoService,
        configService
      );
    }
    return this.rateLimitService;
  }

  // Reset for testing
  static reset(): void {
    this.dynamoService = null;
    this.configService = null;
    this.rateLimitService = null;
  }
}
