function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
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
export { normalizeEmail, sameDashboardPayload, inferSchema, SHARE_ROLES };
