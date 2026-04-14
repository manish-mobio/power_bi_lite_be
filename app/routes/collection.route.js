import express from 'express';
const router = express.Router();
import {
  handleGetCollections,
  handleGetCollectionMeta,
  handleGetCollectionData,
} from '../controller/collection.controller.js';
import { handleValidationErrors } from '../middleware/validation.middleware.js';
import { collectionParamValidation } from '../middleware/validation.middleware.js';
router.get('/collections', handleGetCollections);
router.get(
  '/collection/:collection/meta',
  collectionParamValidation,
  handleValidationErrors,
  handleGetCollectionMeta
);
router.get(
  '/collection/:collection',
  collectionParamValidation,
  handleValidationErrors,
  handleGetCollectionData
);
export default router;
