import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { cors } from "hono/cors";

import type { RateLimitRequest, RateLimitRequestInput } from "./types";
import { ServiceFactory } from "./services";
import {
  extractClientId,
  extractUserTier,
  extractRequestMetadata,
} from "./utils/extract-client-info";

// Initialize Hono app
const app = new Hono();

// Add CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Forwarded-For"],
  })
);

// Initialize services
const rateLimitService = ServiceFactory.getRateLimitService();
const configService = ServiceFactory.getConfigService();

// Routes
app.post("/check", async (c) => {
  try {
    const body = (await c.req.json()) as RateLimitRequestInput;

    // ✅ Extract client information automatically from request
    const clientId = body.clientId || extractClientId(c);
    const userTier = body.metadata?.userTier || extractUserTier(c);
    const requestMetadata = extractRequestMetadata(c);

    // Build complete rate limit request
    const rateLimitRequest: RateLimitRequest = {
      serviceId: body.serviceId,
      clientId, // ← Extracted automatically, not from body
      metadata: {
        ...body.metadata,
        userTier,
        ...requestMetadata,
        // Log the extraction method for debugging
        extractionMethod: body.clientId ? "provided" : "auto-extracted",
      },
    };

    // Use the rate limiting service
    const response = await rateLimitService.checkRateLimit(rateLimitRequest);

    return c.json(response);
  } catch (error) {
    console.error("Rate limit check error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/config", async (c) => {
  try {
    const configs = await configService.getAllServiceConfigs();
    return c.json({ configs });
  } catch (error) {
    console.error("Error getting all configs:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/config", async (c) => {
  try {
    const body = await c.req.json();
    await configService.saveServiceConfig(body);
    return c.json({ message: "Configuration saved successfully" });
  } catch (error) {
    console.error("Error saving config:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/config/:serviceId", async (c) => {
  try {
    const serviceId = c.req.param("serviceId");
    const config = await configService.getServiceConfig(serviceId);
    return c.json({ config });
  } catch (error) {
    console.error(
      `Error getting config for ${c.req.param("serviceId")}:`,
      error
    );
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.put("/config/:serviceId", async (c) => {
  try {
    const serviceId = c.req.param("serviceId");
    const body = await c.req.json();
    await configService.updateServiceConfig(serviceId, body.rules);
    return c.json({ message: "Configuration updated successfully" });
  } catch (error) {
    console.error(
      `Error updating config for ${c.req.param("serviceId")}:`,
      error
    );
    return c.json({ error: "Internal server error" }, 500);
  }
});

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Convert Hono app to Lambda handler (Hono handles CORS and JSON parsing internally)
export const handler = handle(app);

// Config handler (separate function for serverless.yml)
export const configHandler = handler;
