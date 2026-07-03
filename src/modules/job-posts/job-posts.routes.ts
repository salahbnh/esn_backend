import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { rbac } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as controller from './job-posts.controller.js';
import {
  CreateJobPostBodySchema,
  CreateQuestionBodySchema,
  IdParamSchema,
  LinkApplicationBodySchema,
  ListApplicationsQuerySchema,
  ListJobPostsQuerySchema,
  PatchApplicationStatusBodySchema,
  QuestionParamSchema,
  ReorderQuestionsBodySchema,
  UpdateJobPostBodySchema,
  UpdateQuestionBodySchema,
} from './job-posts.schema.js';

/**
 * Job Posts admin routes — mounted at /api/job-posts (authenticated).
 * Manage = RH/DIRECTION; read = RH/MANAGER/DIRECTION; link = RH only.
 * Job posts are org-level (no ownership gate). The PUBLIC surface is a SEPARATE
 * unauthenticated router (see modules/public-jobs).
 *
 * NOTE: the literal `/applications/...` routes are declared BEFORE `/:id` so
 * Express does not capture "applications" as a job-post id.
 */
export const jobPostsRouter = Router();

jobPostsRouter.use(auth);

// --- Collection ------------------------------------------------------------

jobPostsRouter.get(
  '/',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ query: ListJobPostsQuerySchema }),
  asyncHandler(controller.listJobPosts),
);

jobPostsRouter.post(
  '/',
  rbac('RH', 'DIRECTION'),
  validate({ body: CreateJobPostBodySchema }),
  asyncHandler(controller.createJobPost),
);

// --- Application triage (literal segment BEFORE /:id) ----------------------

jobPostsRouter.get(
  '/applications/:id',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getApplication),
);

jobPostsRouter.patch(
  '/applications/:id/status',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: PatchApplicationStatusBodySchema }),
  asyncHandler(controller.patchApplicationStatus),
);

jobPostsRouter.post(
  '/applications/:id/link',
  rbac('RH'),
  validate({ params: IdParamSchema, body: LinkApplicationBodySchema }),
  asyncHandler(controller.linkApplication),
);

// --- Post detail + lifecycle -----------------------------------------------

jobPostsRouter.get(
  '/:id',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.getJobPost),
);

jobPostsRouter.patch(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: UpdateJobPostBodySchema }),
  asyncHandler(controller.updateJobPost),
);

jobPostsRouter.post(
  '/:id/publish',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.publishJobPost),
);

jobPostsRouter.post(
  '/:id/close',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.closeJobPost),
);

jobPostsRouter.delete(
  '/:id',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.archiveJobPost),
);

// --- Questions sub-resource ------------------------------------------------

jobPostsRouter.get(
  '/:id/questions',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema }),
  asyncHandler(controller.listQuestions),
);

jobPostsRouter.post(
  '/:id/questions',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: CreateQuestionBodySchema }),
  asyncHandler(controller.addQuestion),
);

// reorder declared before /:qid so "reorder" is not captured as a question id
jobPostsRouter.post(
  '/:id/questions/reorder',
  rbac('RH', 'DIRECTION'),
  validate({ params: IdParamSchema, body: ReorderQuestionsBodySchema }),
  asyncHandler(controller.reorderQuestions),
);

jobPostsRouter.patch(
  '/:id/questions/:qid',
  rbac('RH', 'DIRECTION'),
  validate({ params: QuestionParamSchema, body: UpdateQuestionBodySchema }),
  asyncHandler(controller.updateQuestion),
);

jobPostsRouter.delete(
  '/:id/questions/:qid',
  rbac('RH', 'DIRECTION'),
  validate({ params: QuestionParamSchema }),
  asyncHandler(controller.archiveQuestion),
);

jobPostsRouter.get(
  '/:id/applications',
  rbac('RH', 'MANAGER', 'DIRECTION'),
  validate({ params: IdParamSchema, query: ListApplicationsQuerySchema }),
  asyncHandler(controller.listApplications),
);
