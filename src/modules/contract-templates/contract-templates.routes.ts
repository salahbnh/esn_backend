import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './contract-templates.controller.js';
import {
  CreateTemplateBodySchema,
  IdParamSchema,
  ListTemplatesQuerySchema,
  UpdateTemplateBodySchema,
} from './contract-templates.schema.js';

/**
 * Contract-templates routes — mounted at /api/contract-templates.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * GET    /                  RH, MANAGER, DIRECTION
 * GET    /:id               RH, MANAGER, DIRECTION
 * POST   /                  RH, DIRECTION
 * PATCH  /:id               RH, DIRECTION
 * PATCH  /:id/deactivate    RH, DIRECTION
 */
export const contractTemplatesRouter = Router();

contractTemplatesRouter.use(auth);

contractTemplatesRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListTemplatesQuerySchema }),
  asyncHandler(controller.listTemplates),
);

contractTemplatesRouter.post(
  '/',
  rbac('RH', 'DIRECTION'),
  validate({ body: CreateTemplateBodySchema }),
  asyncHandler(controller.createTemplate),
);

contractTemplatesRouter.patch(
  '/:id/deactivate',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.deactivateTemplate),
);

contractTemplatesRouter.get(
  '/:id',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getTemplate),
);

contractTemplatesRouter.patch(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: UpdateTemplateBodySchema }),
  asyncHandler(controller.updateTemplate),
);
