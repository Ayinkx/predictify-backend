import { Request, Response, NextFunction } from "express";

export function enforceCors(req: Request, res: Response, next: NextFunction) {
  // Pull allowlist from environment variables (comma separated)
  const allowlist = (process.env.CORS_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim());
  const origin = req.headers.origin;

  // Deny by default: Validate if origin exists in the allowlist
  if (origin && allowlist.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Idempotency-Key",
    );
    res.setHeader("Access-Control-Max-Age", "86400"); // Preflight cached for 24 hours
  } else if (origin) {
    res.status(403).json({
      error: {
        code: "cors_violation",
        message: "Origin not allowed by CORS policy",
      },
    });
    return;
  }

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
}
