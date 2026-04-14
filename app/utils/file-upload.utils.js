import parseCSV from './parse.utils.js';
import constants from './constant.utils.js';

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
 * @returns {Array} parsed rows
 * @throws {Error} with message or code for caller to map to HTTP errors
 */
function parseFileContent({ fileName, fileContent, fileType }) {
  if (fileType === 'csv' || fileName?.toLowerCase().endsWith('.csv')) {
    return parseCSV(fileContent);
  }

  if (fileType === 'json' || fileName?.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(fileContent);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed?.data && Array.isArray(parsed.data)) {
      return parsed.data;
    }
    return [parsed];
  }

  const err = new Error(constants.UNSUPPORTED_FILE_TYPE);
  err.code = 'UNSUPPORTED_FILE_TYPE';
  throw err;
}

export { inferSchema, parseFileContent };
