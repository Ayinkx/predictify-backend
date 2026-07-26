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
import type { NextFunction, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { createAuditLog, type RateLimitContext } from "../services/auditService";
import { logger } from "../config/logger";
import { env } from "../config/env";

declare global {
  namespace Express {
    interface Request {
      rateLimitContext?: RateLimitContext;
      correlationId?: string;
    }
  }
}

type AuthenticatedRequest = Request & {
  user?: {
    sub?: string;
    address?: string;
    id?: string;
  };
};

function getClientIp(req: Request): string {
  return req.socket?.remoteAddress ?? "unknown";
}

function getResetAt(res: Response, windowMs: number): string {
  const resetHeader = res.getHeader("RateLimit-Reset");
  if (resetHeader !== undefined) {
    const resetSeconds = Number(resetHeader);
    if (Number.isFinite(resetSeconds)) {
      return new Date(resetSeconds * 1000).toISOString();
    }
  }

  return new Date(Date.now() + windowMs).toISOString();
}

function getRetryAfter(res: Response, windowMs: number): number {
  const retryAfter = Number(res.getHeader("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.ceil(retryAfter);
  }

  const resetHeader = Number(res.getHeader("RateLimit-Reset"));
  if (Number.isFinite(resetHeader)) {
    return Math.max(1, Math.ceil(resetHeader - Date.now() / 1000));
  }

  return Math.max(1, Math.ceil(windowMs / 1000));
}

function attachContext(
  req: Request,
  res: Response,
  blocked: boolean,
  limit: number,
  windowMs: number,
): RateLimitContext {
  const remainingHeader = Number(res.getHeader("RateLimit-Remaining"));
  const remaining = Number.isFinite(remainingHeader)
    ? Math.max(0, remainingHeader)
    : blocked
      ? 0
      : limit;

  const context: RateLimitContext = {
    limit,
    remaining,
    resetAt: getResetAt(res, windowMs),
    blocked,
  };

  req.rateLimitContext = context;
  return context;
}

function getAuthenticatedUserKey(req: Request): string | undefined {
  const authenticatedRequest = req as AuthenticatedRequest;
  const identity =
    authenticatedRequest.user?.address ??
    authenticatedRequest.user?.sub ??
    authenticatedRequest.user?.id;

  if (typeof identity !== "string" || identity.trim().length === 0) {
    return undefined;
  }

  return `user:${identity.trim()}`;
}

export function createRateLimiter(options: Partial<Options> = {}): RateLimitRequestHandler {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const configuredLimit = options.limit;
  const limit = typeof configuredLimit === "number" ? configuredLimit : 100;

  const limiter = rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipFailedRequests: false,
    ...options,
    keyGenerator: options.keyGenerator ?? ((req: Request) => getClientIp(req)),
    handler: (req: Request, res: Response) => {
      const correlationId = (req.correlationId ??= uuidv4());
      const context = attachContext(req, res, true, limit, windowMs);
      const retryAfter = getRetryAfter(res, windowMs);

      res.setHeader("Retry-After", String(retryAfter));
      void createAuditLog({
        action: "rate_limit.blocked",
        ip: getClientIp(req),
        correlationId,
        rateLimitContext: context,
      }).catch(() => undefined);

      res.status(429).json({
        error: {
          code: "rate_limit_exceeded",
          message: "Too many requests",
          retryAfter,
          resetAt: context.resetAt,
        },
      });
    },
  });

  return ((req: Request, res: Response, next: NextFunction) => {
    req.correlationId ??= uuidv4();
    limiter(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }

      attachContext(req, res, false, limit, windowMs);
      next();
    });
  }) as RateLimitRequestHandler;
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
