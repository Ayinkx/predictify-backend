import { Router } from "express";
import { conditionalGet } from "../middleware/etag";
import { ALL_EVENT_TYPES } from "../services/webhookCatalog";

export const webhooksRouter = Router();

webhooksRouter.get("/", (req, res) => {
  const payload = {
    data: {
      events: ALL_EVENT_TYPES,
      eventCount: ALL_EVENT_TYPES.length,
    },
  };

  if (conditionalGet(payload, req, res)) {
    return;
  }

  res.json(payload);
});
