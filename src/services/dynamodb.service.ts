import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

import type { RateLimitConfigRecord, RateLimitUsageRecord } from "../types";

export class DynamoDBService {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly configTable: string;
  private readonly usageTable: string;

  constructor() {
    const client = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-2",
    });

    this.docClient = DynamoDBDocumentClient.from(client);
    this.configTable = process.env.RATE_LIMIT_CONFIG_TABLE || "RateLimitConfig";
    this.usageTable = process.env.RATE_LIMIT_USAGE_TABLE || "RateLimitUsage";
  }

  /**
   * Get rate limit configuration for a service
   */
  async getConfig(serviceId: string): Promise<RateLimitConfigRecord | null> {
    try {
      const command = new GetCommand({
        TableName: this.configTable,
        Key: { serviceId },
      });

      const result = await this.docClient.send(command);
      return (result.Item as RateLimitConfigRecord) || null;
    } catch (error) {
      console.error(`Error getting config for service ${serviceId}:`, error);
      throw error;
    }
  }

  /**
   * Save rate limit configuration for a service
   */
  async saveConfig(config: RateLimitConfigRecord): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.configTable,
        Item: {
          ...config,
          updatedAt: Date.now(),
        },
      });

      await this.docClient.send(command);
    } catch (error) {
      console.error(
        `Error saving config for service ${config.serviceId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get all configurations
   */
  async getAllConfigs(): Promise<RateLimitConfigRecord[]> {
    try {
      // For small datasets, we can scan. For production, consider pagination
      const command = new QueryCommand({
        TableName: this.configTable,
        KeyConditionExpression: "serviceId = :serviceId",
        ExpressionAttributeValues: {
          ":serviceId": "ALL", // This would need a different table design in real scenario
        },
      });

      const result = await this.docClient.send(command);
      return (result.Items as RateLimitConfigRecord[]) || [];
    } catch (error) {
      console.error("Error getting all configs:", error);
      throw error;
    }
  }

  /**
   * Record a request attempt
   */
  async recordUsage(serviceId: string, clientId: string): Promise<void> {
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + 24 * 60 * 60; // 24 hours TTL

    try {
      const record: RateLimitUsageRecord = {
        pk: `${serviceId}#${clientId}`,
        sk: now.toString(),
        timestamp: now,
        ttl,
      };

      const command = new PutCommand({
        TableName: this.usageTable,
        Item: record,
      });

      await this.docClient.send(command);
    } catch (error) {
      console.error(
        `Error recording usage for ${serviceId}#${clientId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get usage records within a time window
   */
  async getUsageInWindow(
    serviceId: string,
    clientId: string,
    windowStartMs: number
  ): Promise<RateLimitUsageRecord[]> {
    try {
      const command = new QueryCommand({
        TableName: this.usageTable,
        KeyConditionExpression: "pk = :pk AND sk >= :windowStart",
        ExpressionAttributeValues: {
          ":pk": `${serviceId}#${clientId}`,
          ":windowStart": windowStartMs.toString(),
        },
      });

      const result = await this.docClient.send(command);
      return (result.Items as RateLimitUsageRecord[]) || [];
    } catch (error) {
      console.error(`Error getting usage for ${serviceId}#${clientId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up old usage records (for maintenance)
   */
  async cleanupOldUsage(
    serviceId: string,
    clientId: string,
    beforeTimestamp: number
  ): Promise<void> {
    try {
      // First, query old records
      const queryCommand = new QueryCommand({
        TableName: this.usageTable,
        KeyConditionExpression: "pk = :pk AND sk < :beforeTimestamp",
        ExpressionAttributeValues: {
          ":pk": `${serviceId}#${clientId}`,
          ":beforeTimestamp": beforeTimestamp.toString(),
        },
        ProjectionExpression: "pk, sk",
      });

      const result = await this.docClient.send(queryCommand);

      if (!result.Items || result.Items.length === 0) {
        return;
      }

      // Delete old records in batches
      const deletePromises = result.Items.map((item) => {
        const deleteCommand = new DeleteCommand({
          TableName: this.usageTable,
          Key: {
            pk: item.pk,
            sk: item.sk,
          },
        });
        return this.docClient.send(deleteCommand);
      });

      await Promise.all(deletePromises);
    } catch (error) {
      console.error(
        `Error cleaning up old usage for ${serviceId}#${clientId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete a configuration
   */
  async deleteConfig(serviceId: string): Promise<void> {
    try {
      const command = new DeleteCommand({
        TableName: this.configTable,
        Key: { serviceId },
      });

      await this.docClient.send(command);
    } catch (error) {
      console.error(`Error deleting config for service ${serviceId}:`, error);
      throw error;
    }
  }
}
