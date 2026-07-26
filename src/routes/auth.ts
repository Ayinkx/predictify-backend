import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { and, eq, isNull, gt, desc, or, lt } from "drizzle-orm";
import { StrKey } from "@stellar/stellar-sdk";
import { createPerUserRateLimiter } from "../middleware/rateLimit";
import {
  rotateRefreshToken,
  revokeFamily,
} from "../services/refreshTokenService";
import { createChallenge } from "../services/authChallengeService";
import { verifyChallengeAndIssueJwt } from "../services/authVerifyService";
import { RouteErrorFactory } from "../errors";
import { conditionalGet } from "../middleware/etag";
import { accessLog } from "../middleware/accessLog";
import { requestTimeout } from "../middleware/timeout";
import { requireAuth } from "../middleware/requireAuth";
import { AuthenticatedRequest } from "../middleware/auth";
import { db } from "../db/client";
import { refreshTokens } from "../db/schema";
import { logger } from "../config/logger";
import { getRequestId } from "../lib/requestContext";
import { decodeCursor, encodeCursor, clampLimit, DEFAULT_PAGE_SIZE } from "../utils/cursor";

export const authRouter = Router();
authRouter.use(accessLog);
authRouter.use(requestTimeout(15000));

// ── Cursor-paginated session list (no rate limiting on GET) ──────────────

const sessionListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

authRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const reqId = getRequestId();

    try {
      const queryParse = sessionListQuerySchema.safeParse(req.query);
      if (!queryParse.success) {
        logger.warn(
          { reqId, issues: queryParse.error.issues },
          "auth_sessions_list_invalid_query",
        );
        res.status(400).json({
          error: {
            code: "validation_error",
            message:
              queryParse.error.issues[0]?.message ?? "invalid query parameters",
            requestId: reqId,
          },
        });
        return;
      }

      const { cursor, limit: rawLimit } = queryParse.data;
      const limit = clampLimit(rawLimit);
      const userId = (req as AuthenticatedRequest).user!.id;

      const cursorKey = decodeCursor(cursor);

      const conditions = [
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ];

      if (cursorKey) {
        const cursorTime = new Date(cursorKey.sortValue);
        conditions.push(
          or(
            lt(refreshTokens.createdAt, cursorTime),
            and(
              eq(refreshTokens.createdAt, cursorTime),
              lt(refreshTokens.id, cursorKey.id),
            ),
          )!,
        );
      }

      const rows = await db
        .select({
          id: refreshTokens.id,
          familyId: refreshTokens.familyId,
          createdAt: refreshTokens.createdAt,
          expiresAt: refreshTokens.expiresAt,
        })
        .from(refreshTokens)
        .where(and(...conditions))
        .orderBy(desc(refreshTokens.createdAt), desc(refreshTokens.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const data = rows.slice(0, limit);

      // Deduplicate by familyId: keep only the most recent token per family.
      const byFamily = new Map<string, (typeof data)[number]>();
      for (const row of data) {
        const existing = byFamily.get(row.familyId);
        if (!existing || row.createdAt > existing.createdAt) {
          byFamily.set(row.familyId, row);
        }
      }
      const deduped = Array.from(byFamily.values()).sort(
        (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
      );

      const last = deduped[deduped.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              sortValue: last.createdAt.toISOString(),
              id: last.id,
            })
          : null;

      const serialized = deduped.map((r) => ({
        id: r.id,
        familyId: r.familyId,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      }));

      logger.info(
        { reqId, userId, count: serialized.length, hasNext: !!nextCursor },
        "auth_sessions_list_served",
      );

      res.json({ data: serialized, nextCursor });
    } catch (err) {
      next(err);
    }
  },
);

function getAuthRateLimitKey(req: { body?: unknown; socket?: { remoteAddress?: string | null } }): string {
  const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : undefined;
  const stellarAddress = typeof body?.stellarAddress === "string" ? body.stellarAddress.trim() : "";

  if (stellarAddress.length > 0) {
    return `auth:${stellarAddress}`;
  }

  return `ip:${req.socket?.remoteAddress ?? "unknown"}`;
}

authRouter.use(createPerUserRateLimiter({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req) => getAuthRateLimitKey(req),
}));

const refreshTokenBodySchema = z.object({
  refreshToken: z.string().refine((addr) => StrKey.isValidEd25519PublicKey(addr), { message: "Invalid Stellar ed25519 public key" }),
});

function parseRefreshToken(body: unknown): string | null {
  const result = refreshTokenBodySchema.safeParse(body);
  return result.success ? result.data.refreshToken : null;
}

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = parseRefreshToken(req.body);

    if (!refreshToken) {
      throw RouteErrorFactory.badRequest("refreshToken is required and must be a string");
    }

    const result = await rotateRefreshToken(refreshToken);
    if (!result.ok) {
      throw result.error;
    }

    if (conditionalGet(result.value, req, res)) return;

    res.json(result.value);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const refreshToken = parseRefreshToken(req.body);

    if (!refreshToken) {
      throw RouteErrorFactory.badRequest("refreshToken is required and must be a string");
    }

    await revokeFamily(refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/wallet/logout", async (req, res, next) => {
  try {
    const refreshToken = parseRefreshToken(req.body);

    if (!refreshToken) {
      throw RouteErrorFactory.badRequest("refreshToken is required and must be a string");
    }

    await revokeFamily(refreshToken);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const challengeBodySchema = z.object({
  stellarAddress: z.string().refine((addr) => StrKey.isValidEd25519PublicKey(addr), { message: "Invalid Stellar ed25519 public key" }),
});

authRouter.post("/challenge", async (req, res, next) => {
  try {
    const parsed = challengeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation("Invalid request body", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const result = await createChallenge(parsed.data.stellarAddress);
    const payload = {
      nonce: result.nonce,
      expiresAt: result.expiresAt.toISOString(),
    };

    if (conditionalGet(payload, req, res)) return;

    res.status(201).json(payload);
  } catch (e) {
    next(e);
  }
});

const verifyBodySchema = z.object({
  stellarAddress: z.string().refine(
    (addr) => StrKey.isValidEd25519PublicKey(addr),
    { message: "Invalid Stellar ed25519 public key" },
  ),
  nonce: z.string().refine((addr) => StrKey.isValidEd25519PublicKey(addr), { message: "Invalid Stellar ed25519 public key" }),
  signature: z.string().refine((addr) => StrKey.isValidEd25519PublicKey(addr), { message: "Invalid Stellar ed25519 public key" }),
});

authRouter.post("/verify", async (req, res, next) => {
  try {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation("Invalid request body", parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const result = await verifyChallengeAndIssueJwt(
      parsed.data.stellarAddress,
      parsed.data.nonce,
      parsed.data.signature,
    );

    if (!result.ok) {
      throw result.error;
    }

    if (conditionalGet(result.value, req, res)) return;

    res.status(200).json(result.value);
  } catch (e) {
    next(e);
  }
});
