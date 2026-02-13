const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MAX_LINES = 300;
const INCLUDE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.html', '.css']);
const EXCLUDE_DIR = new Set(['node_modules', 'dist', '.git', '.venv']);

function scan(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIR.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(fullPath, files);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (INCLUDE_EXT.has(ext)) files.push(fullPath);
  }
  return files;
}

function lineCount(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

const overLimit = scan(ROOT)
  .map((filePath) => ({
    file: path.relative(ROOT, filePath),
    lines: lineCount(filePath)
  }))
  .filter((item) => item.lines > MAX_LINES)
  .sort((a, b) => b.lines - a.lines);

if (overLimit.length === 0) {
  console.log(`OK: 所有檔案都 <= ${MAX_LINES} 行`);
  process.exit(0);
}

console.error(`發現 ${overLimit.length} 個檔案超過 ${MAX_LINES} 行:`);
for (const item of overLimit) {
  console.error(`- ${item.file}: ${item.lines}`);
}
process.exit(1);