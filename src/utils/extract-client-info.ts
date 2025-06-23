import type { Context } from "hono";

/**
 * Extract real client IP from HTTP headers
 * Handles various proxy configurations (CloudFront, CloudFlare, etc.)
 */
export function extractClientIP(c: Context): string {
  // Try various headers in order of preference
  const headers = [
    "x-forwarded-for",
    "x-real-ip",
    "x-client-ip",
    "cf-connecting-ip", // Cloudflare
    "x-forwarded",
    "forwarded-for",
    "forwarded",
  ];

  for (const header of headers) {
    const value = c.req.header(header);
    if (value) {
      // x-forwarded-for can contain multiple IPs: "client, proxy1, proxy2"
      // Take the first one (original client)
      const ip = value.split(",")[0]?.trim();
      if (ip && isValidIP(ip)) {
        return ip;
      }
    }
  }

  // Fallback for local development or when no IP headers are present
  return "unknown";
}

/**
 * Extract client identifier - IP or authenticated user ID
 */
export function extractClientId(c: Context): string {
  // Check if there's a user ID in JWT token or auth header
  const userId = extractUserIdFromAuth(c);
  if (userId) {
    return `user:${userId}`;
  }

  // Otherwise use IP address
  const ip = extractClientIP(c);
  return `ip:${ip}`;
}

/**
 * Extract user tier from authentication
 */
export function extractUserTier(
  c: Context
): "free" | "pro" | "enterprise" | "default" {
  const authHeader = c.req.header("authorization");

  if (!authHeader) {
    return "default";
  }

  // Example: Parse JWT token and extract user tier
  if (authHeader.includes("Bearer")) {
    // TODO: Implement JWT parsing when auth system is ready
    // const token = authHeader.replace('Bearer ', '');
    // const decoded = verifyJWT(token);
    // return decoded.tier || 'default';
    return "default";
  }

  if (authHeader.includes("ApiKey")) {
    // TODO: Look up API key tier in database when ready
    // const apiKey = authHeader.replace('ApiKey ', '');
    // const tier = await lookupApiKeyTier(apiKey);
    // return tier || 'default';
    return "default";
  }

  return "default";
}

/**
 * Extract user ID from authentication
 */
function extractUserIdFromAuth(c: Context): string | null {
  const authHeader = c.req.header("authorization");

  if (!authHeader) {
    return null;
  }

  // Example JWT parsing - replace with your actual implementation
  if (authHeader.includes("Bearer")) {
    // TODO: Parse JWT and extract user ID when auth system is ready
    // const token = authHeader.replace('Bearer ', '');
    // const decoded = verifyJWT(token);
    // return decoded.userId;
    return null;
  }

  return null;
}

/**
 * Basic IP validation
 */
function isValidIP(ip: string): boolean {
  // IPv4 regex
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // IPv6 regex (simplified)
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

  return (
    ipv4Regex.test(ip) ||
    ipv6Regex.test(ip) ||
    ip === "::1" ||
    ip === "localhost"
  );
}

/**
 * Extract additional metadata from request
 */
export function extractRequestMetadata(c: Context) {
  return {
    userAgent: c.req.header("user-agent"),
    origin: c.req.header("origin"),
    referer: c.req.header("referer"),
    timestamp: Date.now(),
  };
}
