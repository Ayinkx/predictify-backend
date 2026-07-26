/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { webhooksMetricsMiddleware } from "../metrics/webhooksMetrics";
import type { IWebhookDispatcher } from "../services/webhookDispatcher";
import type { DlqRow, WebhookStore } from "../services/webhookStore";
import { RouteErrorFactory } from "../errors";

export interface AdminWebhookDeps {
  store: WebhookStore;
  dispatcher: IWebhookDispatcher;
}

function serializeDlqRow(row: DlqRow) {
  return {
    id: row.id,
    originalId: row.originalId,
    eventId: row.eventId,
    eventType: row.eventType,
    targetUrl: row.targetUrl,
    payloadBase64: row.payload.toString("base64"),
    signature: row.signature,
    headers: row.headers,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    failedAt: row.failedAt.toISOString(),
    replayedAt: row.replayedAt ? row.replayedAt.toISOString() : null,
    replayDeliveryId: row.replayDeliveryId,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAdminWebhooksRouter(deps: AdminWebhookDeps): Router {
  const router = Router();
  router.use(webhooksMetricsMiddleware);
  router.use(requireAdmin);

  router.get("/dlq", async (req, res, next) => {
    try {
      const page = await deps.store.listDlq(req.query.cursor, req.query.limit);
      return res.json({
        data: page.data.map(serializeDlqRow),
        nextCursor: page.nextCursor,
      });
    } catch (e) {
      return next(e);
    }
  });

  router.post("/dlq/:id/replay", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        throw RouteErrorFactory.badRequest("Invalid ID format");
      }

      const row = await deps.store.getDlqRow(id);
      if (!row) {
        throw RouteErrorFactory.notFound("DLQ row not found");
      }
      if (row.replayedAt) {
        return res.status(409).json({
          error: { type: "already_replayed" },
          replayDeliveryId: row.replayDeliveryId,
        });
      }

      const fresh: any = await deps.dispatcher.replayFromDlq(row);
      if (!fresh) {
        return res.status(409).json({ error: { type: "already_replayed" } });
      }

      return res.status(202).json({
        data: {
          deliveryId: fresh.id,
          status: fresh.status,
          attempts: fresh.attempts,
        },
      });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}
