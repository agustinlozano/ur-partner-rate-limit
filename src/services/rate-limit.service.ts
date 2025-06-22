import type {
  RateLimitRequest,
  RateLimitResponse,
  RateLimitError,
} from "../types";
import { DynamoDBService } from "./dynamodb.service";
import { ConfigService } from "./config.service";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  windowMs: number;
  maxRequests: number;
}

export class RateLimitService {
  private readonly dynamoService: DynamoDBService;
  private readonly configService: ConfigService;

  constructor(dynamoService?: DynamoDBService, configService?: ConfigService) {
    this.dynamoService = dynamoService || new DynamoDBService();
    this.configService = configService || new ConfigService(this.dynamoService);
  }

  /**
   * Check if a request is within rate limits
   */
  async checkRateLimit(request: RateLimitRequest): Promise<RateLimitResponse> {
    try {
      // Validate request
      this.validateRequest(request);

      // Get rate limit configuration
      const tier = request.metadata?.userTier || "default";
      const rateLimit = await this.configService.getRateLimit(
        request.serviceId,
        tier
      );

      // Calculate time window
      const now = Date.now();
      const windowStart = now - rateLimit.windowMs;

      // Get current usage in window
      const usageRecords = await this.dynamoService.getUsageInWindow(
        request.serviceId,
        request.clientId,
        windowStart
      );

      const currentUsage = usageRecords.length;
      const allowed = currentUsage < rateLimit.maxRequests;
      const remaining = Math.max(0, rateLimit.maxRequests - currentUsage);

      // Calculate reset time (next window start)
      const resetTime = this.calculateNextWindowStart(now, rateLimit.windowMs);

      // Calculate retry after if blocked
      let retryAfter: number | undefined;
      if (!allowed && usageRecords.length > 0) {
        // Find the oldest request in current window
        const oldestRequest = usageRecords.reduce((oldest, record) => {
          return record.timestamp < oldest.timestamp ? record : oldest;
        });

        retryAfter = Math.ceil(
          (oldestRequest.timestamp + rateLimit.windowMs - now) / 1000
        );
      }

      // Record this request if allowed
      if (allowed) {
        await this.dynamoService.recordUsage(
          request.serviceId,
          request.clientId
        );
      }

      const response: RateLimitResponse = {
        allowed,
        remaining: allowed ? remaining - 1 : remaining, // Subtract 1 if we just recorded
        resetTime,
        metadata: {
          serviceId: request.serviceId,
          windowMs: rateLimit.windowMs,
          maxRequests: rateLimit.maxRequests,
        },
      };

      // Only include retryAfter if it has a value
      if (retryAfter !== undefined) {
        response.retryAfter = retryAfter;
      }

      return response;
    } catch (error) {
      console.error("Rate limit check error:", error);
      throw error;
    }
  }

  /**
   * Get current usage statistics for a client
   */
  async getUsageStats(
    serviceId: string,
    clientId: string,
    tier: string = "default"
  ): Promise<{
    currentUsage: number;
    maxRequests: number;
    windowMs: number;
    resetTime: number;
    remaining: number;
  }> {
    try {
      const rateLimit = await this.configService.getRateLimit(serviceId, tier);
      const now = Date.now();
      const windowStart = now - rateLimit.windowMs;

      const usageRecords = await this.dynamoService.getUsageInWindow(
        serviceId,
        clientId,
        windowStart
      );

      const currentUsage = usageRecords.length;
      const remaining = Math.max(0, rateLimit.maxRequests - currentUsage);
      const resetTime = this.calculateNextWindowStart(now, rateLimit.windowMs);

      return {
        currentUsage,
        maxRequests: rateLimit.maxRequests,
        windowMs: rateLimit.windowMs,
        resetTime,
        remaining,
      };
    } catch (error) {
      console.error("Error getting usage stats:", error);
      throw error;
    }
  }

  /**
   * Reset rate limit for a client (admin function)
   */
  async resetRateLimit(serviceId: string, clientId: string): Promise<void> {
    try {
      const now = Date.now();
      await this.dynamoService.cleanupOldUsage(serviceId, clientId, now);
    } catch (error) {
      console.error("Error resetting rate limit:", error);
      throw error;
    }
  }

  /**
   * Cleanup old usage records for maintenance
   */
  async cleanupOldRecords(
    serviceId: string,
    clientId: string,
    hoursOld: number = 24
  ): Promise<void> {
    try {
      const cutoffTime = Date.now() - hoursOld * 60 * 60 * 1000;
      await this.dynamoService.cleanupOldUsage(serviceId, clientId, cutoffTime);
    } catch (error) {
      console.error("Error during cleanup:", error);
      throw error;
    }
  }

  /**
   * Bulk check for multiple requests (batch processing)
   */
  async checkMultipleRateLimits(
    requests: RateLimitRequest[]
  ): Promise<RateLimitResponse[]> {
    try {
      // Process in parallel for better performance
      const results = await Promise.all(
        requests.map((request) => this.checkRateLimit(request))
      );

      return results;
    } catch (error) {
      console.error("Error in bulk rate limit check:", error);
      throw error;
    }
  }

  /**
   * Check if service+client combination is currently blocked
   */
  async isBlocked(
    serviceId: string,
    clientId: string,
    tier: string = "default"
  ): Promise<boolean> {
    try {
      const stats = await this.getUsageStats(serviceId, clientId, tier);
      return stats.remaining <= 0;
    } catch (error) {
      console.error("Error checking if blocked:", error);
      return false; // Fail open
    }
  }

  /**
   * Get time until rate limit resets for a client
   */
  async getTimeUntilReset(
    serviceId: string,
    clientId: string,
    tier: string = "default"
  ): Promise<number> {
    try {
      const stats = await this.getUsageStats(serviceId, clientId, tier);
      return Math.max(0, stats.resetTime - Date.now());
    } catch (error) {
      console.error("Error getting time until reset:", error);
      return 0;
    }
  }

  /**
   * Validate rate limit request
   */
  private validateRequest(request: RateLimitRequest): void {
    if (!request.serviceId || typeof request.serviceId !== "string") {
      throw new Error("Service ID is required and must be a string");
    }

    if (!request.clientId || typeof request.clientId !== "string") {
      throw new Error("Client ID is required and must be a string");
    }

    // Optional: Validate metadata structure
    if (request.metadata) {
      if (
        request.metadata.userTier &&
        !["free", "pro", "enterprise", "default"].includes(
          request.metadata.userTier
        )
      ) {
        throw new Error("Invalid user tier specified");
      }
    }
  }

  /**
   * Calculate the next window start time
   */
  private calculateNextWindowStart(
    currentTime: number,
    windowMs: number
  ): number {
    // For sliding window, next reset is current time + window
    return currentTime + windowMs;
  }

  /**
   * Get rate limit information without checking/recording
   */
  async getRateLimitInfo(serviceId: string, tier: string = "default") {
    return await this.configService.getRateLimit(serviceId, tier);
  }

  /**
   * Preload rate limit configuration (for performance optimization)
   */
  async preloadConfigurations(serviceIds: string[]): Promise<void> {
    try {
      // Preload configurations in parallel
      await Promise.all(
        serviceIds.map((serviceId) =>
          this.configService.getServiceConfig(serviceId)
        )
      );
    } catch (error) {
      console.error("Error preloading configurations:", error);
      // Don't throw - this is an optimization
    }
  }
}
