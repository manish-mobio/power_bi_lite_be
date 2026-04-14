// lint spacing
import express from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { handleGetData, handleSearchUsers } from '../controller/users.controller.js';
const router = express.Router();
router.get('/search-users', requireAuth, handleSearchUsers);
router.get('/users', handleGetData);

export default router;
