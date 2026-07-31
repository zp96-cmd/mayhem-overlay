// Cloudflare (in front of aramgg.com + arammayhem.com) fingerprints the TLS
// handshake, so a plain Node fetch is blocked no matter what headers we send.
// Fetch through a hidden, never-shown Chromium window instead — it has Chrome's
// real fingerprint and executes any JS challenge in-page, so the (public,
// robots-allowed) data comes through. Used only for the once-per-patch refresh
// and the once-per-game aramgg champion fetch.
const { BrowserWindow } = require('electron');

// mode 'text' -> raw text / JSON body (reads the JSON viewer's <pre> or body).
// mode 'html' -> the hydrated document HTML (for scraping rendered pages).
async function browserFetch(url, mode = 'text', { settleMs = 1600, timeout = 30000 } = {}) {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: false,
    },
  });
  let timer;
  const timeoutP = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`browserFetch timeout: ${url}`)), timeout);
  });
  try {
    try {
      await Promise.race([win.loadURL(url), timeoutP]);
    } catch (e) {
      // a JSON response can reject loadURL with ERR_ABORTED while still having
      // rendered the body; only bail on a real timeout
      if (String(e.message).includes('timeout')) throw e;
    }
    // let a Cloudflare challenge / Astro hydration settle, then read the content
    await new Promise((r) => setTimeout(r, settleMs));
    const js = mode === 'html'
      ? 'document.documentElement.outerHTML'
      : '((document.querySelector("pre") || document.body || {}).innerText || "")';
    const out = await win.webContents.executeJavaScript(js);
    if (!out) throw new Error(`browserFetch empty: ${url}`);
    return out;
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { browserFetch };
