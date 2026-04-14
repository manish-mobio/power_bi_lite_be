import express from 'express';
import {
  handleGetDashboardVersions,
  handleSyncDashboard,
  handleGetDashboardById,
  handlePostDashboard,
  handleShareDashboard,
  handleGetDashboards,
} from '../controller/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
const router = express.Router();
router.get('/', requireAuth, handleGetDashboards);
router.get('/:id/versions', requireAuth, handleGetDashboardVersions);
router.post('/:id/sync', requireAuth, handleSyncDashboard);
router.get('/:id', requireAuth, handleGetDashboardById);
router.post('/', requireAuth, handlePostDashboard);
router.post('/:id/share', requireAuth, handleShareDashboard);

export default router;
