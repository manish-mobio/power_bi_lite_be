import express from "express";
import { handleGetData, handleGetDashboards, handleGetDashboardById, handlePostDashboard, handleFileUpload, handleGetCollectionData } from "../controller/index.js";

const router = express.Router();

// Users - GET /api/v1/ or /api/v1/users
router.get('/', handleGetData);
router.get('/users', handleGetData);

// Dashboards - GET/POST /api/v1/dashboards, GET /api/v1/dashboards/:id
router.get('/dashboards', handleGetDashboards);
router.get('/dashboards/:id', handleGetDashboardById);
router.post('/dashboards', handlePostDashboard);

// File Upload - POST /api/v1/upload
router.post('/upload', handleFileUpload);

// Dynamic Collection Data - GET /api/v1/collection/:collection
router.get('/collection/:collection', handleGetCollectionData);

export default router;