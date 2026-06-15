import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/app-error.js';
import { logger } from '../lib/logger.js';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Central error handler. Maps AppError and known Prisma errors to safe HTTP
 * responses. Never leaks stack traces or raw DB errors to the client.
 * MUST be registered LAST, after all routes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = 500;
  let body: ErrorBody = { error: { code: 'INTERNAL', message: 'Internal server error' } };

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      statusCode = 409;
      body = {
        error: {
          code: 'CONFLICT',
          message: 'A record with these unique values already exists',
          details: err.meta?.target,
        },
      };
    } else if (err.code === 'P2025') {
      statusCode = 404;
      body = { error: { code: 'NOT_FOUND', message: 'Record not found' } };
    } else {
      statusCode = 400;
      body = { error: { code: 'DB_ERROR', message: 'Database request error' } };
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    body = { error: { code: 'DB_VALIDATION', message: 'Invalid database query' } };
  }

  // Log full error server-side; never serialize it to the client.
  if (statusCode >= 500) {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  } else {
    logger.warn({ code: body.error.code, path: req.path, method: req.method }, body.error.message);
  }

  res.status(statusCode).json(body);
}
