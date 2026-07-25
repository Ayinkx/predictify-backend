import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { db } from "../db";
import { webhookSubscriptions } from "../db/schema";
import { createSubscription, deactivateSubscription } from "../services/webhookDispatcher";
import { isKnownEventType } from "../services/webhookCatalog";
import { validateHttpsUrl, validateSsrf } from "../utils/url";
import { logger } from "../config/logger";
import { RouteErrorFactory } from "../errors";
import { getRequestId } from "../lib/requestContext";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../middleware/auth";

export const webhooksRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const createSubscriptionSchema = z.object({
  url: z.string().url(),
  events: z.array(
    z.string().refine((e) => e === "*" || isKnownEventType(e), {
      message: "Invalid event type",
    })
  ).min(1),
}).strict();

webhooksRouter.post("/subscriptions", requireAuth, async (req, res, next) => {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? getRequestId();
  try {
    const parsed = createSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw RouteErrorFactory.validation(
        "Invalid request body",
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }

    const { url, events } = parsed.data;

    // HTTPS verification
    const urlResult = validateHttpsUrl(url);
    if (!urlResult.valid) {
      throw RouteErrorFactory.badRequest(
        urlResult.error?.includes("evidenceUri") ? "webhook URL must use HTTPS" : (urlResult.error ?? "Invalid URL format")
      );
    }

    // SSRF verification
    const ssrfResult = await validateSsrf(url);
    if (!ssrfResult.valid) {
      logger.warn({ url, error: ssrfResult.error, correlationId }, "SSRF check failed for webhook subscription url");
      throw RouteErrorFactory.badRequest(ssrfResult.error ?? "SSRF check failed");
    }

    const sub = await createSubscription(db, { url, events });

    logger.info(
      {
        event: "webhook_subscription_created",
        correlationId,
        userId: (req as AuthenticatedRequest).user?.id,
        subscriptionId: sub.id,
        url,
        events,
      },
      "Webhook subscription created",
    );

    res.status(201).json({ data: sub });
  } catch (e) {
    next(e);
  }
});

webhooksRouter.delete("/subscriptions/:id", requireAuth, async (req, res, next) => {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? getRequestId();
  try {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      throw RouteErrorFactory.badRequest("Invalid ID format");
    }

    // Check if subscription exists and is active
    const sub = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id))
      .limit(1);

    if (sub.length === 0 || !sub[0].active) {
      throw RouteErrorFactory.notFound("Subscription not found");
    }

    await deactivateSubscription(db, id);

    logger.info(
      {
        event: "webhook_subscription_deactivated",
        correlationId,
        userId: (req as AuthenticatedRequest).user?.id,
        subscriptionId: id,
      },
      "Webhook subscription deactivated",
    );

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
