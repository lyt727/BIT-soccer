import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class ApiRouter {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const segs = pattern.split('/').filter(Boolean);
    const rx = new RegExp(
      '^/' + segs.map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('/') + '$',
    );
    this.routes.push({ method, rx, keys, handler });
  }

  match(method, urlPath) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = urlPath.match(r.rx);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return null;
  }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export async function readJson(req, maxBytes = 26 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('请求体过大');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('请求体不是合法 JSON');
    err.status = 400;
    throw err;
  }
}

export function corsPreflight(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  });
  res.end();
}

export function serveStatic(root) {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.woff2': 'font/woff2',
  };
  return (req, res, urlPath) => {
    let rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.replace(/^\/+/, ''));
    const resolved = path.resolve(root, rel);
    if (!resolved.startsWith(path.resolve(root))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      if (urlPath.startsWith('/api/')) {
        sendJson(res, 404, { error: '接口不存在', code: 'NOT_FOUND' });
        return;
      }
      res.writeHead(404).end('not found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(resolved).pipe(res);
  };
}

export function createApiServer(router, staticHandler) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const urlPath = url.pathname;
    try {
      if (req.method === 'OPTIONS') {
        corsPreflight(res);
        return;
      }
      if (urlPath.startsWith('/api/')) {
        const route = router.match(req.method, urlPath);
        if (!route) {
          sendJson(res, 404, { error: '接口不存在', code: 'NOT_FOUND' });
          return;
        }
        await route.handler(req, res, route.params, url);
        return;
      }
      staticHandler(req, res, urlPath);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) {
        console.error('[server error]', err);
      }
      sendJson(res, status, {
        // 5xx 默认隐藏细节；主动标记 expose 的业务错误（如短信未配置）照实返回
        error: (status >= 500 && err.expose !== true)
          ? '服务器内部错误，请稍后重试'
          : err.message,
        code: err.code || 'ERROR',
      });
    }
  });
}
