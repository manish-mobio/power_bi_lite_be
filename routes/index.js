import express from "express";
import { handleGetData, handleGetDashboards, handleGetDashboardById, handlePostDashboard, handleFileUpload, handleGetCollectionData, handleGetCollectionMeta, handleGetCollections } from "../controller/index.js";

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

// List all collections - GET /api/v1/collections
router.get('/collections', handleGetCollections);

// Collection metadata (recordCount) - must be before :collection to match /collection/:name/meta
router.get('/collection/:collection/meta', handleGetCollectionMeta);
// Dynamic Collection Data - GET /api/v1/collection/:collection
router.get('/collection/:collection', handleGetCollectionData);

export default router;