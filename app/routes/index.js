import express from 'express';
import authRoutes from './auth.route.js';
import collectionRoutes from './collection.route.js';
import dashboardRoutes from './dashboard.route.js';
import fileUploadRoutes from './file-upload.route.js';
import usersRoutes from './users.route.js';

const router = express.Router();

// User management routes.
router.use('/', usersRoutes);

// Authentication routes.
router.use('/auth', authRoutes);

// Dashboard-related routes.
router.use('/dashboards', dashboardRoutes);

// File upload routes.
router.use('/upload', fileUploadRoutes);

// Collection management routes.
router.use('', collectionRoutes);

export default router;
