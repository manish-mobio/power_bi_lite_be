import constants from './constant.utils.js';

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function getResetPasswordValidationError(token, password, minPasswordLength = 8) {
  const safeToken = String(token || '').trim();
  const safePassword = String(password || '');

  if (!safeToken) return constants.RESET_TOKEN_REQUIRED;
  if (safePassword.length < minPasswordLength) return constants.INVALID_PASSWORD_LENGTH;
  return '';
}

function parseYearMonthValue(value) {
  const match = String(value)
    .trim()
    .match(/^([0-9]{4})-([0-9]{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function parseQuarterValue(value) {
  const match = String(value)
    .trim()
    .match(/^([0-9]{4})-Q([1-4])$/i);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const quarter = parseInt(match[2], 10);
  if (Number.isNaN(year) || Number.isNaN(quarter)) return null;
  return { year, quarter };
}

function parseYearValue(value) {
  const year = parseInt(String(value).trim(), 10);
  if (Number.isNaN(year)) return null;
  return { year };
}

function sameDashboardPayload(a, b) {
  const pa = JSON.stringify({
    baseName: a?.baseName || '',
    collection: a?.collection || '',
    charts: a?.charts || [],
    layouts: a?.layouts || {},
    logo: a?.logo ?? null,
  });
  const pb = JSON.stringify({
    baseName: b?.baseName || '',
    collection: b?.collection || '',
    charts: b?.charts || [],
    layouts: b?.layouts || {},
    logo: b?.logo ?? null,
  });
  return pa === pb;
}

/**
 * Infer a basic schema from a single document.
 * This helper skips internal MongoDB fields and returns
 * a lightweight type map for each property.
 */
function inferSchema(doc) {
  if (!doc || typeof doc !== 'object') return {};

  const schema = {};

  for (const [key, value] of Object.entries(doc)) {
    if ((key.startsWith('_') && key !== '_id') || key === '__v') continue;

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

const SHARE_ROLES = new Set(['Viewer', 'Editor']);
export const RESET_TOKEN_TTL_MINUTES = 15;
export const PAGE_SIZE = 1000;
export {
  normalizeEmail,
  sameDashboardPayload,
  inferSchema,
  getResetPasswordValidationError,
  parseYearMonthValue,
  parseQuarterValue,
  parseYearValue,
  SHARE_ROLES,
};
