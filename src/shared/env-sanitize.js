function cleanEnv(value, allowSpaces = false) {
  if (!value) return '';
  let cleaned = String(value).replace(/[^\x20-\x7E]/g, '');
  if (!allowSpaces) cleaned = cleaned.replace(/\s/g, '');
  return cleaned.trim();
}

module.exports = { cleanEnv };
