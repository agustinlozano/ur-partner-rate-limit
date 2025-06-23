# 🚀 Next.js Integration Guide

This guide explains how to use the **Rate Limiting Microservice** from your Next.js application securely and efficiently.

## 📋 Table of Contents

- [Security Considerations](#-security-considerations)
- [Automatic IP Extraction](#-automatic-ip-extraction)
- [Client Components](#-client-components)
- [Server Components & API Routes](#️-server-components--api-routes)
- [Next.js Middleware](#-nextjs-middleware)
- [Error Handling](#-error-handling)
- [Recommended Patterns](#-recommended-patterns)

## 🔒 **Security Considerations**

### ❌ **DON'T Do This:**

```javascript
// INSECURE - Client can lie about their IP
const response = await fetch("/api/rate-limit", {
  body: JSON.stringify({
    serviceId: "upload-images",
    clientId: "1.2.3.4", // ← Spoofable
  }),
});
```

### ✅ **DO This:**

```javascript
// SECURE - Server extracts IP automatically
const response = await fetch("/api/rate-limit", {
  body: JSON.stringify({
    serviceId: "upload-images",
    // clientId is automatically extracted from HTTP headers
  }),
});
```

## 🌐 **Automatic IP Extraction**

The Rate Limiting Service automatically extracts the real client IP using these headers in order of priority:

1. `x-forwarded-for` (most common)
2. `x-real-ip`
3. `x-client-ip`
4. `cf-connecting-ip` (Cloudflare)
5. `x-forwarded`
6. `forwarded-for`
7. `forwarded`

### Headers handled automatically:

- **Vercel**: `x-forwarded-for`
- **Cloudflare**: `cf-connecting-ip`
- **AWS CloudFront**: `x-forwarded-for`
- **Nginx**: `x-real-ip`

## 💻 **Client Components**

### Example: Upload Button with Rate Limiting

```typescript
"use client";

import { useState } from "react";

export default function UploadButton() {
  const [isUploading, setIsUploading] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState<any>(null);

  const handleUpload = async () => {
    try {
      // ✅ Check rate limit BEFORE doing upload
      const rateLimitResponse = await fetch(
        "https://your-rate-limit-api.com/check",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // ✅ Include auth token (extracts tier automatically)
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            serviceId: "upload-images",
            // ❌ DON'T include clientId - extracted automatically
            metadata: {
              filename: "photo.jpg",
              fileSize: 1024000,
              action: "upload",
            },
          }),
        }
      );

      const rateLimitResult = await rateLimitResponse.json();
      setRateLimitInfo(rateLimitResult);

      if (!rateLimitResult.allowed) {
        alert(
          `Rate limit exceeded! Try again in ${rateLimitResult.retryAfter} seconds`
        );
        return;
      }

      // ✅ Proceed with upload only if allowed
      setIsUploading(true);
      await performUpload();
    } catch (error) {
      console.error("Rate limit check failed:", error);
      // ✅ Fail open - allow upload if rate limit service is down
      await performUpload();
    } finally {
      setIsUploading(false);
    }
  };

  const performUpload = async () => {
    // Your upload logic here
    const formData = new FormData();
    // ... upload logic
  };

  return (
    <div className="space-y-4">
      <button
        onClick={handleUpload}
        disabled={isUploading}
        className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
      >
        {isUploading ? "Uploading..." : "Upload Photo"}
      </button>

      {rateLimitInfo && (
        <div className="text-sm text-gray-600">
          <p>Remaining uploads: {rateLimitInfo.remaining}</p>
          <p>Resets at: {new Date(rateLimitInfo.resetTime).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}
```

## 🏗️ **Server Components & API Routes**

### API Route with Rate Limiting

```typescript
// app/api/upload/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // ✅ Forward IP headers to rate limiter
    const rateLimitResponse = await fetch(
      process.env.RATE_LIMIT_SERVICE_URL + "/check",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ✅ Forward headers containing real IP
          "x-forwarded-for": request.headers.get("x-forwarded-for") || "",
          "x-real-ip": request.headers.get("x-real-ip") || "",
          "cf-connecting-ip": request.headers.get("cf-connecting-ip") || "",
          // ✅ Forward authentication to extract user tier
          authorization: request.headers.get("authorization") || "",
        },
        body: JSON.stringify({
          serviceId: "upload-images",
          // ❌ DON'T send clientId - extracted from headers
          metadata: {
            serverSide: true,
            route: "/api/upload",
            method: request.method,
          },
        }),
      }
    );

    const rateLimitResult = await rateLimitResponse.json();

    // ✅ Block request if exceeds limit
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          retryAfter: rateLimitResult.retryAfter,
          resetTime: rateLimitResult.resetTime,
        },
        {
          status: 429,
          headers: {
            "Retry-After": rateLimitResult.retryAfter?.toString() || "60",
            "X-RateLimit-Limit":
              rateLimitResult.metadata.maxRequests.toString(),
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.resetTime.toString(),
          },
        }
      );
    }

    // ✅ Proceed with endpoint logic
    const body = await request.json();

    // Your upload logic here...
    const uploadResult = await processUpload(body);

    return NextResponse.json({
      success: true,
      data: uploadResult,
      // ✅ Include rate limiting info in response
      rateLimitInfo: {
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime,
      },
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

## 🛡️ **Next.js Middleware**

### Global Rate Limiting

```typescript
// middleware.ts
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // ✅ Apply rate limiting only to specific routes
  if (shouldApplyRateLimit(request.nextUrl.pathname)) {
    try {
      const rateLimitResponse = await fetch(
        process.env.RATE_LIMIT_SERVICE_URL + "/check",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // ✅ Forward all relevant headers
            "x-forwarded-for":
              request.headers.get("x-forwarded-for") || request.ip || "",
            "x-real-ip": request.headers.get("x-real-ip") || "",
            "cf-connecting-ip": request.headers.get("cf-connecting-ip") || "",
            authorization: request.headers.get("authorization") || "",
          },
          body: JSON.stringify({
            serviceId: getServiceIdForPath(request.nextUrl.pathname),
            metadata: {
              path: request.nextUrl.pathname,
              method: request.method,
              middleware: true,
            },
          }),
        }
      );

      const rateLimitResult = await rateLimitResponse.json();

      if (!rateLimitResult.allowed) {
        return new NextResponse(
          JSON.stringify({
            error: "Rate limit exceeded",
            retryAfter: rateLimitResult.retryAfter,
            path: request.nextUrl.pathname,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": rateLimitResult.retryAfter?.toString() || "60",
              "X-RateLimit-Limit":
                rateLimitResult.metadata.maxRequests.toString(),
              "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            },
          }
        );
      }

      // ✅ Add rate limit headers to successful response
      const response = NextResponse.next();
      response.headers.set(
        "X-RateLimit-Remaining",
        rateLimitResult.remaining.toString()
      );
      response.headers.set(
        "X-RateLimit-Reset",
        rateLimitResult.resetTime.toString()
      );

      return response;
    } catch (error) {
      console.error("Rate limit check failed:", error);
      // ✅ Fail open - continue if rate limit service is down
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}

function shouldApplyRateLimit(pathname: string): boolean {
  const protectedPaths = ["/api/upload", "/api/protected", "/api/user"];

  return protectedPaths.some((path) => pathname.startsWith(path));
}

function getServiceIdForPath(pathname: string): string {
  if (pathname.startsWith("/api/upload")) return "upload-images";
  if (pathname.startsWith("/api/auth")) return "auth";
  return "api-general";
}

export const config = {
  matcher: ["/api/:path*"],
};
```

## ⚠️ **Error Handling**

### "Fail Open" Strategy

```typescript
async function checkRateLimitSafely(serviceId: string, metadata?: any) {
  try {
    const response = await fetch("/api/rate-limit/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, metadata }),
      // ✅ Timeout to avoid blocking
      signal: AbortSignal.timeout(2000), // 2 seconds max
    });

    if (!response.ok) {
      console.warn("Rate limit service returned error:", response.status);
      return { allowed: true, failOpen: true }; // ✅ Allow if there's an error
    }

    return await response.json();
  } catch (error) {
    console.error("Rate limit check failed:", error);
    return { allowed: true, failOpen: true }; // ✅ Allow if there's an error
  }
}
```

## 🎯 **Recommended Patterns**

### 1. Custom Hook for Client Components

```typescript
// hooks/useRateLimit.ts
import { useState, useCallback } from "react";

export function useRateLimit(serviceId: string) {
  const [rateLimitInfo, setRateLimitInfo] = useState<any>(null);
  const [isChecking, setIsChecking] = useState(false);

  const checkRateLimit = useCallback(
    async (metadata?: any) => {
      setIsChecking(true);
      try {
        const response = await fetch("/api/rate-limit/check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            serviceId,
            metadata,
          }),
        });

        const result = await response.json();
        setRateLimitInfo(result);
        return result;
      } catch (error) {
        console.error("Rate limit check failed:", error);
        return { allowed: true, failOpen: true };
      } finally {
        setIsChecking(false);
      }
    },
    [serviceId]
  );

  return {
    rateLimitInfo,
    checkRateLimit,
    isChecking,
  };
}
```

---

## 📋 **Implementation Checklist**

- [ ] ✅ Never send `clientId` from the client
- [ ] ✅ Forward IP headers correctly
- [ ] ✅ Implement "fail open" strategy
- [ ] ✅ Add timeouts to requests
- [ ] ✅ Handle errors gracefully
- [ ] ✅ Log for debugging
- [ ] ✅ Test with different proxies/CDNs
- [ ] ✅ Configure environment variables
- [ ] ✅ Implement retry logic
- [ ] ✅ Document services that use rate limiting

With this guide you have everything you need to integrate the Rate Limiting Service securely and efficiently in your Next.js app! 🎉
