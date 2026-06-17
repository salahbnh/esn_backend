import { Router, type NextFunction, type Request, type Response } from 'express';
import multer, { MulterError } from 'multer';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { AppError } from '../../lib/app-error.js';
import * as controller from './documents.controller.js';
import { MAX_SIZE_BYTES } from './documents.service.js';
import { IdParamSchema, ListDocumentsQuerySchema, UploadMetaSchema } from './documents.schema.js';

/**
 * Documents routes — mounted at /api/documents. Security-critical module.
 *
 * POST   /upload        RH, MANAGER, DIRECTION, CONSULTANT   (multipart/form-data)
 * GET    /              RH, MANAGER, DIRECTION, CONSULTANT
 * GET    /:id/url       RH, MANAGER, DIRECTION, CONSULTANT
 * DELETE /:id           RH, DIRECTION                        (soft-delete -> 204)
 * POST   /:id/restore   RH, DIRECTION
 *
 * AUTHORIZATION NOTE: the route-level `rbac(...)` only gates which ROLES may reach
 * the handler. The entity-level ownership/matrix check is entityType-dependent and
 * resolved from the DB AFTER the Document/entity is known, so it lives in the
 * SERVICE/ACCESS layer (assertCanUpload / assertCanDownload / assertCanDelete) —
 * NOT via route `requireOwnershipFor`. This is a deliberate, documented deviation.
 *
 * The upload route uses multer (memoryStorage, 20 MB cap) to parse the multipart
 * body; `express.json()` does not apply to it. Multer populates `req.body`
 * (validated AFTER multer by `validate`) and `req.file`.
 */
export const documentsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
});

documentsRouter.use(auth);

// --- Upload (multipart) ----------------------------------------------------

documentsRouter.post(
  '/upload',
  rbac('RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'),
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(
            new AppError(413, 'FILE_TOO_LARGE', 'File exceeds the maximum size', {
              code: 'FILE_TOO_LARGE',
            }),
          );
        }
        return next(AppError.badRequest('Invalid upload', { code: err.code }));
      }
      return next(err);
    });
  },
  validate({ body: UploadMetaSchema }),
  asyncHandler(controller.uploadDocument),
);

// --- List ------------------------------------------------------------------

documentsRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'),
  validate({ query: ListDocumentsQuerySchema }),
  asyncHandler(controller.listDocuments),
);

// --- Download URL ----------------------------------------------------------

documentsRouter.get(
  '/:id/url',
  rbac('RH', 'MANAGER', 'DIRECTION', 'CONSULTANT'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getDocumentUrl),
);

// --- Soft-delete / restore -------------------------------------------------

documentsRouter.delete(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.deleteDocument),
);

documentsRouter.post(
  '/:id/restore',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.restoreDocument),
);
