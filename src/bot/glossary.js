const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.resolve('secrets/glossary.json');

class Glossary {
  constructor(filePath = DEFAULT_PATH) {
    this.filePath = filePath;
    this.data = {};
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (_) {
      this.data = {};
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error(`術語表儲存失敗: ${err.message}`);
    }
  }

  getEntries(pairKey) {
    return Object.entries(this.data[pairKey] || {});
  }

  add(pairKey, source, target) {
    if (!this.data[pairKey]) this.data[pairKey] = {};
    this.data[pairKey][source] = target;
    this._save();
  }

  remove(pairKey, source) {
    if (!this.data[pairKey]) return false;
    if (!Object.prototype.hasOwnProperty.call(this.data[pairKey], source)) return false;
    delete this.data[pairKey][source];
    if (Object.keys(this.data[pairKey]).length === 0) delete this.data[pairKey];
    this._save();
    return true;
  }
}

module.exports = { Glossary };
