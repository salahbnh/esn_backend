import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { AppError } from '../../lib/app-error.js';
import { config } from '../../config/env.js';
import * as controller from './public-jobs.controller.js';
import { PublicApplyBodySchema, TokenParamSchema } from './public-jobs.schema.js';

/**
 * PUBLIC portal router — mounted at /api/public, BEFORE the global auth'd routes
 * and the global limiter. ISOLATED BLAST RADIUS: NO `auth`, NO `rbac`, cookie-free.
 * Its own stricter rate limiters + a hardened multer (10MB / 2 files) live here.
 * An Authorization header, if present, is simply ignored (never parsed).
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

const uploadFields = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 2, fields: 20, fieldSize: 1024 * 1024 },
}).fields([
  { name: 'cv', maxCount: 1 },
  { name: 'coverLetter', maxCount: 1 },
]);

// Translate multer limit errors into clean AppErrors (413 for oversize files).
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  uploadFields(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, 'FILE_TOO_LARGE', 'A file exceeds the 10MB limit'));
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(AppError.badRequest('Too many files', { code: 'TOO_MANY_FILES' }));
      }
      return next(AppError.badRequest('Invalid upload', { code: 'INVALID_UPLOAD' }));
    }
    if (err) return next(err);
    next();
  });
}

/**
 * Build the public router with FRESH rate-limiter instances per call — so each
 * app (incl. per-test apps) gets an independent in-memory limit store.
 */
export function createPublicJobsRouter(): Router {
  const router = Router();

  const getLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: config.PUBLIC_RATE_LIMIT_GET_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  // Two composed limiters on apply: per-IP AND per-token (both must pass).
  const applyIpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.PUBLIC_RATE_LIMIT_APPLY_IP_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const applyTokenLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.PUBLIC_RATE_LIMIT_APPLY_TOKEN_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `token:${req.params['token'] ?? 'none'}`,
  });

  router.get(
    '/jobs/:token',
    getLimiter,
    validate({ params: TokenParamSchema }),
    asyncHandler(controller.getPublicJob),
  );

  router.get('/skills', getLimiter, asyncHandler(controller.listSkills));

  router.post(
    '/jobs/:token/apply',
    applyIpLimiter,
    applyTokenLimiter,
    handleUpload,
    validate({ params: TokenParamSchema, body: PublicApplyBodySchema }),
    asyncHandler(controller.apply),
  );

  return router;
}
