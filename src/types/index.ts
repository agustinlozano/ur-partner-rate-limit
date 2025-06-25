// Rate Limiting Request and Response Types

// Input interface - what clients send (clientId is optional)
export interface RateLimitRequestInput {
  serviceId: string; // "upload-images", "api-general", "auth", etc.
  clientId?: string; // Optional - will be extracted from request if not provided
  metadata?: {
    // Optional context data
    userId?: string;
    endpoint?: string;
    userTier?: "free" | "pro" | "enterprise" | "default";
    [key: string]: any;
  };
}

// Internal interface - what the service uses (clientId is required)
export interface RateLimitRequest {
  serviceId: string; // "upload-images", "api-general", "auth", etc.
  clientId: string; // Always required internally - extracted automatically
  metadata?: {
    // Optional context data
    userId?: string;
    endpoint?: string;
    userTier?: "free" | "pro" | "enterprise" | "default";
    [key: string]: any;
  };
}

export interface RateLimitResponse {
  allowed: boolean; // Whether the request is allowed
  remaining: number; // Remaining requests in current window
  resetTime: number; // Unix timestamp when window resets
  retryAfter?: number; // Seconds to wait if blocked
  metadata: {
    serviceId: string;
    windowMs: number; // Window size in milliseconds
    maxRequests: number; // Max requests allowed in window
  };
}

// Configuration Types
export interface RateLimitConfig {
  serviceId: string;
  rules: {
    [tier: string]: {
      // 'default', 'free', 'pro', 'enterprise'
      windowMs: number; // Time window in milliseconds
      maxRequests: number; // Max requests in window
    };
  };
}

// DynamoDB Schema Types
export interface RateLimitUsageRecord {
  pk: string; // Partition key: "{serviceId}#{clientId}"
  sk: string; // Sort key: timestamp as string
  timestamp: number; // Unix timestamp
  ttl: number; // TTL for automatic cleanup
}

export interface RateLimitConfigRecord {
  serviceId: string; // Partition key
  config: RateLimitConfig["rules"];
  createdAt: number;
  updatedAt: number;
}

// Default Configurations
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig["rules"]> = {
  "upload-images": {
    default: { windowMs: 7200000, maxRequests: 5 }, // 5 requests per 2 hours
    pro: { windowMs: 3600000, maxRequests: 10 }, // 10 requests per hour
    enterprise: { windowMs: 1800000, maxRequests: 20 }, // 20 requests per 30 min
  },
  "api-general": {
    default: { windowMs: 3600000, maxRequests: 3 }, // 3 requests per hour
    pro: { windowMs: 3600000, maxRequests: 10 }, // 10 requests per hour
    enterprise: { windowMs: 3600000, maxRequests: 50 }, // 50 requests per hour
  },
  auth: {
    default: { windowMs: 900000, maxRequests: 5 }, // 5 requests per 15 min
    pro: { windowMs: 900000, maxRequests: 10 }, // 10 requests per 15 min
    enterprise: { windowMs: 900000, maxRequests: 20 }, // 20 requests per 15 min
  },
};

// Error Types
export class RateLimitError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class ConfigurationError extends RateLimitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, details);
    this.name = "ConfigurationError";
  }
}

export class ValidationError extends RateLimitError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, details);
    this.name = "ValidationError";
  }
}
