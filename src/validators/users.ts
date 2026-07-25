import { z } from "zod";
import { DEFAULT_PAGE_SIZE } from "../utils/cursor";

/**
 * Schema for a valid Stellar public key (56-char G… address).
 * Used across all user-related endpoints that accept Stellar addresses.
 */
export const stellarAddressSchema = z
  .string({ invalid_type_error: "Stellar address must be a string" })
  .regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address format");

/**
 * Schema for GET /api/users/:address/predictions query parameters.
 *
 * Query parameters:
 *   - status  (optional) — filter by prediction status enum
 *   - cursor  (optional) — opaque base64url token from the previous page
 *   - limit   (optional, default 20, max 100) — page size
 *
 * Unknown query parameters are rejected to keep the route boundary explicit
 * and to avoid silently ignoring malformed input.
 */
export const userPredictionsQuerySchema = z
  .object({
    status: z
      .enum(["pending", "confirmed", "won", "lost", "claimed"], {
        message: "status must be one of: pending, confirmed, won, lost, claimed",
      })
      .optional(),
    cursor: z
      .string({ invalid_type_error: "cursor must be a string" })
      .min(1, "cursor cannot be empty")
      .optional(),
    limit: z.coerce
      .number({ invalid_type_error: "limit must be a number" })
      .int("limit must be an integer")
      .min(1, "limit must be between 1 and 100")
      .max(100, "limit must be between 1 and 100")
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type UserPredictionsQuery = z.infer<typeof userPredictionsQuerySchema>;

/**
 * Schema for route parameters containing Stellar address (:address or :stellarAddress)
 * This validates the address parameter from the URL path.
 * Strict mode rejects any unexpected route parameters.
 */
export const stellarAddressParamsSchema = z
  .object({
    address: stellarAddressSchema,
  })
  .strict();

export type StellarAddressParams = z.infer<typeof stellarAddressParamsSchema>;

/**
 * Schema for route parameters containing :stellarAddress
 * This validates the stellarAddress parameter from the URL path.
 * Strict mode rejects any unexpected route parameters.
 */
export const stellarAddressProfileParamsSchema = z
  .object({
    stellarAddress: stellarAddressSchema,
  })
  .strict();

export type StellarAddressProfileParams = z.infer<typeof stellarAddressProfileParamsSchema>;
