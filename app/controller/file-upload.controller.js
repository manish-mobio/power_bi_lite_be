import HTTP_STATUS from '../utils/statuscode.js';
import constants from '../utils/constant.utils.js';
import Collection from '../models/collection.model.js';
import { inferSchema, parseFileContent, validateUploadPayload } from '../utils/file-upload.utils.js';
import fileUploadServices from '../services/file-upload.services.js';
/**
 * File upload handler - accepts CSV or JSON, parses, detects schema, stores as collection
 */
async function handleFileUpload(req, res, next) {
  try {
    const { fileName, fileContent, fileType, collectionName, mimeType, fileSize } = req.body;
    let parsedData = [];
    let detectedSchema = {};

    try {
      const { detectedType } = validateUploadPayload({
        fileName,
        fileType,
        mimeType,
        fileSize,
        fileContent,
      });
      parsedData = parseFileContent({ fileName, fileContent, fileType: detectedType });

      // Detect schema from first record
      const sample = parsedData[0];
      detectedSchema = inferSchema(sample);

      // Generate collection name if not provided
      const collName =
        collectionName ||
        (fileName
          ? fileName
              .replace(/\.(csv|json|xlsx)$/i, '')
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
        const collectionPayload = fileUploadServices.buildCollectionPayload({
          collName,
          detectedSchema,
          parsedData,
          inserted,
        });
        await fileUploadServices.createCollectionMeta(
          collectionPayload
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
        error: parseError?.message || constants.FAILED_TO_PARSE_FILE,
        code: parseError?.code || 'PARSE_FAILED',
        details: parseError?.details || parseError?.message,
      });
    }
  } catch (error) {
    next(error);
  }
}

export { handleFileUpload };
