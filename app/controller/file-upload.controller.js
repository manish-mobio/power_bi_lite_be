import parseCSV from '../utils/parse.utils.js';
import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';
import Collection from '../models/collection.model.js';
import { inferSchema } from '../utils/common.utils.js';
import fileUploadServices from '../services/file-upload.services.js';
/**
 * File upload handler - accepts CSV or JSON, parses, detects schema, stores as collection
 */
async function handleFileUpload(req, res, next) {
  try {
    const { fileName, fileContent, fileType, collectionName } = req.body;
    if (!fileContent) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.FILE_CONTENT_REQUIRED });
    }

    let parsedData = [];
    let detectedSchema = {};

    try {
      if (fileType === 'csv' || fileName?.toLowerCase().endsWith('.csv')) {
        parsedData = parseCSV(fileContent);
      } else if (fileType === 'json' || fileName?.toLowerCase().endsWith('.json')) {
        parsedData = JSON.parse(fileContent);
        if (!Array.isArray(parsedData)) {
          // If it's an object with a data array
          if (parsedData.data && Array.isArray(parsedData.data)) {
            parsedData = parsedData.data;
          } else {
            parsedData = [parsedData];
          }
        }
      } else {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: constants.UNSUPPORTED_FILE_TYPE });
      }

      if (!Array.isArray(parsedData) || parsedData.length === 0) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json({ error: constants.NO_VALID_DATA_FOUND_IN_FILE });
      }

      // Detect schema from first record
      const sample = parsedData[0];
      detectedSchema = inferSchema(sample);

      // Generate collection name if not provided
      const collName =
        collectionName ||
        (fileName
          ? fileName
              .replace(/\.(csv|json)$/i, '')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '_')
          : `uploaded_${Date.now()}`);

      // Check if collection already exists - if so, replace it
      const existing = await fileUploadServices.findCollectionMetaByName(collName);
      const isReplacement = !!existing;

      // Create dynamic model for this collection
      // const DynamicModel = fileUploadServices.getDynamicUploadModel(collName);

      // If collection exists, delete all existing documents
      if (isReplacement) {
        await fileUploadServices.deleteManyInDynamicCollection(collName);
      }

      // Insert data into MongoDB
      const inserted = await fileUploadServices.insertManyInDynamicCollection(collName, parsedData);

      // Store or update collection metadata
      if (isReplacement) {
        // Update existing collection metadata
        await Collection.findOneAndUpdate(
          { name: collName },
          {
            schema: detectedSchema,
            data: parsedData.slice(0, 100), // Store sample for preview
            recordCount: inserted.length,
            updatedAt: new Date(),
          },
          { new: true }
        );
      } else {
        // Create new collection metadata
        await fileUploadServices.createCollectionMeta(
          fileUploadServices.buildCollectionPayload({
            collName,
            detectedSchema,
            parsedData,
            inserted,
          })
        );
      }

      // Return schema info for frontend
      const schemaArray = Object.entries(detectedSchema).map(([name, info]) => ({
        name,
        type: info.type === 'number' ? 'number' : 'string',
      }));

      return res.status(HTTP_STATUS.CREATED).json({
        success: true,
        collection: collName,
        schema: schemaArray,
        recordCount: inserted.length,
        replaced: isReplacement,

        message: isReplacement
          ? `Successfully replaced collection "${collName}" with ${inserted.length} records`
          : `Successfully uploaded ${inserted.length} records to collection "${collName}"`,
      });
    } catch (parseError) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: constants.FAILED_TO_PARSE_FILE,
        details: parseError.message,
      });
    }
  } catch (error) {
    next(error);
  }
}

export { handleFileUpload };
