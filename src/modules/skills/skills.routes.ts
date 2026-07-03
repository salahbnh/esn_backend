import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './skills.controller.js';
import {
  CreateSkillBodySchema,
  IdParamSchema,
  ListSkillsQuerySchema,
  UpdateSkillBodySchema,
} from './skills.schema.js';

/**
 * Skills referential routes — mounted at /api/skills.
 * Authorization is declared here (server-side), never in the controller/UI.
 *
 * GET    /        ALL authenticated (populate pickers everywhere)
 * POST   /        RH, DIRECTION (manage the catalogue)
 * PATCH  /:id     RH, DIRECTION
 * DELETE /:id     RH, DIRECTION (409 SKILL_IN_USE if still referenced)
 *
 * Skills are global (no ownership gate). A CONSULTANT picks skills on their own
 * profile via PATCH /api/consultants/me, not through this module.
 */
export const skillsRouter = Router();

skillsRouter.use(auth);

skillsRouter.get(
  '/',
  validate({ query: ListSkillsQuerySchema }),
  asyncHandler(controller.listSkills),
);

skillsRouter.post(
  '/',
  rbac('RH', 'DIRECTION'),
  validate({ body: CreateSkillBodySchema }),
  asyncHandler(controller.createSkill),
);

skillsRouter.patch(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: UpdateSkillBodySchema }),
  asyncHandler(controller.updateSkill),
);

skillsRouter.delete(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.removeSkill),
);
