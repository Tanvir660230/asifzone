import { z } from "zod";
import { paginationQuerySchema } from "./common";

export const createRedirectSchema = z
  .object({
    fromPath: z.string().min(1).max(500).regex(/^\//, "Must start with /"),
    toPath: z.string().min(1).max(1000),
    statusCode: z.union([z.literal(301), z.literal(302)]).default(301),
    isActive: z.boolean().default(true),
  })
  .refine((data) => data.fromPath !== data.toPath, { message: "From and To paths must differ", path: ["toPath"] });

export const updateRedirectSchema = z.object({
  fromPath: z.string().min(1).max(500).regex(/^\//, "Must start with /").optional(),
  toPath: z.string().min(1).max(1000).optional(),
  statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
  isActive: z.boolean().optional(),
});

export const redirectListQuerySchema = paginationQuerySchema;

export type CreateRedirectInput = z.infer<typeof createRedirectSchema>;
export type UpdateRedirectInput = z.infer<typeof updateRedirectSchema>;
export type RedirectListQuery = z.infer<typeof redirectListQuerySchema>;
