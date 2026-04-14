/**
 * Parse CSV text into an array of objects.
 * Supports basic quoted values and numeric conversion.
 */
import constants from './constant.utils.js';
function parseCSV(text) {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error(constants.CSV_MUST_HAVE_AT_LEAST_A_HEADER_AND_ONE_DATA_ROW);
  }

  const headers = lines[0].split(',').map(header => header.trim().replace(/^"|"$/g, ''));

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

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

export default parseCSV;
