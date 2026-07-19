// JSON file persistence under the app's userData directory.
// Crash-safe: atomic writes (temp + rename), a rolling .bak of the last good
// version, and a load path that recovers from backup or preserves a corrupt
// file rather than silently discarding it. A killed process mid-write can
// never lose data.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class Store {
  constructor(name, defaults = {}) {
    this.file = path.join(app.getPath('userData'), `${name}.json`);
    this.bak = this.file + '.bak';
    this.defaults = defaults;
    this.data = this._load();
  }

  _readValid(file) {
    // returns parsed object, or null if missing/empty/corrupt
    try {
      const raw = fs.readFileSync(file, 'utf8');
      if (!raw.trim()) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }

  _load() {
    const main = this._readValid(this.file);
    if (main) return { ...this.defaults, ...main };

    // main file missing or corrupt — try the backup before giving up
    const bak = this._readValid(this.bak);
    if (bak) {
      try { fs.copyFileSync(this.bak, this.file); } catch { /* best effort */ }
      return { ...this.defaults, ...bak };
    }

    // both unreadable: if a non-empty main file exists it's corrupt — preserve
    // it for forensics/recovery instead of letting the next save overwrite it
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 0) {
        fs.renameSync(this.file, this.file + `.corrupt-${Date.now()}`);
      }
    } catch { /* best effort */ }
    return { ...this.defaults };
  }

  save() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    // keep the last known-good file as .bak before overwriting
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 0) {
        fs.copyFileSync(this.file, this.bak);
      }
    } catch { /* best effort */ }
    // atomic write: fully write a temp file, flush, then rename over the target
    const tmp = this.file + `.tmp-${process.pid}`;
    const json = JSON.stringify(this.data, null, 2);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, json);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file); // atomic on the same volume
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
