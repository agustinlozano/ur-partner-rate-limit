// Test setup file for Vitest
import { vi } from "vitest";

// Mock AWS SDK clients
vi.mock("@aws-sdk/client-dynamodb");
vi.mock("@aws-sdk/lib-dynamodb");

// Mock environment variables
process.env.RATE_LIMIT_CONFIG_TABLE = "RateLimitConfig-test";
process.env.RATE_LIMIT_USAGE_TABLE = "RateLimitUsage-test";
process.env.NODE_ENV = "test";

// Global test utilities
declare global {
  const mockDynamoDBGet: any;
  const mockDynamoDBPut: any;
  const mockDynamoDBQuery: any;
  const mockDynamoDBUpdate: any;
  const mockDynamoDBDelete: any;
}

// Setup global mocks for DynamoDB operations
globalThis.mockDynamoDBGet = vi.fn();
globalThis.mockDynamoDBPut = vi.fn();
globalThis.mockDynamoDBQuery = vi.fn();
globalThis.mockDynamoDBUpdate = vi.fn();
globalThis.mockDynamoDBDelete = vi.fn();
