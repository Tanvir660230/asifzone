import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { AppError } from "../lib/app-error";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

// Prisma model field names are opaque implementation detail; strip them so the
// client never sees e.g. "Unique constraint failed on the fields: (`slug`)".
function conflictMessage(err: Prisma.PrismaClientKnownRequestError): string {
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.join(", ") : typeof target === "string" ? target : undefined;
  return fields ? `A record with this ${fields} already exists` : "This record already exists";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return res.status(409).json({ error: conflictMessage(err) });
      case "P2025":
        return res.status(404).json({ error: "Not found" });
      case "P2003":
        return res.status(400).json({ error: "This action references a record that no longer exists" });
    }
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File is too large"
        : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
          ? "Too many files uploaded"
          : "Invalid file upload";
    return res.status(400).json({ error: message });
  }

  console.error("[unhandled error]", err);
  res.status(500).json({ error: "Internal server error" });
}
