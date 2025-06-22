# Rate Limit Service

Un microservicio de rate limiting desacoplado para AWS Lambda usando Hono + Middy + DynamoDB.

## 🎯 **Propósito**

Este servicio proporciona rate limiting centralizado y reutilizable para múltiples APIs y microservicios, usando una arquitectura desacoplada que permite:

- ✅ **Configuración flexible** por servicio/endpoint
- ✅ **Rate limiting por IP** u otros identificadores
- ✅ **Sin VPC** - Performance optimizado
- ✅ **DynamoDB nativo** - Sin Redis/ElastiCache
- ✅ **Escalabilidad automática**

## 🏗️ **Arquitectura**

```
Internet → API Gateway → Lambda (Hono + Middy) → DynamoDB
                      ↓
                 Rate Limit Check
```

## 📋 **Contrato de API**

### Request

```typescript
{
  serviceId: "upload-images" | "api-general" | "auth",
  clientId: "IP_ADDRESS" | "USER_ID" | "API_KEY",
  metadata?: {
    userTier?: "free" | "pro" | "enterprise",
    endpoint?: string,
    userId?: string
  }
}
```

### Response

```typescript
{
  allowed: boolean,
  remaining: number,
  resetTime: number,        // Unix timestamp
  retryAfter?: number,      // Seconds if blocked
  metadata: {
    serviceId: string,
    windowMs: number,
    maxRequests: number
  }
}
```

## 🛠️ **Stack Tecnológico**

- **Runtime**: Node.js 20 (ARM64)
- **Framework**: Hono (para routing)
- **Middleware**: Middy (para Lambda middleware)
- **Database**: DynamoDB (rate limit storage)
- **Infrastructure**: Serverless Framework
- **Build**: esbuild (optimización)

## 📊 **Configuración Default**

- **General**: 3 requests/hora
- **Upload Images**: 2 requests/2 horas
- **Configurable por tier** (free/pro/enterprise)

## 🚀 **Instalación**

```bash
# Desde el directorio rate-limit-service
pnpm install

# Build
pnpm run build

# Deploy
pnpm run deploy

# Development
pnpm run dev
```

## 📝 **Endpoints**

- `POST /check` - Verificar rate limit
- `GET /config` - Ver configuraciones
- `POST /config` - Crear configuración
- `GET /config/{serviceId}` - Ver configuración específica
- `PUT /config/{serviceId}` - Actualizar configuración

## 🔧 **Desarrollo**

```bash
# Type checking
pnpm run type-check

# Linting
pnpm run lint
pnpm run lint:fix

# Testing
pnpm run test
pnpm run test:watch
```

## 🗄️ **Esquema DynamoDB**

### RateLimitConfig

```
serviceId (PK) | config
"upload-images" | { default: { windowMs: 7200000, maxRequests: 2 } }
```

### RateLimitUsage

```
pk (PK)                | sk (SK)     | timestamp | ttl
"upload-images#IP123"  | "timestamp" | 1234567   | 1234567890
```

## 🎯 **Uso desde otros servicios**

```typescript
// En cualquier Lambda/API
const response = await fetch("https://rate-limit-api.com/check", {
  method: "POST",
  body: JSON.stringify({
    serviceId: "upload-images",
    clientId: clientIp,
  }),
});

const { allowed, retryAfter } = await response.json();

if (!allowed) {
  return { statusCode: 429, body: `Retry after ${retryAfter}s` };
}

// Continuar con lógica de negocio...
```

## 📈 **Performance**

- **Cold start**: <500ms
- **Warm execution**: <50ms
- **Memory**: 512MB
- **Timeout**: 10s

## 🔄 **Ventajas vs Redis/ElastiCache**

| Aspecto       | DynamoDB     | Redis/ElastiCache |
| ------------- | ------------ | ----------------- |
| VPC           | No requerido | Requerido         |
| Cold Start    | ~500ms       | ~2-3s             |
| Configuración | Simple       | Compleja          |
| Costo         | Pay-per-use  | Instancia fija    |
| Escalabilidad | Automática   | Manual            |

## 🚦 **Estado del Proyecto**

- ✅ Setup completado (Hono + Middy)
- 🔲 Implementación pendiente
- 🔲 Testing pendiente
- 🔲 Deployment pendiente

## 📚 **Próximos Pasos**

1. Implementar handlers con Hono
2. Integrar Middy middleware
3. Configurar lógica de rate limiting
4. Testing completo
5. Deploy y pruebas
