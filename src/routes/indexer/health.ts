/**
 * Indexer health router.
 *
 * GET /api/indexer/health
 *   Reports the indexer's liveness by comparing the persisted cursor (the last
 *   ledger the indexer has processed) against the current chain tip. The
 *   difference ("lag") is the primary signal that the indexer has fallen behind.
 *
 *   Response status:
 *     - "ok"       — lag is within INDEXER_HEALTH_MAX_LAG ledgers
 *     - "degraded" — lag exceeds the threshold (indexer is behind)
 *     - "down"     — the chain tip could not be reached (RPC error)
 *
 *   The endpoint always returns HTTP 200 with a status field so that uptime
 *   probes can scrape it without tripping on non-2xx responses; orchestrators
 *   should alert on the `status` field instead.
 *
 *   Emits a strong `ETag` (see `../../middleware/etag`) derived from the
 *   response body and honors `If-None-Match` with a `304 Not Modified` when
 *   the caller already has the current state. This is a meaningful bandwidth
 *   saver here because monitoring/orchestrator probes poll this endpoint far
 *   more often than the underlying cursor/chain-tip actually change.
 */

import { Router } from "express";
import { indexerService } from "../../services/indexerService";
import { logger } from "../../config/logger";
import { getRequestId } from "../../lib/requestContext";
import { conditionalGet } from "../../middleware/etag";

/** Maximum acceptable cursor lag (in ledgers) before the indexer is "degraded". */
const DEFAULT_MAX_LAG = 50;

function resolveMaxLag(): number {
  const raw = process.env.INDEXER_HEALTH_MAX_LAG;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_LAG;
}

export function createIndexerHealthRouter(): Router {
  const router = Router();

  router.get("/health", async (req, res, next) => {
    const reqId = getRequestId();
    const maxLag = resolveMaxLag();

    try {
      const cursor = await indexerService.getCursor();

      let chainTip: number | null = null;
      try {
        chainTip = await indexerService.getChainTip();
      } catch (err) {
        // Cursor is readable but the chain tip is not — report "down" without
        // failing the whole probe so monitoring still gets the cursor value.
        logger.warn({ reqId, err }, "indexer_health_chain_tip_unavailable");
      }

      if (chainTip === null) {
        const payload = {
          data: {
            status: "down",
            cursor,
            chainTip: null,
            lag: null,
            maxLag,
          },
        };
        if (conditionalGet(payload, req, res)) return;
        return res.status(200).json(payload);
      }

      const lag = Math.max(0, chainTip - cursor);
      const status = lag > maxLag ? "degraded" : "ok";

      logger.info({ reqId, cursor, chainTip, lag, status }, "indexer_health_checked");

      const payload = { data: { status, cursor, chainTip, lag, maxLag } };
      if (conditionalGet(payload, req, res)) return;
      return res.status(200).json(payload);
    } catch (err) {
      logger.error({ reqId, err }, "indexer_health_failed");
      return next(err);
    }
  });

  return router;
}

export const indexerHealthRouter = createIndexerHealthRouter();
