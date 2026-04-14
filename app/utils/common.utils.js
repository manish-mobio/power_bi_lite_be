function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function sameDashboardPayload(a, b) {
  const pa = JSON.stringify({
    charts: a?.charts || [],
    layouts: a?.layouts || {},
    logo: a?.logo ?? null,
  });
  const pb = JSON.stringify({
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
export { normalizeEmail, sameDashboardPayload, inferSchema };
