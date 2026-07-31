// Cloudflare (in front of aramgg.com + arammayhem.com) fingerprints the TLS
// handshake, so a plain Node https request is blocked no matter the headers.
// Electron's `net` module issues requests through Chromium's own network stack,
// which has Chrome's real TLS fingerprint — so it sails past Cloudflare's
// fingerprint filter while returning the raw body directly (no window, no JS,
// no hang). Used only for the once-per-patch refresh + once-per-game aramgg
// fetch of this public, robots-allowed data.
const { net } = require('electron');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// mode is accepted for call-site compatibility but ignored — always returns the
// raw response body (JSON string or page HTML).
function browserFetch(url, _mode = 'text', { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, redirect: 'follow' });
    for (const [k, v] of Object.entries(HEADERS)) req.setHeader(k, v);

    const timer = setTimeout(() => { try { req.abort(); } catch {} reject(new Error(`net timeout: ${url}`)); }, timeout);

    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.on('data', () => {});
        res.on('end', () => { clearTimeout(timer); reject(new Error(`${res.statusCode} ${url}`)); });
        return;
      }
      let body = '';
      res.on('data', (c) => { body += c.toString('utf8'); });
      res.on('end', () => { clearTimeout(timer); resolve(body); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

module.exports = { browserFetch };
