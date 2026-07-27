import { db } from "../db";
import { users, predictions } from "../db/schema";
import { eq, count } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────

/** Aggregate totals for the authenticated user's dashboard. */
export interface ProfileTotals {
  /** Total number of predictions the user has placed. */
  totalPredictions: number;
  /** Total amount staked across all predictions (string for precision). */
  totalAmountStaked: string;
  /** Number of predictions that won. */
  wins: number;
  /** Number of predictions that lost. */
  losses: number;
}

/**
 * Response shape for `GET /api/users/me`.  All timestamps are serialised to
 * ISO-8601 strings so the wire format is stable across runtimes.
 */
export interface UserProfile {
  /** Internal UUID (opaque to external consumers). */
  id: string;
  /** The user's on-chain Stellar address (G...). */
  stellarAddress: string;
  /** Account creation timestamp (ISO-8601). */
  createdAt: string;
  /** Ordered newest-first list of predictions. */
  predictions: PredictionEntry[];
  /** Aggregate counters for the user's activity on the platform. */
  totals: ProfileTotals;
}

/** One entry in the public prediction history. */
export interface PredictionEntry {
  /** UUID of the prediction row. */
  id: string;
  /** The market this prediction was placed on. */
  market: {
    id: string;
    question: string;
    status: string;
    resolutionTime: string;
  };
  /** Which outcome the user chose (e.g. "yes" / "no"). */
  outcome: string;
  /**
   * Amount staked, stored as a string to preserve precision for large
   * Stellar stroops values.
   */
  amount: string;
  /** ISO-8601 timestamp when the prediction was created. */
  createdAt: string;
}

// ── Service functions ─────────────────────────────────────────────────────

/**
 * Look up a public user profile by Stellar address.
 *
 * Returns `null` when no user with that address exists.
 *
 * @param stellarAddress - The Stellar account address to look up.
 */
export async function getUserProfile(
  stellarAddress: string,
): Promise<UserProfile | null> {
  // Stub: always returns null until the DB layer is wired up.
  void stellarAddress;
  return null;
}

/**
 * Returns the authenticated user's profile (stellarAddress, createdAt) along
 * with aggregate counts of their predictions.  Two queries run in parallel.
 *
 * Throws if the user row no longer exists (TOCTOU race).
 */
export async function getCurrentUserProfile(userId: string): Promise<UserProfile> {
  const [userRow, predCountRow] = await Promise.all([
    db
      .select({
        id: users.id,
        stellarAddress: users.stellarAddress,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({ value: count() })
      .from(predictions)
      .where(eq(predictions.userId, userId)),
  ]);

  const user = userRow[0];
  if (!user) {
    throw new Error("user row vanished mid-request");
  }

  const totalPredictions = Number(predCountRow[0]?.value ?? 0);

  return {
    id: user.id,
    stellarAddress: user.stellarAddress,
    createdAt: user.createdAt.toISOString(),
    predictions: [],
    totals: {
      totalPredictions,
      totalAmountStaked: "0",
      wins: 0,
      losses: 0,
    },
  };
}
