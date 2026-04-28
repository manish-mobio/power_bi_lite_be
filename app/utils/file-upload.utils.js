import parseCSV from './parse.utils.js';
import constants from './constant.utils.js';
import xlsx from 'xlsx';

const SUPPORTED_FILE_TYPES = new Set(['csv', 'json', 'xlsx']);
const SUPPORTED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/json',
  'text/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_RECORDS = 100000;

function getMaxFileSizeBytes() {
  const envLimit = Number(process.env.MAX_UPLOAD_FILE_BYTES || 0);
  return Number.isFinite(envLimit) && envLimit > 0
    ? envLimit
    : DEFAULT_MAX_FILE_SIZE_BYTES;
}

function getFileExtension(fileName = '') {
  const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function detectFileType({ fileType, fileName }) {
  const normalizedType = String(fileType || '').toLowerCase().trim();
  if (SUPPORTED_FILE_TYPES.has(normalizedType)) return normalizedType;
  const ext = getFileExtension(fileName);
  if (SUPPORTED_FILE_TYPES.has(ext)) return ext;
  return '';
}

function createUploadError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

function validateUploadPayload({
  fileName,
  fileType,
  mimeType,
  fileSize,
  fileContent,
}) {
  const detectedType = detectFileType({ fileType, fileName });
  const extension = getFileExtension(fileName);
  const maxSizeBytes = getMaxFileSizeBytes();

  if (!fileContent) {
    throw createUploadError('FILE_CONTENT_REQUIRED', constants.FILE_CONTENT_REQUIRED);
  }
  if (
    detectedType !== 'xlsx' &&
    typeof fileContent === 'string' &&
    fileContent.trim().length === 0
  ) {
    throw createUploadError('EMPTY_FILE', constants.FILE_IS_EMPTY);
  }

  if (!detectedType || (extension && detectedType !== extension)) {
    throw createUploadError('UNSUPPORTED_FILE_TYPE', constants.UNSUPPORTED_FILE_TYPE);
  }

  const normalizedMime = String(mimeType || '').toLowerCase().trim();
  if (normalizedMime && !SUPPORTED_MIME_TYPES.has(normalizedMime)) {
    throw createUploadError('INVALID_MIME_TYPE', constants.INVALID_FILE_FORMAT);
  }

  if (Number(fileSize) > maxSizeBytes) {
    throw createUploadError(
      'FILE_TOO_LARGE',
      `${constants.FILE_TOO_LARGE}. Max ${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB`
    );
  }

  return { detectedType, maxSizeBytes };
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) {
    throw createUploadError('UNSUPPORTED_STRUCTURE', constants.UNSUPPORTED_FILE_STRUCTURE);
  }
  const cleaned = records.filter(row => row && typeof row === 'object');
  if (!cleaned.length) {
    throw createUploadError('EMPTY_FILE', constants.FILE_IS_EMPTY);
  }
  if (cleaned.length > MAX_RECORDS) {
    throw createUploadError('FILE_TOO_LARGE', constants.FILE_TOO_LARGE);
  }
  return cleaned;
}

function parseJsonContent(fileContent) {
  let parsed;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw createUploadError('JSON_PARSE_FAILED', constants.UNABLE_TO_PARSE_FILE);
  }
  if (Array.isArray(parsed)) return normalizeRecords(parsed);
  if (parsed?.data && Array.isArray(parsed.data)) return normalizeRecords(parsed.data);
  if (parsed && typeof parsed === 'object') return normalizeRecords([parsed]);
  throw createUploadError('UNSUPPORTED_STRUCTURE', constants.UNSUPPORTED_FILE_STRUCTURE);
}

function parseCsvContent(fileContent) {
  try {
    const rows = parseCSV(fileContent);
    return normalizeRecords(rows);
  } catch (error) {
    if (error?.message === constants.CSV_MUST_HAVE_AT_LEAST_A_HEADER_AND_ONE_DATA_ROW) {
      throw createUploadError('EMPTY_FILE', constants.FILE_IS_EMPTY);
    }
    throw createUploadError('CSV_PARSE_FAILED', constants.UNABLE_TO_PARSE_FILE, error?.message);
  }
}

function parseExcelContent(fileContent) {
  let buffer;
  try {
    buffer = Buffer.from(String(fileContent), 'base64');
  } catch {
    throw createUploadError('CORRUPTED_FILE', constants.UNABLE_TO_PARSE_FILE);
  }
  if (!buffer?.length) {
    throw createUploadError('EMPTY_FILE', constants.FILE_IS_EMPTY);
  }

  let workbook;
  try {
    workbook = xlsx.read(buffer, { type: 'buffer' });
  } catch {
    throw createUploadError('XLSX_PARSE_FAILED', constants.UNABLE_TO_PARSE_FILE);
  }

  const firstSheetName = workbook?.SheetNames?.[0];
  if (!firstSheetName) {
    throw createUploadError('EMPTY_SHEETS', constants.EXCEL_FILE_HAS_NO_SHEETS);
  }
  const firstSheet = workbook.Sheets[firstSheetName];
  if (!firstSheet) {
    throw createUploadError('EMPTY_SHEETS', constants.EXCEL_FILE_HAS_NO_SHEETS);
  }

  const records = xlsx.utils.sheet_to_json(firstSheet, {
    defval: '',
    raw: false,
    blankrows: false,
  });
  if (!records.length) {
    throw createUploadError('EMPTY_SHEET', constants.EXCEL_FIRST_SHEET_EMPTY);
  }
  return normalizeRecords(records);
}

function inferSchema(doc) {
  if (!doc || typeof doc !== 'object') return {};

  const schema = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('_') && key !== '_id') continue;
    if (key === '__v') continue;

    switch (true) {
      case value === null || value === undefined:
        schema[key] = { type: 'string', detected: false };
        break;

      case typeof value === 'number':
        schema[key] = { type: 'number', detected: true };
        break;

      case typeof value === 'boolean':
        schema[key] = { type: 'boolean', detected: true };
        break;

      case Array.isArray(value):
        schema[key] = { type: 'array', detected: true };
        break;

      case typeof value === 'object':
        schema[key] = { type: 'object', detected: true };
        break;

      default:
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
  const detectedType = detectFileType({ fileType, fileName });
  if (detectedType === 'csv') return parseCsvContent(fileContent);
  if (detectedType === 'json') return parseJsonContent(fileContent);
  if (detectedType === 'xlsx') return parseExcelContent(fileContent);
  throw createUploadError('UNSUPPORTED_FILE_TYPE', constants.UNSUPPORTED_FILE_TYPE);
}

export { inferSchema, parseFileContent, validateUploadPayload };
