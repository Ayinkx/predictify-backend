import request from "supertest";
import express from "express";
import { createPerUserRateLimiter } from "../src/middleware/rateLimit";

jest.mock("../src/services/auditService", () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}));

function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    const user = req.headers["x-test-user"];
    if (typeof user === "string") {
      (req as typeof req & { user?: { address: string } }).user = { address: user };
    }
    next();
  });
  app.use(createPerUserRateLimiter({ windowMs: 60_000, limit: 2 }));
  app.get("/api/markets", (_req, res) => {
    res.json({ data: [] });
  });
  return app;
}

describe("per-user rate limiting for markets", () => {
  it("enforces the limit independently for each authenticated user", async () => {
    const app = makeApp();

    expect((await request(app).get("/api/markets").set("x-test-user", "GUSER1")).status).toBe(200);
    expect((await request(app).get("/api/markets").set("x-test-user", "GUSER1")).status).toBe(200);
    expect((await request(app).get("/api/markets").set("x-test-user", "GUSER1")).status).toBe(429);

    const otherUser = await request(app).get("/api/markets").set("x-test-user", "GUSER2");
    expect(otherUser.status).toBe(200);
  });

  it("returns the standard rate-limit error envelope", async () => {
    const app = makeApp();

    await request(app).get("/api/markets").set("x-test-user", "GUSER");
    await request(app).get("/api/markets").set("x-test-user", "GUSER");
    const response = await request(app).get("/api/markets").set("x-test-user", "GUSER");

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("rate_limit_exceeded");
    expect(Number(response.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(response.body.error.retryAfter).toBe(Number(response.headers["retry-after"]));
    expect(typeof response.body.error.resetAt).toBe("string");
  });
});
