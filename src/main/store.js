// Simple JSON file persistence under the app's userData directory.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class Store {
  constructor(name, defaults = {}) {
    this.file = path.join(app.getPath('userData'), `${name}.json`);
    this.defaults = defaults;
    this.data = this._load();
  }

  _load() {
    try {
      return { ...this.defaults, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return { ...this.defaults };
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get(key, fallback) {
    return this.data[key] !== undefined ? this.data[key] : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }
}

module.exports = { Store };
