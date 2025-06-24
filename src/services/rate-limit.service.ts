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
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    console.log(`🟢 [1][${requestId}] Start checkRateLimit`, {
      serviceId: request.serviceId,
      clientId: request.clientId,
      userTier: request.metadata?.userTier || "default",
      timestamp: new Date().toISOString(),
    });
    try {
      // 1. Validate request
      console.log(`🔎 [2][${requestId}] Validating request parameters`);
      this.validateRequest(request);
      console.log(`✅ [3][${requestId}] Request validated successfully`);

      // 2. Get rate limit config
      const tier = request.metadata?.userTier || "default";
      console.log(
        `📋 [4][${requestId}] Fetching rate limit config for tier: ${tier}`
      );
      const rateLimit = await this.configService.getRateLimit(
        request.serviceId,
        tier
      );
      console.log(`📊 [5][${requestId}] Config fetched`, {
        maxRequests: rateLimit.maxRequests,
        windowMs: rateLimit.windowMs,
      });

      // 3. Calculate time window
      const now = Date.now();
      const windowStart = now - rateLimit.windowMs;
      console.log(`⏰ [6][${requestId}] Time window calculated`, {
        now: new Date(now).toISOString(),
        windowStart: new Date(windowStart).toISOString(),
      });

      // 4. Get current usage in window
      console.log(`🔢 [7][${requestId}] Querying current usage in DynamoDB`);
      const usageRecords = await this.dynamoService.getUsageInWindow(
        request.serviceId,
        request.clientId,
        windowStart
      );
      const currentUsage = usageRecords.length;
      const allowed = currentUsage < rateLimit.maxRequests;
      const remaining = Math.max(0, rateLimit.maxRequests - currentUsage);
      console.log(`📈 [8][${requestId}] Current usage`, {
        currentUsage,
        allowed,
        remaining,
      });

      // 5. Calculate resetTime
      const resetTime = this.calculateNextWindowStart(now, rateLimit.windowMs);
      console.log(`🔄 [9][${requestId}] Reset time calculated`, {
        resetTime: new Date(resetTime).toISOString(),
      });

      // 6. Calculate retryAfter if blocked
      let retryAfter: number | undefined;
      if (!allowed && usageRecords.length > 0) {
        console.log(
          `⏳ [10][${requestId}] Calculating retryAfter for blocked request`
        );
        const oldestRequest = usageRecords.reduce((oldest, record) =>
          record.timestamp < oldest.timestamp ? record : oldest
        );
        retryAfter = Math.ceil(
          (oldestRequest.timestamp + rateLimit.windowMs - now) / 1000
        );
        console.log(`⏱️ [11][${requestId}] retryAfter calculated`, {
          retryAfter,
        });
      }

      // 7. Record usage if allowed
      if (allowed) {
        console.log(`📝 [12][${requestId}] Recording usage in DynamoDB`);
        await this.dynamoService.recordUsage(
          request.serviceId,
          request.clientId
        );
        console.log(`✅ [13][${requestId}] Usage recorded successfully`);
      } else {
        console.log(
          `🚫 [14][${requestId}] Request blocked, usage not recorded`
        );
      }

      const response: RateLimitResponse = {
        allowed,
        remaining: allowed ? remaining - 1 : remaining,
        resetTime,
        metadata: {
          serviceId: request.serviceId,
          windowMs: rateLimit.windowMs,
          maxRequests: rateLimit.maxRequests,
        },
      };
      if (retryAfter !== undefined) {
        response.retryAfter = retryAfter;
      }
      const duration = Date.now() - startTime;
      console.log(`🏁 [15][${requestId}] checkRateLimit finished`, {
        allowed,
        remaining: response.remaining,
        retryAfter: response.retryAfter,
        durationMs: duration,
      });
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [E][${requestId}] Error in checkRateLimit`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: duration,
      });
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
    const requestId = this.generateRequestId();
    console.log(`📊 [1][${requestId}] getUsageStats`, {
      serviceId,
      clientId,
      tier,
    });
    try {
      const rateLimit = await this.configService.getRateLimit(serviceId, tier);
      const now = Date.now();
      const windowStart = now - rateLimit.windowMs;
      console.log(`🔢 [2][${requestId}] Querying current usage`);
      const usageRecords = await this.dynamoService.getUsageInWindow(
        serviceId,
        clientId,
        windowStart
      );
      const currentUsage = usageRecords.length;
      const remaining = Math.max(0, rateLimit.maxRequests - currentUsage);
      const resetTime = this.calculateNextWindowStart(now, rateLimit.windowMs);
      const stats = {
        currentUsage,
        maxRequests: rateLimit.maxRequests,
        windowMs: rateLimit.windowMs,
        resetTime,
        remaining,
      };
      console.log(`📈 [3][${requestId}] Stats fetched`, stats);
      return stats;
    } catch (error) {
      console.error(`❌ [E][${requestId}] Error in getUsageStats`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Reset rate limit for a client (admin function)
   */
  async resetRateLimit(serviceId: string, clientId: string): Promise<void> {
    const requestId = this.generateRequestId();
    console.log(`🔄 [1][${requestId}] resetRateLimit`, { serviceId, clientId });
    try {
      const now = Date.now();
      await this.dynamoService.cleanupOldUsage(serviceId, clientId, now);
      console.log(`✅ [2][${requestId}] Rate limit reset`);
    } catch (error) {
      console.error(`❌ [E][${requestId}] Error in resetRateLimit`, {
        error: error instanceof Error ? error.message : String(error),
      });
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
    const requestId = this.generateRequestId();
    console.log(`📦 [1][${requestId}] checkMultipleRateLimits`, {
      count: requests.length,
    });
    try {
      const results = await Promise.all(
        requests.map((request) => this.checkRateLimit(request))
      );
      console.log(`✅ [2][${requestId}] Bulk check finished`);
      return results;
    } catch (error) {
      console.error(`❌ [E][${requestId}] Error in checkMultipleRateLimits`, {
        error: error instanceof Error ? error.message : String(error),
      });
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

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
