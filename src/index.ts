import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

import middy from "@middy/core";
import httpErrorHandler from "@middy/http-error-handler";
import httpCors from "@middy/http-cors";
import httpJsonBodyParser from "@middy/http-json-body-parser";

import type { RateLimitRequest, RateLimitResponse } from "./types";
import { ServiceFactory } from "./services";

// Initialize Hono app
const app = new Hono();

// Initialize services
const rateLimitService = ServiceFactory.getRateLimitService();
const configService = ServiceFactory.getConfigService();

// Routes
app.post("/check", async (c) => {
  try {
    const body = (await c.req.json()) as RateLimitRequest;

    // Use the rate limiting service
    const response = await rateLimitService.checkRateLimit(body);

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

// Convert Hono app to Lambda handler
const honoHandler = handle(app);

// Wrap with Middy middleware
export const handler = middy(honoHandler)
  .use(httpJsonBodyParser())
  .use(
    httpCors({
      origin: "*",
      credentials: false,
    })
  )
  .use(httpErrorHandler());

// Config handler (separate function for serverless.yml)
export const configHandler = handler;
