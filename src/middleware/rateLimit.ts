  
/* eslint-disable @typescript-eslint/no-namespace */ 
/**
 * @module rateLimit
 *
 * Provides configurable Express rate-limit middleware built on
 * `express-rate-limit`. Two variants are exposed:
 *
 *   - `createRateLimiter`        — generic, defaults to IP-keyed (global use)
 *   - `createUserRateLimiter`    — per-user keyed, falls back to IP when anonymous
 *
 * Pre-configured instances (e.g. `webhooksRateLimiter`) are also exported
 * for routes that consume the rate-limit env vars.
 *
 * Every request — whether allowed or blocked — has its rate-limit context
 * attached to `req.rateLimitContext` for downstream use (audit, status pages).
 *
 * When a request is blocked (429), an audit log entry is created via
 * `auditService` before the error response is sent.
 *
 * Error responses follow the project envelope: `{ error: { code, ... } }`
 */

import rateLimit, { type Options, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { createAuditLog, type RateLimitContext } from "../services/auditService";
import { logger } from "../config/logger";
import { env } from "../config/env";

// ---------------------------------------------------------------------------
// Request augmentation
// ---------------------------------------------------------------------------

/**
 * Extends the Express Request type to carry rate-limit context
 * that can be consumed by downstream middleware or route handlers.
 */
declare global {
   
  namespace Express {
    interface Request {
      /** Rate-limit context set by the rateLimit middleware on every request */
      rateLimitContext?: RateLimitContext;
      /** Correlation ID for cross-log tracing */
      correlationId?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the client IP from the request, preferring the
 * `x-forwarded-for` header when behind a proxy.
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express rate-limit middleware with audit-trail enrichment.
 *
 * On every request (allowed or blocked) the middleware attaches a
 * `rateLimitContext` object to `req` containing the limit, remaining
 * count, reset timestamp, and whether the request was blocked.
 *
 * On block it:
 * 1. Fires an audit log entry with `action: "rate_limit.blocked"`
 * 2. Returns a 429 JSON response following the `{ error: { code } }` envelope
 *
 * @param options - Partial `express-rate-limit` options (windowMs, limit, etc.)
 *   Defaults: 100 requests per 15 minutes.
 * @returns Configured rate-limit middleware
 *
 * @example
 * // Apply globally
 * app.use(createRateLimiter());
 *
 * @example
 * // Apply stricter limits to auth routes
 * app.use("/api/auth", createRateLimiter({ limit: 10, windowMs: 60_000 }));
 */
export function createRateLimiter(options: Partial<Options> = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipFailedRequests: false,

    ...options,

    // Attach rate-limit context to req on every request (allowed + blocked)
    skip: (req: Request, res: Response): boolean => {
      const correlationId = (req.correlationId ??= uuidv4());

      // Grab headers set by express-rate-limit before skip runs
      // (they're set on the response by the time skip is evaluated)
      const limit = Number(res.getHeader("RateLimit-Limit") ?? options.limit ?? 100);
      const remaining = Number(res.getHeader("RateLimit-Remaining") ?? limit);
      const resetHeader = res.getHeader("RateLimit-Reset");
      const resetAt = resetHeader
        ? new Date(Number(resetHeader) * 1000).toISOString()
        : new Date(Date.now() + (options.windowMs ?? 15 * 60 * 1000)).toISOString();

      req.rateLimitContext = {
        limit,
        remaining,
        resetAt,
        blocked: false, // will be overridden in handler if blocked
      };

      logger.debug(
        { correlationId, ip: getClientIp(req), rateLimitContext: req.rateLimitContext },
        "rate_limit_checked",
      );

      return false; // never skip — always apply the limit
    },

    // Fired when the request is blocked (429)
    handler: async (req: Request, res: Response): Promise<void> => {
      const correlationId = (req.correlationId ??= uuidv4());
      const ip = getClientIp(req);

      const limit = Number(res.getHeader("RateLimit-Limit") ?? options.limit ?? 100);
      const resetHeader = res.getHeader("RateLimit-Reset");
      const resetAt = resetHeader
        ? new Date(Number(resetHeader) * 1000).toISOString()
        : new Date(Date.now() + (options.windowMs ?? 15 * 60 * 1000)).toISOString();

      const rateLimitContext: RateLimitContext = {
        limit,
        remaining: 0,
        resetAt,
        blocked: true,
      };

      // Enrich req so downstream handlers can inspect the context
      req.rateLimitContext = rateLimitContext;

      // Fire audit log — errors are swallowed inside createAuditLog
      await createAuditLog({
        action: "rate_limit.blocked",
        walletAddress: (req as { user?: { stellarAddress?: string } }).user?.stellarAddress,
        ip,
        correlationId,
        rateLimitContext,
      });

      // Seconds the client should wait before retrying. Derived from the
      // window reset time and never negative; defaults to a 1s minimum so the
      // header is always actionable.
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000),
      );

      logger.warn(
        { correlationId, ip, rateLimitContext, retryAfterSeconds },
        "rate_limit_blocked",
      );

      // Standardized 429: RFC 7231 `Retry-After` header (seconds) plus a
      // structured envelope echoing the same value and the reset timestamp so
      // clients can back off without parsing headers.
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: {
          code: "rate_limit_exceeded",
          message: "Too many requests. Please retry after the indicated delay.",
          retryAfter: retryAfterSeconds,
          resetAt,
        },
      });
    },
  });
}

