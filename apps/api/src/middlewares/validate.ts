import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { AppError } from "../lib/app-error";

type Target = "body" | "query" | "params";

export function validate(schema: ZodTypeAny, target: Target = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(AppError.badRequest("Validation failed", result.error.flatten()));
    }
    req[target] = result.data;
    next();
  };
}
