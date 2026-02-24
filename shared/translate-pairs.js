function defaultSanitize(value) {
  return String(value || '').trim();
}

function parsePairKeys(raw, sanitize = defaultSanitize) {
  const tokens = String(raw || '')
    .split(',')
    .map((value) => sanitize(value))
    .filter(Boolean);

  const seen = new Set();
  const pairs = [];
  for (const token of tokens) {
    const parts = String(token)
      .split(':')
      .map((value) => sanitize(value).toLowerCase())
      .filter(Boolean);
    if (parts.length !== 2) continue;
    const key = `${parts[0]}:${parts[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(key);
  }
  return pairs;
}

function parsePairObjects(raw, sanitize = defaultSanitize) {
  return parsePairKeys(raw, sanitize).map((key) => {
    const [source, target] = key.split(':');
    return { source, target, key };
  });
}

module.exports = {
  parsePairKeys,
  parsePairObjects
};
