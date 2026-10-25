function toDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString().slice(0, 10);
    return value;
  }

  return String(value);
}

function toDateTime(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
    return value;
  }

  return String(value);
}

function toNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

module.exports = { toDateOnly, toDateTime, toNumber };
