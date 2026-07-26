/**
 * User-facing webhook subscription management.
 *
 * Mounted at `/api/webhooks`. All endpoints require authentication and
 * are subject to a **per-user** rate limit configured via:
 *
 *   - WEBHOOKS_RATE_LIMIT_WINDOW_MS  (default 15 min)
 *   - WEBHOOKS_RATE_LIMIT_MAX        (default 100 requests)
 *
 * Rate-limit keying is based on the authenticated stellar address populated by
 * `requireAuth`, so quota is tracked independently per user, not per IP.
 *
 * Endpoints:
 *   GET    /          — list webhook subscriptions
 *   POST   /          — create a new webhook subscription
 *   GET    /:id       — fetch a single subscription (by UUID)
 *   PATCH  /:id       — update a subscription (URL, events, active flag)
 *   DELETE /:id       — deactivate / remove a subscription
 *
 * All mutations are protected by the idempotency layer that runs before
 * any `/api/*` POST / PATCH handler in `src/index.ts`.
 */

import { Router } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { webhookSubscriptions } from "../db/schema";
import { requireAuth } from "../middleware/requireAuth";
import { webhooksRateLimiter } from "../middleware/rateLimit";
import { RouteErrorFactory } from "../errors";
import { logger } from "../config/logger";
import { getRequestId } from "../lib/requestContext";

// ---------------------------------------------------------------------------
// Zod schemas — boundary validation
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const idParamSchema = z.string().regex(UUID_RE, "Invalid subscription ID");

const EVENTS = [
  "prediction.created",
  "prediction.resolved",
  "market.created",
  "market.resolved",
  "dispute.opened",
  "dispute.resolved",
] as const;

const createSchema = z.object({
  url: z.string().url("Subscription URL must be a valid HTTPS URL"),
  events: z
    .array(z.enum(EVENTS))
    .min(1, "At least one event type must be selected"),
});

const updateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SubscriptionRow = typeof webhookSubscriptions.$inferSelect;

function serializeSub(row: SubscriptionRow) {
  return {
    id: row.id,
    url: row.url,
    events: row.events as readonly string[],
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const webhooksRouter = Router();

// ┌─ Per-user rate limit first (keys on stellarAddress/user.id/IP fallback ─┐
// │  requireAuth second: populates req.user → limiter keys on user identity           │
// └───────────────────────────────────────────────────────────────────────┘
webhooksRouter.use(webhooksRateLimiter);
webhooksRouter.use(requireAuth);

// ── List ──────────────────────────────────────────────────────────────────

webhooksRouter.get("/", async (req, res, next) => {
  const reqId = getRequestId();
  const userId = req.user!.id;

  try {
    const rows = await db
      .select()
      .from(webhookSubscriptions)
      .orderBy(webhookSubscriptions.createdAt);

    logger.debug(
      { reqId, userId, count: rows.length },
      "webhooks_listed",
    );

    return res.json({ data: rows.map(serializeSub) });
  } catch (err) {
    return next(err);
  }
});

// ── Create ────────────────────────────────────────────────────────────────

webhooksRouter.post("/", async (req, res, next) => {
  const reqId = getRequestId();
  const userId = req.user!.id;

  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      logger.warn(
        { reqId, userId, issues: parsed.error.issues },
        "webhooks_create_validation_failed",
      );
      return res.status(400).json({
        error: {
          code: "validation_error",
          message: issue.message,
          requestId: reqId,
        },
      });
    }

    const { url, events } = parsed.data;
    const secret = uuidv4();

    const [row] = await db
      .insert(webhookSubscriptions)
      .values({ url, events, secret })
      .returning();

    logger.info(
      { reqId, userId, subscriptionId: row.id },
      "webhooks_subscription_created",
    );

    return res.status(201).json({
      data: { ...serializeSub(row), secret },
    });
  } catch (err) {
    return next(err);
  }
});

// ── Get by id ─────────────────────────────────────────────────────────────

webhooksRouter.get("/:id", async (req, res, next) => {
  const reqId = getRequestId();
  const userId = req.user!.id;

  try {
    const idParse = idParamSchema.safeParse(req.params.id);
    if (!idParse.success) {
      throw RouteErrorFactory.validation(idParse.error.issues[0]?.message ?? "invalid id");
    }

    const [row] = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, idParse.data));

    if (!row) {
      logger.debug(
        { reqId, userId, subscriptionId: idParse.data },
        "webhooks_subscription_not_found",
      );
      throw RouteErrorFactory.notFound("Subscription not found");
    }

    return res.json({ data: serializeSub(row) });
  } catch (err) {
    return next(err);
  }
});

// ── Update ────────────────────────────────────────────────────────────────

webhooksRouter.patch("/:id", async (req, res, next) => {
  const reqId = getRequestId();
  const userId = req.user!.id;

  try {
    const idParse = idParamSchema.safeParse(req.params.id);
    if (!idParse.success) {
      throw RouteErrorFactory.validation(idParse.error.issues[0]?.message ?? "invalid id");
    }

    const bodyParse = updateSchema.safeParse(req.body);
    if (!bodyParse.success) {
      const issue = bodyParse.error.issues[0]!;
      return res.status(400).json({
        error: {
          code: "validation_error",
          message: issue.message,
          requestId: reqId,
        },
      });
    }

    const [existing] = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, idParse.data));

    if (!existing) {
      throw RouteErrorFactory.notFound("Subscription not found");
    }

    const [updated] = await db
      .update(webhookSubscriptions)
      .set({ ...bodyParse.data, updatedAt: new Date() })
      .where(eq(webhookSubscriptions.id, idParse.data))
      .returning();

    logger.info(
      { reqId, userId, subscriptionId: updated.id },
      "webhooks_subscription_updated",
    );

    return res.json({ data: serializeSub(updated) });
  } catch (err) {
    return next(err);
  }
});

// ── Delete / deactivate ───────────────────────────────────────────────────

webhooksRouter.delete("/:id", async (req, res, next) => {
  const reqId = getRequestId();
  const userId = req.user!.id;

  try {
    const idParse = idParamSchema.safeParse(req.params.id);
    if (!idParse.success) {
      throw RouteErrorFactory.validation(idParse.error.issues[0]?.message ?? "invalid id");
    }

    const result = await db
      .delete(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, idParse.data));

    if (result.rowCount === 0) {
      throw RouteErrorFactory.notFound("Subscription not found");
    }

    logger.info(
      { reqId, userId, subscriptionId: idParse.data },
      "webhooks_subscription_deleted",
    );

    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});
