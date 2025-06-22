import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import middy from "@middy/core";
import httpErrorHandler from "@middy/http-error-handler";
import httpCors from "@middy/http-cors";
import httpJsonBodyParser from "@middy/http-json-body-parser";

import type { RateLimitRequest, RateLimitResponse } from "./types";

// Initialize Hono app
const app = new Hono();

// Routes
app.post("/check", async (c) => {
  try {
    const body = (await c.req.json()) as RateLimitRequest;

    // TODO: Implement rate limiting logic
    const response: RateLimitResponse = {
      allowed: true,
      remaining: 2,
      resetTime: Date.now() + 3600000, // 1 hour from now
      metadata: {
        serviceId: body.serviceId,
        windowMs: 3600000,
        maxRequests: 3,
      },
    };

    return c.json(response);
  } catch (error) {
    console.error("Rate limit check error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/config", async (c) => {
  // TODO: Implement config retrieval
  return c.json({ message: "Config endpoint - TODO" });
});

app.post("/config", async (c) => {
  // TODO: Implement config creation
  return c.json({ message: "Config creation - TODO" });
});

app.get("/config/:serviceId", async (c) => {
  const serviceId = c.req.param("serviceId");
  // TODO: Implement specific config retrieval
  return c.json({ message: `Config for ${serviceId} - TODO` });
});

app.put("/config/:serviceId", async (c) => {
  const serviceId = c.req.param("serviceId");
  // TODO: Implement config update
  return c.json({ message: `Config update for ${serviceId} - TODO` });
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
