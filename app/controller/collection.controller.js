import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';
import mongoose from 'mongoose';
import collectionServices from '../services/collection.services.js';
async function handleGetCollectionData(req, res, next) {
  try {
    const { collection } = req.params;
    const limit = parseInt(req.query.limit, 10) || 1000;
    if (!collection) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.COLLECTION_NAME_REQUIRED });
    }

    // Check if collection exists in metadata
    const collectionMeta = await collectionServices.findCollectionMetaByName(collection);
    if (!collectionMeta) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.COLLECTION_NOT_FOUND });
    }

    // Get dynamic model
    const dynamicSchema = new mongoose.Schema({}, { strict: false });
    const DynamicModel = mongoose.models[collection] || mongoose.model(collection, dynamicSchema);

    const data = await DynamicModel.find({}).limit(limit).lean();
    return res.status(HTTP_STATUS.OK).json(data);
  } catch (error) {
    next(error);
  }
}

/**
 * Get collection metadata (e.g. recordCount) for a collection
 */
async function handleGetCollectionMeta(req, res, next) {
  try {
    const { collection } = req.params;
    if (!collection) {
      return res
        .status(HTTP_STATUS.BAD_REQUEST)
        .json({ error: constants.COLLECTION_NAME_REQUIRED });
    }
    const collectionMeta = await collectionServices.findCollectionMetaByName(collection);
    if (!collectionMeta) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: constants.COLLECTION_NOT_FOUND });
    }
    return res.status(HTTP_STATUS.OK).json({
      recordCount: collectionMeta.recordCount !== null ? collectionMeta.recordCount : 0,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get list of all collections
 */
async function handleGetCollections(req, res, next) {
  try {
    const collections = await collectionServices.findAllCollectionMetasSorted();
    const collectionNames = collections.map(c => c.name);
    return res.status(HTTP_STATUS.OK).json(collectionNames);
  } catch (error) {
    next(error);
  }
}

export { handleGetCollectionData, handleGetCollectionMeta, handleGetCollections };
