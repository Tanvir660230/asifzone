import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/app-error";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error" });
}
