import { db } from "../db";
import { predictions, users } from "../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../config/logger";

export interface Discrepancy {
  predictionId: string;
  stellarAddress: string;
  marketId: string;
  dbAmount: string;
  onChainAmount: string;
  difference: string;
}

export interface ReconciliationResult {
  reportId: string;
  totalPredictions: number;
  matchedPredictions: number;
  unmatchedPredictions: number;
  discrepancies: Discrepancy[];
}

/**
 * Perform reconciliation between database predictions and on-chain balances
 * NOTE: Stub implementation — requires reconciliationReports table and contract ABI.
 */
export async function performReconciliation(): Promise<ReconciliationResult> {
  logger.info("Starting reconciliation process (stub)");
  const allPredictions = await db
    .select({
      id: predictions.id,
      amount: predictions.amount,
      userId: predictions.userId,
      marketId: predictions.marketId,
      stellarAddress: users.stellarAddress,
    })
    .from(predictions)
    .innerJoin(users, eq(predictions.userId, users.id));

  return {
    reportId: "stub-report-id",
    totalPredictions: allPredictions.length,
    matchedPredictions: allPredictions.length,
    unmatchedPredictions: 0,
    discrepancies: [],
  };
}

/**
 * Get reconciliation report by ID (stub)
 */
export async function getReconciliationReport(
  _reportId: string
): Promise<ReconciliationResult | null> {
  return null;
}

/**
 * Get recent reconciliation reports (stub)
 */
export async function listReconciliationReports(_limit: number = 10, _offset: number = 0) {
  return [];
}
