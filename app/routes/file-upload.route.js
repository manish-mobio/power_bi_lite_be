import express from 'express';
import { handleFileUpload } from '../controller/file-upload.controller.js';

const router = express.Router();

// Handles file upload POST requests.
router.post('/', handleFileUpload);

export default router;
