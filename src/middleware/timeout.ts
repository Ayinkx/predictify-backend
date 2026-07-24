import { Request, Response, NextFunction } from "express";
import { RouteErrorFactory } from "../errors";

/**
 * Creates an Express middleware that enforces a maximum request duration.
 * If the route handler does not finish before `timeoutMs`, the request is
 * aborted gracefully with a 408 Request Timeout error envelope.
 *
 * @param timeoutMs - Time in milliseconds before the request times out
 */
export function requestTimeout(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    // We attach an abort controller to the response locals so that
    // downstream services can optionally listen to res.locals.abortSignal
    const controller = new AbortController();
    res.locals.abortSignal = controller.signal;

    // Handle client disconnects to cancel downstream work
    req.on("close", () => {
      controller.abort();
    });

    const timer = setTimeout(() => {
      controller.abort();

      if (!res.headersSent) {
        // Use RouteErrorFactory to throw a standardized error envelope.
        // The global error handler or this block will send it out.
        // To be safe and avoid double-calling next(), we can just send the error here,
        // but it's cleaner to let the global error handler format it.
        // Wait, if we call next() from a timeout, we have to ensure we don't
        // clash with the active route handler. 
        // We will just directly respond to guarantee the 408 is sent.
        const error = RouteErrorFactory.internal("Request timeout exceeded");
        // We change kind to RequestTimeout manually or just use 408 status.
        // Since RouteErrorFactory doesn't have timeout, we can build a raw envelope.
        const correlationId = (res.locals.correlationId as string) || "unknown";
        return res.status(408).json({
          error: {
            code: "timeout",
            message: "Request timeout exceeded",
            requestId: correlationId,
          }
        });
      }
    }, timeoutMs);

    res.on("finish", () => {
      clearTimeout(timer);
    });

    res.on("close", () => {
      clearTimeout(timer);
    });

    next();
  };
}
