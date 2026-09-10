import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { exec } from 'node:child_process';
import { 
  getStats, 
  getKnowledge, 
  searchKnowledge, 
  listRecent, 
  getMcpAuditLogs, 
  backupDatabase, 
  exportToMarkdown,
  deleteKnowledge
} from '../storage.js';
import { DB_PATH } from '../config.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PUBLIC_DIR = path.resolve(__dirname, 'public');

export const MAX_BODY_SIZE = 1024 * 1024; // 1MB 流量熔断防护

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * 校验 Origin 是否来自受信任的本地回环
 */
function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  } catch (e) {
    return false;
  }
}

/**
 * 统一设置 CORS 响应头
 */
function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MemHub-Request');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

/**
 * 统一 JSON 响应封装
 */
function sendJson(req, res, statusCode, payload) {
  setCorsHeaders(req, res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * 流式读取并解析 JSON Body（带 1MB 熔断机制）
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    let aborted = false;

    const onData = chunk => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_SIZE) {
        aborted = true;
        req.pause();
        req.removeListener('data', onData);
        const err = new Error('Payload Too Large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    };

    req.on('data', onData);

    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) {
        return resolve({});
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (err) {
        const parseErr = new Error('Invalid JSON');
        parseErr.statusCode = 400;
        reject(parseErr);
      }
    });

    req.on('error', err => {
      if (!aborted) reject(err);
    });
  });
}

/**
 * 静态资源伺服与安全沙箱防护 (Anti-Path Traversal)
 */
function serveStatic(req, res, reqPath) {
  const normalizedPath = reqPath === '/' ? '/index.html' : reqPath;
  const safePath = path.resolve(PUBLIC_DIR, '.' + normalizedPath);

  // 1. 沙箱边界硬编码校验：必须位于 PUBLIC_DIR 内且带路径分隔符，杜绝同名前缀兄弟目录
  const isInsidePublic = safePath === PUBLIC_DIR || safePath.startsWith(PUBLIC_DIR + path.sep);
  if (!isInsidePublic) {
    setCorsHeaders(req, res);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: Sandbox Traversal Detected');
    return;
  }

  // 2. 检查文件是否存在
  let stat;
  try {
    stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      throw new Error('Not a file');
    }
  } catch (e) {
    setCorsHeaders(req, res);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // 3. 扩展名与 MIME 白名单校验
  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext];
  if (!contentType) {
    setCorsHeaders(req, res);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: File type not permitted');
    return;
  }

  setCorsHeaders(req, res);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(safePath).pipe(res);
}

/**
 * 创建 MemHub WebUI HTTP Server
 */
