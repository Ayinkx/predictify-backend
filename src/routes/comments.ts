import { Router } from "express";
import { enforceCors } from "../middleware/cors";

export const commentsRouter = Router();

// Apply CORS allowlist enforcement for this entire route
commentsRouter.use(enforceCors);

commentsRouter.get("/", (req, res) => {
  res.json({
    data: [],
    message: "Comments fetched securely",
  });
});

commentsRouter.post("/", (req, res) => {
  res.status(201).json({
    data: req.body,
    message: "Comment created successfully",
  });
});
