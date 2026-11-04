import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { env } from "../config/env.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let message: string = err.message;
  if (err instanceof HttpError) status = err.status;
  else if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)" : err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = err.issues.map((i) => i.message).join("; ");
  } else if (err?.code === "P2025") {
    status = 404;
    message = "Record not found";
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    message = "Invalid JSON body";
  }
  if (status === 500) console.error(err);
  res.status(status).json({ message: status === 500 && env.NODE_ENV === "production" ? "Internal server error" : message });
};
