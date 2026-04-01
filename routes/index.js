import express from "express";
import {
  handleGetData,
  handleGetDashboards,
  handleGetDashboardById,
  handlePostDashboard,
  handleFileUpload,
  handleGetCollectionData,
  handleGetCollectionMeta,
  handleGetCollections,
  handleSignup,
  handleLogin,
  handleMe,
  handleLogout,
  handleChangePassword,
  handleSearchUsers,
  handleShareDashboard,
} from "../controller/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Users - GET /api/v1/ or /api/v1/users
router.get('/', handleGetData);
router.get('/users', handleGetData);

// Auth
router.post('/auth/signup', handleSignup);
router.post('/auth/login', handleLogin);
router.post('/auth/logout', handleLogout);
router.get('/auth/me', requireAuth, handleMe);
router.post('/auth/change-password', requireAuth, handleChangePassword);
router.get('/auth/users', requireAuth, handleSearchUsers);

// Dashboards - GET/POST /api/v1/dashboards, GET /api/v1/dashboards/:id
router.get('/dashboards', requireAuth, handleGetDashboards);
router.get('/dashboards/:id', requireAuth, handleGetDashboardById);
router.post('/dashboards', requireAuth, handlePostDashboard);
router.post('/dashboards/:id/share', requireAuth, handleShareDashboard);

// File Upload - POST /api/v1/upload
router.post('/upload', handleFileUpload);

// Collections
router.get('/collections', handleGetCollections);
router.get('/collection/:collection/meta', handleGetCollectionMeta);

// Dynamic Collection Data - GET /api/v1/collection/:collection
router.get('/collection/:collection', handleGetCollectionData);

export default router;