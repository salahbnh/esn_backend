import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { getHealth } from './health.controller.js';

export const healthRouter = Router();

// GET /api/health
healthRouter.get('/', asyncHandler(getHealth));
