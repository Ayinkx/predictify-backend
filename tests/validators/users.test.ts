/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "@jest/globals";
import {
  stellarAddressSchema,
  stellarAddressParamsSchema,
  stellarAddressProfileParamsSchema,
  userPredictionsQuerySchema,
} from "../../src/validators/users";
import { DEFAULT_PAGE_SIZE } from "../../src/utils/cursor";

describe("User Validators", () => {
  describe("stellarAddressSchema", () => {
    it("should accept a valid Stellar address", () => {
      const validAddress = "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF";
      const result = stellarAddressSchema.safeParse(validAddress);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(validAddress);
      }
    });

    it("should reject address not starting with G", () => {
      const invalidAddress = "AAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Invalid Stellar address format");
      }
    });

    it("should reject address with invalid length (too short)", () => {
      const invalidAddress = "GAHK7EYR7AQ5B56K2RRYUWWC";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject address with invalid length (too long)", () => {
      const invalidAddress = "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TFEXTRA";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject address with lowercase letters", () => {
      const invalidAddress = "gahk7eyr7aq5b56k2rryuwwc7ej5cwwwurc2q4gqrhbdqy7zlmqvb6tf";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject address with invalid characters", () => {
      const invalidAddress = "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQV!@#$";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject non-string values", () => {
      const result = stellarAddressSchema.safeParse(12345);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Stellar address must be a string");
      }
    });

    it("should reject null values", () => {
      const result = stellarAddressSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it("should reject undefined values", () => {
      const result = stellarAddressSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it("should reject empty string", () => {
      const result = stellarAddressSchema.safeParse("");
      expect(result.success).toBe(false);
    });

    it("should accept valid address with all allowed characters", () => {
      // Base32 alphabet: A-Z and 2-7 (no 0,1,8,9) - exactly 56 chars total (G + 55)
      const validAddress = "G234567ABCDEFG2234567HIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJ";
      expect(validAddress.length).toBe(56); // Verify length
      const result = stellarAddressSchema.safeParse(validAddress);
      expect(result.success).toBe(true);
    });

    it("should reject address with number 0", () => {
      const invalidAddress = "G0HK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject address with number 1", () => {
      const invalidAddress = "G1HK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject address with number 8", () => {
      const invalidAddress = "G8HK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject address with number 9", () => {
      const invalidAddress = "G9HK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF";
      const result = stellarAddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it("should reject object instead of string", () => {
      const result = stellarAddressSchema.safeParse({ address: "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF" });
      expect(result.success).toBe(false);
    });

    it("should reject boolean value", () => {
      const result = stellarAddressSchema.safeParse(true);
      expect(result.success).toBe(false);
    });
  });

  describe("stellarAddressParamsSchema", () => {
    it("should accept valid params with address", () => {
      const validParams = {
        address: "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF",
      };
      const result = stellarAddressParamsSchema.safeParse(validParams);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.address).toBe(validParams.address);
      }
    });

    it("should reject invalid Stellar address in params", () => {
      const invalidParams = {
        address: "INVALID_ADDRESS",
      };
      const result = stellarAddressParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it("should reject missing address param", () => {
      const result = stellarAddressParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should reject params with extra fields (strict mode)", () => {
      const paramsWithExtra = {
        address: "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF",
        extraField: "unexpected",
      };
      const result = stellarAddressParamsSchema.safeParse(paramsWithExtra);
      expect(result.success).toBe(false);
    });

    it("should reject array instead of object", () => {
      const result = stellarAddressParamsSchema.safeParse([
        "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF",
      ]);
      expect(result.success).toBe(false);
    });

    it("should reject null value", () => {
      const result = stellarAddressParamsSchema.safeParse(null);
      expect(result.success).toBe(false);
    });
  });

  describe("stellarAddressProfileParamsSchema", () => {
    it("should accept valid params with stellarAddress", () => {
      const validParams = {
        stellarAddress: "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF",
      };
      const result = stellarAddressProfileParamsSchema.safeParse(validParams);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stellarAddress).toBe(validParams.stellarAddress);
      }
    });

    it("should reject invalid Stellar address in stellarAddress param", () => {
      const invalidParams = {
        stellarAddress: "NOT_A_VALID_ADDRESS",
      };
      const result = stellarAddressProfileParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });

    it("should reject missing stellarAddress param", () => {
      const result = stellarAddressProfileParamsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should reject params with extra fields (strict mode)", () => {
      const paramsWithExtra = {
        stellarAddress: "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF",
        unexpectedParam: "value",
      };
      const result = stellarAddressProfileParamsSchema.safeParse(paramsWithExtra);
      expect(result.success).toBe(false);
    });

    it("should reject array instead of object", () => {
      const result = stellarAddressProfileParamsSchema.safeParse([
        "GAHK7EYR7AQ5B56K2RRYUWWC7EJ5CWWWURC2Q4GQRHBDQY7ZLMQVB6TF",
      ]);
      expect(result.success).toBe(false);
    });

    it("should handle whitespace-only address", () => {
      const invalidParams = {
        stellarAddress: "   ",
      };
      const result = stellarAddressProfileParamsSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
    });
  });

  describe("userPredictionsQuerySchema", () => {
    describe("status parameter", () => {
      it("should accept valid status: pending", () => {
        const result = userPredictionsQuerySchema.safeParse({ status: "pending" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBe("pending");
        }
      });

      it("should accept valid status: confirmed", () => {
        const result = userPredictionsQuerySchema.safeParse({ status: "confirmed" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBe("confirmed");
        }
      });

      it("should accept valid status: won", () => {
        const result = userPredictionsQuerySchema.safeParse({ status: "won" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBe("won");
        }
      });

      it("should accept valid status: lost", () => {
        const result = userPredictionsQuerySchema.safeParse({ status: "lost" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBe("lost");
        }
      });

      it("should accept valid status: claimed", () => {
        const result = userPredictionsQuerySchema.safeParse({ status: "claimed" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBe("claimed");
        }
      });

      it("should reject invalid status", () => {
        const result = userPredictionsQuerySchema.safeParse({ status: "invalid" });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe(
            "status must be one of: pending, confirmed, won, lost, claimed",
          );
        }
      });

      it("should accept query without status (optional)", () => {
        const result = userPredictionsQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBeUndefined();
        }
      });
    });

    describe("cursor parameter", () => {
      it("should accept valid cursor string", () => {
        const cursor = "eyJpZCI6MTIzfQ";
        const result = userPredictionsQuerySchema.safeParse({ cursor });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.cursor).toBe(cursor);
        }
      });

      it("should reject empty cursor string", () => {
        const result = userPredictionsQuerySchema.safeParse({ cursor: "" });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe("cursor cannot be empty");
        }
      });

      it("should reject non-string cursor", () => {
        const result = userPredictionsQuerySchema.safeParse({ cursor: 12345 });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe("cursor must be a string");
        }
      });

      it("should accept query without cursor (optional)", () => {
        const result = userPredictionsQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.cursor).toBeUndefined();
        }
      });
    });

    describe("limit parameter", () => {
      it("should use default limit when not provided", () => {
        const result = userPredictionsQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(DEFAULT_PAGE_SIZE);
        }
      });

      it("should accept valid limit: 1", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: 1 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(1);
        }
      });

      it("should accept valid limit: 50", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: 50 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(50);
        }
      });

      it("should accept valid limit: 100", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: 100 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(100);
        }
      });

      it("should coerce string limit to number", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: "25" });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(25);
        }
      });

      it("should reject limit less than 1", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: 0 });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe("limit must be between 1 and 100");
        }
      });

      it("should reject negative limit", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: -5 });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe("limit must be between 1 and 100");
        }
      });

      it("should reject limit greater than 100", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: 101 });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe("limit must be between 1 and 100");
        }
      });

      it("should reject non-integer limit", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: 25.5 });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe("limit must be an integer");
        }
      });

      it("should reject non-numeric limit string", () => {
        const result = userPredictionsQuerySchema.safeParse({ limit: "abc" });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toBe("limit must be a number");
        }
      });
    });

    describe("strict mode - unknown parameters", () => {
      it("should reject unknown query parameters", () => {
        const result = userPredictionsQuerySchema.safeParse({
          status: "pending",
          unknownParam: "value",
        });
        expect(result.success).toBe(false);
      });

      it("should reject multiple unknown parameters", () => {
        const result = userPredictionsQuerySchema.safeParse({
          limit: 20,
          extra1: "value1",
          extra2: "value2",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("combined parameters", () => {
      it("should accept all valid parameters together", () => {
        const query = {
          status: "pending" as const,
          cursor: "eyJpZCI6MTIzfQ",
          limit: 25,
        };
        const result = userPredictionsQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(query);
        }
      });

      it("should apply defaults and accept partial parameters", () => {
        const query = { status: "won" as const };
        const result = userPredictionsQuerySchema.safeParse(query);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBe("won");
          expect(result.data.limit).toBe(DEFAULT_PAGE_SIZE);
          expect(result.data.cursor).toBeUndefined();
        }
      });

      it("should accept empty query object with defaults", () => {
        const result = userPredictionsQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(DEFAULT_PAGE_SIZE);
          expect(result.data.status).toBeUndefined();
          expect(result.data.cursor).toBeUndefined();
        }
      });
    });
  });
});
