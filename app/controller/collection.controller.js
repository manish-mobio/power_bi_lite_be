import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';
import mongoose from 'mongoose';
import collectionServices from '../services/collection.services.js';
async function handleGetCollectionData(req, res, next) {
  try {
    const { collection } = req.params;
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 1000);
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const paginated =
      String(req.query.paginated).toLowerCase() === 'true' ||
      req.query.paginated === '1';
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

    const filter = {};
    const filterField = req.query.filterField;
    const filterType = req.query.filterType;
    const filterFrom = req.query.filterFrom;
    const filterTo = req.query.filterTo;
    const filterValue = req.query.filterValue;

    if (filterField && filterType) {
      if (filterType === 'date') {
        const range = {};
        if (filterFrom) {
          const fromDate = new Date(filterFrom);
          if (!Number.isNaN(fromDate.getTime())) {
            range.$gte = fromDate;
          }
        }
        if (filterTo) {
          const toDate = new Date(filterTo);
          if (!Number.isNaN(toDate.getTime())) {
            toDate.setHours(23, 59, 59, 999);
            range.$lte = toDate;
          }
        }
        if (Object.keys(range).length) {
          filter[filterField] = range;
        }
      } else if (filterType === 'month' && filterValue) {
        const match = String(filterValue).trim().match(/^(\d{4})-(\d{2})$/);
        if (match) {
          const year = parseInt(match[1], 10);
          const month = parseInt(match[2], 10);
          if (!Number.isNaN(year) && !Number.isNaN(month) && month >= 1 && month <= 12) {
            const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const end = new Date(year, month, 0, 23, 59, 59, 999);
            filter[filterField] = { $gte: start, $lte: end };
          }
        }
      } else if (filterType === 'quarter' && filterValue) {
        const match = String(filterValue).trim().match(/^(\d{4})-Q([1-4])$/i);
        if (match) {
          const year = parseInt(match[1], 10);
          const quarter = parseInt(match[2], 10);
          if (!Number.isNaN(year) && !Number.isNaN(quarter)) {
            const startMonth = (quarter - 1) * 3;
            const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
            const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
            filter[filterField] = { $gte: start, $lte: end };
          }
        }
      } else if (filterType === 'year' && filterValue) {
        const year = parseInt(String(filterValue).trim(), 10);
        if (!Number.isNaN(year)) {
          const start = new Date(year, 0, 1, 0, 0, 0, 0);
          const end = new Date(year, 11, 31, 23, 59, 59, 999);
          filter[filterField] = { $gte: start, $lte: end };
        }
      }
    }

    const query = DynamicModel.find(filter).skip(skip).limit(limit);
    const [data, total] = await Promise.all([
      query.lean(),
      DynamicModel.countDocuments(filter),
    ]);

    if (paginated) {
      return res.status(HTTP_STATUS.OK).json({
        rows: data,
        total,
        skip,
        limit,
      });
    }

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
