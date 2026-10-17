const https = require('https');
const http = require('http');
const { URL } = require('url');

// electron/tongrenluApiBridge.cjs

// Tongrenlu (东方同人录) is a public, read-only archive. The renderer never talks to it
// directly: the main process proxies every request so CORS, ad-hoc routing, and rate-limit
// handling all stay out of renderer code. The protocol is plain HTTP/JSON with no auth.
//
// The bridge keeps an allowlist of operations so the IPC surface stays narrow: every entry
// corresponds to a documented public endpoint, and an unknown operation name is rejected
// without making a network call.

const ALLOWED_OPERATIONS = new Set([
  'album-stats',
  'random-albums',
  'search',
  'detail',
  'track',
  'tags',
  'artists',
  'events-count',
]);

// Tongrenlu returns 404 with a small JSON body rather than a proper error envelope; treat any
// non-2xx status as a failure and surface its code to the renderer.
const classifyStatus = (status, operation) => {
  if (status === 404) {
    return { code: 'not-playable', message: `Tongrenlu ${operation} returned 404`, stage: 'upstream', httpStatus: 404 };
  }
  if (status === 429) {
    return { code: 'rate-limited', message: `Tongrenlu ${operation} rate-limited`, stage: 'upstream', httpStatus: 429 };
  }
  if (status >= 500) {
    return { code: 'service-unavailable', message: `Tongrenlu ${operation} server error`, stage: 'upstream', httpStatus: status };
  }
  if (status >= 400) {
    return { code: 'network', message: `Tongrenlu ${operation} HTTP ${status}`, stage: 'upstream', httpStatus: status };
  }
  return null;
};

const fetchTongrenlu = (base, operation, params) => new Promise((resolve) => {
  let urlString;
  try {
    const baseUrl = new URL(base);
    // Use the base URL's path as the prefix and append /api/music/<operation>.
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}/api/music/${operation}`;
    baseUrl.search = '';
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        baseUrl.searchParams.set(key, String(value));
      });
    }
    urlString = baseUrl.toString();
  } catch (error) {
    resolve({
      ok: false,
      error: { code: 'unavailable', message: 'Tongrenlu base URL is invalid', stage: 'config' },
    });
    return;
  }

  const lib = urlString.startsWith('https:') ? https : http;
  const request = lib.get(urlString, { timeout: 15000 }, (response) => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      const failure = classifyStatus(response.statusCode || 0, operation);
      if (failure) {
        resolve({ ok: false, error: failure });
        return;
      }
      let parsed;
      try { parsed = JSON.parse(bodyText); }
      catch (error) {
        resolve({
          ok: false,
          error: { code: 'invalid-response', message: `Tongrenlu ${operation} returned unreadable body`, stage: 'upstream' },
        });
        return;
      }
      resolve({ ok: true, data: parsed });
    });
  });
  request.on('timeout', () => {
    request.destroy(new Error('timeout'));
  });
  request.on('error', (error) => {
    resolve({
      ok: false,
      error: {
        code: error && /timeout/i.test(String(error.message || '')) ? 'timeout' : 'network',
        message: `Tongrenlu ${operation} request failed: ${error && error.message ? error.message : 'unknown'}`,
        stage: 'upstream',
      },
    });
  });
});

function createTongrenluApiBridge({ baseUrl, warn = console.warn } = {}) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    if (warn) warn('[Tongrenlu] baseUrl is not configured; the bridge will reject every request');
  }
  const resolvedBase = typeof baseUrl === 'string' ? baseUrl.replace(/\/$/, '') : '';
  return {
    request(operation, params = {}) {
      if (!ALLOWED_OPERATIONS.has(operation)) {
        return Promise.resolve({
          ok: false,
          error: { code: 'unsupported', message: `Unsupported Tongrenlu operation: ${operation}` },
        });
      }
      if (!resolvedBase) {
        return Promise.resolve({
          ok: false,
          error: { code: 'unavailable', message: 'Tongrenlu base URL is not configured', stage: 'config' },
        });
      }
      return fetchTongrenlu(resolvedBase, operation, params);
    },
  };
}

module.exports = { createTongrenluApiBridge, TONGRENLU_ALLOWED_OPERATIONS: ALLOWED_OPERATIONS };
