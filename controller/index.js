import userTbl from "../models/index.js"
import dashboardTbl from "../models/dashboard.js"
import Collection from "../models/collection.js"
import mongoose from "mongoose"

async function handleGetData(req, res, next) {
    try {
        const limit = parseInt(req.query.limit, 10) || 1000;
        const data = await userTbl.find({}).limit(limit).lean();
        return res.status(200).json(data);
    } catch (error) {
        next(error);
    }
}

async function handleGetDashboards(req, res, next) {
    try {
        const data = await dashboardTbl.find({}).sort({ updatedAt: -1 }).lean();
        return res.status(200).json(data);
    } catch (error) {
        next(error);
    }
}

async function handleGetDashboardById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid dashboard ID' });
        }
        const dashboard = await dashboardTbl.findById(id).lean();
        if (!dashboard) {
            return res.status(404).json({ error: 'Dashboard not found' });
        }
        return res.status(200).json(dashboard);
    } catch (error) {
        next(error);
    }
}

async function handlePostDashboard(req, res, next) {
    try {
        const { name = 'My Dashboard', charts = [], layouts = {} } = req.body || {};
        const dashboard = await dashboardTbl.create({
            name,
            charts,
            layouts,
        });
        return res.status(201).json(dashboard);
    } catch (error) {
        next(error);
    }
}

/**
 * Infer field types from a sample document
 */
function inferSchema(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const schema = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('_') && key !== '_id') continue;
    if (key === '__v') continue;
    
    if (value === null || value === undefined) {
      schema[key] = { type: 'string', detected: false };
    } else if (typeof value === 'number') {
      schema[key] = { type: 'number', detected: true };
    } else if (typeof value === 'boolean') {
      schema[key] = { type: 'boolean', detected: true };
    } else if (Array.isArray(value)) {
      schema[key] = { type: 'array', detected: true };
    } else if (typeof value === 'object') {
      schema[key] = { type: 'object', detected: true };
    } else {
      schema[key] = { type: 'string', detected: true };
    }
  }
  return schema;
}

/**
 * Parse CSV text into array of objects
 */
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error('CSV must have at least a header and one data row');
  }
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Handle quoted values
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const obj = {};
    headers.forEach((header, idx) => {
      let value = values[idx] || '';
      value = value.replace(/^"|"$/g, ''); // Remove quotes
      
      // Try to parse as number
      if (value && !isNaN(value) && value !== '') {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          obj[header] = num;
        } else {
          obj[header] = value;
        }
      } else {
        obj[header] = value;
      }
    });
    rows.push(obj);
  }
  
  return rows;
}

/**
 * File upload handler - accepts CSV or JSON, parses, detects schema, stores as collection
 */
async function handleFileUpload(req, res, next) {
  try {
    const { fileName, fileContent, fileType, collectionName } = req.body;
    
    if (!fileContent) {
      return res.status(400).json({ error: 'File content is required' });
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
        return res.status(400).json({ error: 'Unsupported file type. Use CSV or JSON.' });
      }
      
      if (!Array.isArray(parsedData) || parsedData.length === 0) {
        return res.status(400).json({ error: 'No valid data found in file' });
      }
      
      // Detect schema from first record
      const sample = parsedData[0];
      detectedSchema = inferSchema(sample);
      
      // Generate collection name if not provided
      const collName = collectionName || 
        (fileName ? fileName.replace(/\.(csv|json)$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '_') : 
         `uploaded_${Date.now()}`);
      
      // Check if collection already exists - if so, replace it
      const existing = await Collection.findOne({ name: collName });
      const isReplacement = !!existing;
      
      // Create dynamic model for this collection
      const dynamicSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
      const DynamicModel = mongoose.models[collName] || mongoose.model(collName, dynamicSchema);
      
      // If collection exists, delete all existing documents
      if (isReplacement) {
        await DynamicModel.deleteMany({});
      }
      
      // Insert data into MongoDB
      const inserted = await DynamicModel.insertMany(parsedData);
      
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
        await Collection.create({
          name: collName,
          schema: detectedSchema,
          data: parsedData.slice(0, 100), // Store sample for preview
          recordCount: inserted.length,
        });
      }
      
      // Return schema info for frontend
      const schemaArray = Object.entries(detectedSchema).map(([name, info]) => ({
        name,
        type: info.type === 'number' ? 'number' : 'string',
      }));
      
      return res.status(201).json({
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
      return res.status(400).json({ 
        error: 'Failed to parse file', 
        details: parseError.message 
      });
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Get data from a dynamic collection
 */
async function handleGetCollectionData(req, res, next) {
  try {
    const { collection } = req.params;
    const limit = parseInt(req.query.limit, 10) || 1000;
    
    if (!collection) {
      return res.status(400).json({ error: 'Collection name is required' });
    }
    
    // Check if collection exists in metadata
    const collectionMeta = await Collection.findOne({ name: collection });
    if (!collectionMeta) {
      return res.status(404).json({ error: `Collection "${collection}" not found` });
    }
    
    // Get dynamic model
    const dynamicSchema = new mongoose.Schema({}, { strict: false });
    const DynamicModel = mongoose.models[collection] || mongoose.model(collection, dynamicSchema);
    
    const data = await DynamicModel.find({}).limit(limit).lean();
    return res.status(200).json(data);
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
      return res.status(400).json({ error: 'Collection name is required' });
    }
    const collectionMeta = await Collection.findOne({ name: collection }).lean();
    if (!collectionMeta) {
      return res.status(404).json({ error: `Collection "${collection}" not found` });
    }
    return res.status(200).json({
      recordCount: collectionMeta.recordCount != null ? collectionMeta.recordCount : 0,
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
    const collections = await Collection.find({}).select('name recordCount').sort({ name: 1 }).lean();
    const collectionNames = collections.map(c => c.name);
    return res.status(200).json(collectionNames);
  } catch (error) {
    next(error);
  }
}

export { handleGetData, handleGetDashboards, handleGetDashboardById, handlePostDashboard, handleFileUpload, handleGetCollectionData, handleGetCollectionMeta, handleGetCollections }