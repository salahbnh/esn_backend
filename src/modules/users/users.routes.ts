import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './users.controller.js';
import {
  CreateUserBodySchema,
  IdParamSchema,
  ListUsersQuerySchema,
  PatchUserStatusBodySchema,
} from './users.schema.js';

/**
 * Users admin routes — mounted at /api/users.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * GET    /                   RH, MANAGER, DIRECTION (staff directory — feeds the
 *                            contract manager picker; minimal fields, no keycloakId)
 * POST   /                   DIRECTION (create staff account: RH/MANAGER/DIRECTION;
 *                            CONSULTANT accounts come from conversion only)
 * PATCH  /:id/status         DIRECTION (activate/deactivate — Keycloak + DB flag)
 * POST   /:id/resend-invite  DIRECTION
 */
export const usersRouter = Router();

usersRouter.use(auth);

usersRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListUsersQuerySchema }),
  asyncHandler(controller.listUsers),
);

usersRouter.post(
  '/',
  rbac('DIRECTION'),
  validate({ body: CreateUserBodySchema }),
  asyncHandler(controller.createUser),
);

usersRouter.patch(
  '/:id/status',
  rbac('DIRECTION'),
  validate({ params: IdParamSchema, body: PatchUserStatusBodySchema }),
  asyncHandler(controller.patchUserStatus),
);

usersRouter.post(
  '/:id/resend-invite',
  rbac('DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.resendInvite),
);
