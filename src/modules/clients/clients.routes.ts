import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './clients.controller.js';
import {
  CreateClientBodySchema,
  IdParamSchema,
  ListClientsQuerySchema,
  UpdateClientBodySchema,
} from './clients.schema.js';

/**
 * Clients routes — mounted at /api/clients.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * POST   /        MANAGER, DIRECTION, RH
 * GET    /        RH, MANAGER, DIRECTION
 * GET    /:id     RH, MANAGER, DIRECTION
 * PATCH  /:id     MANAGER, DIRECTION, RH
 *
 * No CONSULTANT access; clients are org-level (no ownership gate).
 */
export const clientsRouter = Router();

// Every route is authenticated.
clientsRouter.use(auth);

clientsRouter.post(
  '/',
  rbac('MANAGER', 'DIRECTION', 'RH'),
  validate({ body: CreateClientBodySchema }),
  asyncHandler(controller.createClient),
);

clientsRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListClientsQuerySchema }),
  asyncHandler(controller.listClients),
);

clientsRouter.get(
  '/:id',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getClient),
);

clientsRouter.patch(
  '/:id',
  rbac('MANAGER', 'DIRECTION', 'RH'),
  validate({ params: IdParamSchema, body: UpdateClientBodySchema }),
  asyncHandler(controller.updateClient),
);
