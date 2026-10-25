function normalizeKenyanPhoneNumber(value) {
  if (typeof value !== 'string') return null;
  const compact = value.trim().replace(/[\s()-]/g, '');
  let digits;

  if (/^0[17]\d{8}$/.test(compact)) digits = `254${compact.slice(1)}`;
  else if (/^\+254[17]\d{8}$/.test(compact)) digits = compact.slice(1);
  else if (/^254[17]\d{8}$/.test(compact)) digits = compact;
  else return null;

  return digits;
}

function toMinorUnits(value) {
  const text = String(value);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

module.exports = { normalizeKenyanPhoneNumber, toMinorUnits };
