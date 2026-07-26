import { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";

/**
 * Creates an Express middleware that enforces a maximum request duration.
 * If the route handler does not finish before `timeoutMs`, the request is
 * aborted gracefully with a 408 Request Timeout error envelope.
 *
 * @param timeoutMs - Time in milliseconds before the request times out
 */
export function requestTimeout(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    let settled = false;
    const controller = new AbortController();
    res.locals.abortSignal = controller.signal;

    const finish = () => {
      settled = true;
      clearTimeout(timer);
    };

    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;

      settled = true;
      abort();
      if (!res.headersSent) {
        // Extract the correlation ID for structured logging and standard error envelope
        const correlationId = (res.locals.correlationId as string) || (req as { id?: string }).id || "unknown";

        logger.warn(
          {
            reqId: correlationId,
            correlationId,
            path: req.originalUrl,
            method: req.method,
            timeoutMs
          },
          "request_timeout_exceeded"
        );

        res.status(408).json({
          error: {
            code: "timeout",
            message: "Request timeout exceeded",
            requestId: correlationId,
          },
        });
      }
    }, timeoutMs);

    req.on("close", () => {
      abort();
    });

    res.on("finish", finish);
    res.on("close", finish);

    next();
  };
}