// Set up environment variables before importing anything that parses them
process.env.JWT_SECRET = "super-secret-key-that-is-at-least-32-bytes-long";
process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/predictify";
process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = "CABCDEF";
process.env.ADMIN_ALLOWLIST = "G-ADMIN-ADDRESS-1,G-ADMIN-ADDRESS-2";
process.env.INDEXER_HEALTH_MAX_LAG = "50";

import request from "supertest";
import { createApp } from "../src/index";
import { indexerService } from "../src/services/indexerService";

describe("GET /api/indexer/health", () => {
  let getCursor: jest.SpyInstance;
  let getChainTip: jest.SpyInstance;

  beforeEach(() => {
    getCursor = jest.spyOn(indexerService, "getCursor");
    getChainTip = jest.spyOn(indexerService, "getChainTip");
  });

  afterEach(() => jest.restoreAllMocks());

  it("reports ok when cursor lag is within the threshold", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);

    const res = await request(createApp()).get("/api/indexer/health");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "ok",
      cursor: 1000,
      chainTip: 1010,
      lag: 10,
    });
  });

  it("reports degraded when cursor lag exceeds the threshold", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(2000);

    const res = await request(createApp()).get("/api/indexer/health");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("degraded");
    expect(res.body.data.lag).toBe(1000);
  });

  it("reports down when the chain tip is unreachable", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockRejectedValue(new Error("rpc unavailable"));

    const res = await request(createApp()).get("/api/indexer/health");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("down");
    expect(res.body.data.chainTip).toBeNull();
    expect(res.body.data.lag).toBeNull();
  });
});
