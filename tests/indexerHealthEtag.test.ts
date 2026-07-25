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

/**
 * Focused tests for ETag / conditional-GET support on GET /api/indexer/health.
 *
 * Coverage matrix
 * ─────────────────────────────────────────────────────────
 *  ✓ 200 response includes a strong ETag header
 *  ✓ 200 response includes Cache-Control: no-cache
 *  ✓ 304 when If-None-Match matches the current ETag ("ok" status)
 *  ✓ 304 response has no body
 *  ✓ 304 response still includes the ETag header
 *  ✓ 200 when If-None-Match is stale
 *  ✓ 200 when If-None-Match header is absent
 *  ✓ ETag is stable across repeated requests for unchanged cursor/chainTip
 *  ✓ ETag changes when lag crosses into "degraded"
 *  ✓ ETag changes when the chain tip advances (same status)
 *  ✓ sending a stale ETag after state changes returns 200, not 304
 *  ✓ "down" status (RPC unavailable) also emits an ETag and honors If-None-Match
 */
describe("GET /api/indexer/health — ETag / conditional GET", () => {
  let getCursor: jest.SpyInstance;
  let getChainTip: jest.SpyInstance;

  beforeEach(() => {
    getCursor = jest.spyOn(indexerService, "getCursor");
    getChainTip = jest.spyOn(indexerService, "getChainTip");
  });

  afterEach(() => jest.restoreAllMocks());

  it("200 response includes a strong ETag header", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);

    const res = await request(createApp()).get("/api/indexer/health");

    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toMatch(/^"[0-9a-f]{64}"$/);
  });

  it("200 response includes Cache-Control: no-cache", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);

    const res = await request(createApp()).get("/api/indexer/health");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("returns 304 when If-None-Match matches the current ETag", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const first = await request(createApp()).get("/api/indexer/health");
    const etag = first.headers["etag"];
    expect(etag).toBeDefined();

    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const second = await request(createApp())
      .get("/api/indexer/health")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
  });

  it("304 response has no body", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const first = await request(createApp()).get("/api/indexer/health");
    const etag = first.headers["etag"];

    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const second = await request(createApp())
      .get("/api/indexer/health")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.text).toBeFalsy();
  });

  it("304 response still includes the ETag header", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const first = await request(createApp()).get("/api/indexer/health");
    const etag = first.headers["etag"];

    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const second = await request(createApp())
      .get("/api/indexer/health")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
    expect(second.headers["etag"]).toBe(etag);
  });

  it("returns 200 when If-None-Match is stale", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);

    const res = await request(createApp())
      .get("/api/indexer/health")
      .set(
        "If-None-Match",
        '"0000000000000000000000000000000000000000000000000000000000000000"',
      );

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it("returns 200 when If-None-Match header is absent", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);

    const res = await request(createApp()).get("/api/indexer/health");

    expect(res.status).toBe(200);
  });

  it("ETag is stable across repeated requests for unchanged cursor/chainTip", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const r1 = await request(createApp()).get("/api/indexer/health");

    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const r2 = await request(createApp()).get("/api/indexer/health");

    expect(r1.headers["etag"]).toBe(r2.headers["etag"]);
  });

  it("ETag changes when lag crosses into degraded", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const ok = await request(createApp()).get("/api/indexer/health");

    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(2000);
    const degraded = await request(createApp()).get("/api/indexer/health");

    expect(ok.headers["etag"]).not.toBe(degraded.headers["etag"]);
  });

  it("ETag changes when the chain tip advances (same status)", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const first = await request(createApp()).get("/api/indexer/health");

    getCursor.mockResolvedValue(1005);
    getChainTip.mockResolvedValue(1015);
    const second = await request(createApp()).get("/api/indexer/health");

    expect(first.body.data.status).toBe("ok");
    expect(second.body.data.status).toBe("ok");
    expect(first.headers["etag"]).not.toBe(second.headers["etag"]);
  });

  it("sending a stale ETag after state changes returns 200, not 304", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(1010);
    const first = await request(createApp()).get("/api/indexer/health");
    const staleEtag = first.headers["etag"];

    getCursor.mockResolvedValue(1000);
    getChainTip.mockResolvedValue(2000);
    const second = await request(createApp())
      .get("/api/indexer/health")
      .set("If-None-Match", staleEtag);

    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe("degraded");
  });

  it("'down' status also emits an ETag and honors If-None-Match", async () => {
    getCursor.mockResolvedValue(1000);
    getChainTip.mockRejectedValue(new Error("rpc unavailable"));
    const first = await request(createApp()).get("/api/indexer/health");

    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("down");
    const etag = first.headers["etag"];
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    getCursor.mockResolvedValue(1000);
    getChainTip.mockRejectedValue(new Error("rpc unavailable"));
    const second = await request(createApp())
      .get("/api/indexer/health")
      .set("If-None-Match", etag);

    expect(second.status).toBe(304);
  });
});