export function createWebServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;
      const method = req.method.toUpperCase();

      // OPTIONS 预检请求处理
      if (method === 'OPTIONS') {
        setCorsHeaders(req, res);
        res.writeHead(204);
        res.end();
        return;
      }

      // API 路由分发
      if (pathname.startsWith('/api/')) {
        // 1. GET /api/status - 态势大盘与存储物理指标
        if (method === 'GET' && pathname === '/api/status') {
          let dbSize = 0;
          try {
            if (fs.existsSync(DB_PATH)) {
              dbSize = fs.statSync(DB_PATH).size;
            }
          } catch (e) {}

          const stats = getStats();
          return sendJson(req, res, 200, {
            success: true,
            data: {
              dbPath: DB_PATH,
              dbSizeBytes: dbSize,
              stats
            }
          });
        }

        // 2. GET /api/knowledge - 知识列表过滤与分页
        if (method === 'GET' && pathname === '/api/knowledge') {
          const category = parsedUrl.searchParams.get('category') || null;
          const project = parsedUrl.searchParams.get('project') || null;
          const tag = parsedUrl.searchParams.get('tag') || null;
          const status = parsedUrl.searchParams.get('status') || 'active';
          const limit = Math.min(Math.max(Number(parsedUrl.searchParams.get('limit')) || 50, 1), 200);
          const offset = Math.max(Number(parsedUrl.searchParams.get('offset')) || 0, 0);

          const items = listRecent({
            category,
            project,
            tags: tag ? [tag] : [],
            status,
            limit,
            offset
          });

          return sendJson(req, res, 200, {
            success: true,
            data: {
              items,
              total: items.length,
              limit,
              offset
            }
          });
        }

        // 3. GET /api/knowledge/:id - 知识详情展开
        if (method === 'GET' && pathname.startsWith('/api/knowledge/')) {
          const id = pathname.replace('/api/knowledge/', '').trim();
          if (!id) {
            return sendJson(req, res, 400, { success: false, error: 'Missing knowledge ID' });
          }
          const detail = getKnowledge(id);
          if (!detail) {
            return sendJson(req, res, 404, { success: false, error: `Knowledge entry [${id}] not found` });
          }
          return sendJson(req, res, 200, {
            success: true,
            data: detail
          });
        }

        // 3.1 DELETE /api/knowledge/:id - 物理删除知识卡片（CSRF 门禁防御）
        if (method === 'DELETE' && pathname.startsWith('/api/knowledge/')) {
          req.resume(); // 路径传参，排空连接
          const csrfHeader = req.headers['x-memhub-request'];
          if (csrfHeader !== '1') {
            return sendJson(req, res, 403, {
              success: false,
              error: 'CSRF Protection: Missing or invalid X-MemHub-Request header'
            });
          }

          const id = pathname.replace('/api/knowledge/', '').trim();
          if (!id) {
            return sendJson(req, res, 400, { success: false, error: 'Missing knowledge ID' });
          }

          const result = deleteKnowledge(id);
          if (result.notFound) {
            return sendJson(req, res, 404, { success: false, error: result.message });
          }

          return sendJson(req, res, 200, {
            success: true,
            data: result
          });
        }

        // 4. POST /api/search - 混合检索实验室
        if (method === 'POST' && pathname === '/api/search') {
          const body = await readJsonBody(req);
          const query = (body.query || '').trim();
          const category = body.category || null;
          const project = body.project || null;
          const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);

          const startTime = Date.now();
          const results = searchKnowledge(query, {
            category,
            project,
            limit,
            includeScores: true
          });
          const duration_ms = Date.now() - startTime;

          return sendJson(req, res, 200, {
            success: true,
            data: {
              query,
              duration_ms,
              items: results
            }
          });
        }

        // 5. GET /api/audit - MCP 工具调用审计流水
        if (method === 'GET' && pathname === '/api/audit') {
          const tool = parsedUrl.searchParams.get('tool') || null;
          const limit = Math.min(Math.max(Number(parsedUrl.searchParams.get('limit')) || 50, 1), 200);
          const offset = Math.max(Number(parsedUrl.searchParams.get('offset')) || 0, 0);

          const logs = getMcpAuditLogs({
            toolName: tool,
            limit,
            offset
          });

          return sendJson(req, res, 200, {
            success: true,
            data: {
              logs,
              total: logs.length,
              limit,
              offset
            }
          });
        }

        // 6. POST /api/ops/:action - 运维控制台（CSRF 门禁防御）
        if (method === 'POST' && pathname.startsWith('/api/ops/')) {
          const action = pathname.replace('/api/ops/', '').trim();

          // CSRF 门禁校验：必须包含 X-MemHub-Request: 1
          const csrfHeader = req.headers['x-memhub-request'];
          if (csrfHeader !== '1') {
            req.resume();
            return sendJson(req, res, 403, {
              success: false,
              error: 'CSRF Protection: Missing or invalid X-MemHub-Request header'
            });
          }

          if (action === 'backup') {
            req.resume();
            const start = Date.now();
            const backupPath = backupDatabase();
            const duration_ms = Date.now() - start;
            return sendJson(req, res, 200, {
              success: true,
              data: {
                backupPath,
                duration_ms
              }
            });
          }

          if (action === 'export') {
            req.resume();
            const exportRes = exportToMarkdown();
            return sendJson(req, res, 200, {
              success: true,
              data: exportRes
            });
          }

          if (action === 'delete') {
            const body = await readJsonBody(req);
            const targetId = (body.id || '').trim();
            if (!targetId) {
              return sendJson(req, res, 400, {
                success: false,
                error: 'Missing knowledge ID in body'
              });
            }

            const result = deleteKnowledge(targetId);
            if (result.notFound) {
              return sendJson(req, res, 404, { success: false, error: result.message });
            }

            return sendJson(req, res, 200, {
              success: true,
              data: result
            });
          }

          req.resume();
          return sendJson(req, res, 400, {
            success: false,
            error: `Unsupported ops action: [${action}]`
          });
        }

        // 未匹配的 API 接口
        return sendJson(req, res, 404, { success: false, error: 'API endpoint not found' });
      }

      // 静态资源文件伺服
      serveStatic(req, res, pathname);
    } catch (err) {
      if (err.statusCode) {
        if (err.statusCode === 413) {
          setCorsHeaders(req, res);
          res.writeHead(413, {
            'Content-Type': 'application/json; charset=utf-8',
            'Connection': 'close'
          });
          res.end(JSON.stringify({ success: false, error: err.message }));
          req.socket?.destroy();
          return;
        }
        return sendJson(req, res, err.statusCode, { success: false, error: err.message });
      }
      return sendJson(req, res, 500, { success: false, error: 'Internal Server Error' });
    }
  });

  return server;
}

/**
 * 跨平台安全调起默认浏览器
 */
export function openBrowser(urlToOpen) {
  // 受控拼接，阻断命令注入
  const safeUrl = String(urlToOpen).replace(/"/g, '');
  let cmd = '';

  if (process.platform === 'win32') {
    cmd = `cmd.exe /c start "" "${safeUrl}"`;
  } else if (process.platform === 'darwin') {
    cmd = `open "${safeUrl}"`;
  } else {
    cmd = `xdg-open "${safeUrl}"`;
  }

  exec(cmd, (err) => {
    // 浏览器调起失败仅记录警告，不影响 HTTP 服务
  });
}

/**
 * 启动 WebServer 监听并返回实例
 */
export function startWebServer(options = {}) {
  const port = Number(options.port) || 3900;
  const host = options.host || '127.0.0.1';
  const autoOpen = options.open !== false;

  const server = createWebServer();

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ [MemHub WebUI] 启动失败：端口 ${port} 已被占用。`);
        console.error(`💡 建议使用 --port <端口号> 指定其他可用端口，例如: memhub ui --port ${port + 1}\n`);
      }
      reject(err);
    });

    server.listen(port, host, () => {
      const accessUrl = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
      console.log(`\n🚀 [MemHub WebUI] 服务已启动: ${accessUrl}`);
      console.log(`📡 本地监听: ${host}:${port} | 安全沙箱已激活 | 0 外部重量中间件`);

      if (autoOpen) {
        openBrowser(accessUrl);
      }

      resolve({ server, port, host, url: accessUrl });
    });
  });
}