/**
 * Default rate limiter instance — 100 req / 15 min, keyed by IP.
 * Import this for general application-wide use.
 */
export const defaultRateLimiter = createRateLimiter();

// ---------------------------------------------------------------------------
// Per-user rate limiting (for authenticated routes)
// ---------------------------------------------------------------------------

/**
 * Returns a stable identifier for rate-limit keying that prefers
 * authenticated user identity over network identity.
 *
 * Priority:
 *   1. `req.user.stellarAddress` — the primary user key on this service
 *   2. `req.user.id`              — DB UUID fallback
 *   3. Client IP (via XFF / socket) — anonymous fallback
 */
export function getUserRateKey(req: Request): string {
  if (req.user?.stellarAddress) return `user:${req.user.stellarAddress}`;
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${getClientIp(req)}`;
}

/**
 * Creates a rate-limit middleware keyed by authenticated user identity.
 *
 * Use this for user-owned routes (e.g. `/api/webhooks`, `/api/me/*`) so
 * that quota is tracked per Stellar address rather than per IP — shared
 * NAT / VPN egress won't penalise multiple users coming from the same IP.
 *
 * Anonymous callers (no `req.user`) fall back to IP keying so the limiter
 * is always enforceable regardless of authentication state.
 *
 * @param options - Partial express-rate-limit options; `keyGenerator` is
 *   overridden internally to use {@link getUserRateKey}.
 * @returns Configured rate-limit middleware
 *
 * @example
 *   router.use(createUserRateLimiter({ limit: 50, windowMs: 60_000 }));
 */
export function createUserRateLimiter(
  options: Partial<Options> = {},
): RateLimitRequestHandler {
  return createRateLimiter({
    ...options,
    keyGenerator: (req: Request) => getUserRateKey(req as Request),
  });
}

/**
 * Pre-configured per-user rate limiter for `/api/webhooks` routes.
 *
 * Reads `WEBHOOKS_RATE_LIMIT_WINDOW_MS` and `WEBHOOKS_RATE_LIMIT_MAX` from
 * the environment; defaults to 100 requests per 15 minutes per user.
 */
export const webhooksRateLimiter = createUserRateLimiter({
  windowMs: env.WEBHOOKS_RATE_LIMIT_WINDOW_MS,
  limit: env.WEBHOOKS_RATE_LIMIT_MAX,
});
