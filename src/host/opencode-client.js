import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { PathFilter } from '../path-filter.js';

/**
 * OpenCode 宿主驱动客户端 (OpenCode Host Driver Client)
 *
 * 负责让 memhub daemon 主动调用正在运行的 opencode HTTP server，把"沉淀指令"
 * 注入到某个空闲会话，由该会话内的宿主 LLM 借自己的一手上下文与算力，调用
 * MCP memhub_save 完成高质量记忆抽取。
 *
 * 【端口动态发现】—— 不依赖任何单一来源，多策略级联，命中即止：
 *   1. 显式 baseUrl（最高优先，配置/环境变量 MEMHUB_OPENCODE_URL）
 *   2. 从运行中 opencode 进程命令行解析 --hostname/--port
 *   3. netstat 枚举 opencode 进程的监听端口，逐个 health 探测出真正的 API server
 *   4. 默认端口 4096 优先探测（opencode 无显式 --port 时优先抢占 4096，被占才随机）
 *   5. 兜底探测常用端口范围
 * 说明：opencode 默认不把监听端口写入磁盘文件，mDNS 亦默认关闭，故纯外部
 *       只能靠"进程命令行 + 监听端口枚举 + 默认 4096 优先"组合实现动态发现。
 *
 * 【安全设计】—— 直接向用户活跃会话注入指令有打扰风险：
 *   - autoExtract 默认关闭（见 config daemon 块），用户显式开启才真发；
 *   - 只注入 status 为 idle 的会话，绝不打扰 running 会话；
 *   - dispatch 默认"桩"(dry-run)：只打印将注入的载荷，不真发 POST；
 *     设 MEMHUB_OPENCODE_DISPATCH=1 才真发（需宿主已开启 MCP memhub_save）。
 */

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;

function basicAuthHeader() {
  const username = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  const password = process.env.OPENCODE_SERVER_PASSWORD || '';
  if (!password) return null;
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/* ============================================================================
 * 【版本探测与双版本适配层 (V1 / V2 Detection & Adapter)】
 *
 * 背景：OpenCode 2 把「服务端 API 契约」列为官方刻意破坏性变更之一：
 *   - 所有端点统一加 `/api` 前缀且语义变化；
 *   - 响应改为 `{ data, cursor }` 信封（不再裸数组）；
 *   - 会话对象 directory -> location.directory，timeUpdated -> time.{created,updated}；
 *   - 消息由「一条 message 带 parts」改为「判别联合 typed message」，
 *     assistant 回复改为 { type:'assistant', content:[{type:'text'|'reasoning'|'tool'}] }；
 *   - prompt_async 合并为 prompt，body 由 { parts:[{type:'text',text}] } 改为扁平的 { text }；
 *   - 批量 /session/status 取消，改为 /api/session/active（仅返回 running 集合）。
 *
 * 设计：探测结果按 baseUrl 缓存，一次探测终身复用（server 换版本概率极低）。
 *       上层 daemon.js / dream/pipeline.js 的调用签名保持不变，差异全部收敛在本文件。
 *
 * 判定顺序采用「端点探测」——最贴近运行时真实行为，不依赖版本号字符串格式：
 *   1. GET /api/info 通 -> v2（先探 v2，避免 v1 未来新增 /api/info 造成误判的成本更高；
 *      实际上 v1 无该端点，v2 亦无 /global/health，两者互斥，判定唯一）
 *   2. GET /global/health 通 -> v1
 * ========================================================================== */

export const OPENCODE_API_VERSION = { V1: 1, V2: 2 };

/** baseUrl -> 版本号 的探测缓存（进程内 Map，避免每次调用多打一次探测） */
const versionCache = new Map();

/**
 * 探测单个 baseUrl 的 OpenCode API 版本（端点探测，带缓存）。
 * @param {string} baseUrl
 * @param {number} timeoutMs
 * @returns {Promise<1|2|null>} 1=V1, 2=V2, null=不可达/非 OpenCode server
 */
export async function detectApiVersion(baseUrl, timeoutMs = 3000) {
  if (!baseUrl) return null;
  const key = String(baseUrl).replace(/\/$/, '');
  if (versionCache.has(key)) return versionCache.get(key);

  const auth = basicAuthHeader();
  // 探测策略（安全加固 · 避免向无关本地服务首发凭据）：
  //   1) 先【裸探】：200(JSON) 命中；**401 也是强特征**——OpenCode 鉴权失败会返回
  //      `WWW-Authenticate: Basic`（真机 F2 确证），此时才视为"疑似 OpenCode"；
  //   2) 仅在裸探确认疑似 OpenCode（200 或 401）后，才【带凭据】重探拿真实 payload。
  // 这样凭据只发给已确认/疑似 OpenCode 的端点，不会先发给 netstat 枚举出的任意端口。
  const probe = async (path) => {
    const doFetch = async (headers) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(`${key}${path}`, { headers, signal: ctrl.signal });
        clearTimeout(t);
        return res;
      } catch {
        return null;
      }
    };

    // 1) 裸探
    const naked = await doFetch({});
    if (naked && naked.status === HTTP_OK) {
      const raw = await naked.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* 非 JSON -> 非 API server（排除 SPA HTML 兜底，见 F1） */ }
      if (parsed && typeof parsed === 'object') return parsed;
      return null;
    }
    const looksLikeOpenCode = naked && (naked.status === HTTP_OK || naked.status === HTTP_UNAUTHORIZED);
    if (!looksLikeOpenCode || !auth) return null;

    // 2) 确认疑似 OpenCode 后，才带凭据重探
    const withAuth = await doFetch({ Authorization: auth });
    if (withAuth && withAuth.status === HTTP_OK) {
      const raw = await withAuth.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* 非 JSON */ }
      if (parsed && typeof parsed === 'object') return parsed;
    }
    return null;
  };

  // 先探 v2（/api/info 返回 ServerInfo），再探 v1（/global/health 返回 healthy/version）
  const info = await probe('/api/info');
  if (info && (info.version !== undefined || info.pid !== undefined || info.urls !== undefined)) {
    versionCache.set(key, OPENCODE_API_VERSION.V2);
    return OPENCODE_API_VERSION.V2;
  }
  const health = await probe('/global/health');
  if (health && (health.healthy !== undefined || health.version !== undefined)) {
    versionCache.set(key, OPENCODE_API_VERSION.V1);
    return OPENCODE_API_VERSION.V1;
  }
  return null;
}

/** 清空版本探测缓存（测试或 server 重启换版本时显式调用） */
export function clearApiVersionCache(baseUrl) {
  if (baseUrl) versionCache.delete(String(baseUrl).replace(/\/$/, ''));
  else versionCache.clear();
}

/** 解析 baseUrl 当前版本，探测失败时按 v1 兜底（保持既有行为）。 */
async function resolveVersion(baseUrl, timeoutMs = 3000) {
  const v = await detectApiVersion(baseUrl, timeoutMs);
  return v || OPENCODE_API_VERSION.V1;
}

/* ---------------------- V1 / V2 端点路径映射 ---------------------- */

function endpoints(version, sessionId) {
  const sid = sessionId ? encodeURIComponent(sessionId) : '';
  if (version === OPENCODE_API_VERSION.V2) {
    return {
      listSessions: '/api/session',
      session: `/api/session/${sid}`,
      messages: `/api/session/${sid}/message`,
      fork: `/api/session/${sid}/fork`,
      prompt: `/api/session/${sid}/prompt`,
      active: '/api/session/active'
    };
  }
  return {
    listSessions: '/session',
    session: `/session/${sid}`,
    messages: `/session/${sid}/message`,
    fork: `/session/${sid}/fork`,
    prompt: `/session/${sid}/prompt_async`,
    active: '/session/status'
  };
}

/** 统一解包响应信封：v2 返回 { data, cursor }，v1 返回裸值/数组 */
function unwrap(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

/** 提取响应信封的 cursor（v1 裸数组无 cursor，返回 null）。 */
function unwrapCursor(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.cursor) {
    return payload.cursor;
  }
  return null;
}

/* ---------------------- V2 消息分页常量 ---------------------- */
// 真机（F13）确证：`order` 与 `cursor` 不可组合（服务端 400 InvalidCursorError），
// 因此翻页必须「只带 cursor」，且翻页全程顺序恒为 desc（新→旧）。
// 真机（F17）确证：服务端 `limit` 上限为 **200**，>200 直接 400 InvalidRequestError。
// 故保守取 100（远离上限，兼容未来上限下调的版本）。
const MESSAGE_PAGE_LIMIT = 100;   // 单页拉取条数（保守值，避开真机 200 上限）
const MESSAGE_MAX_PAGES = 100;    // 页数硬上限，防 cursor 不推进导致死循环
const MESSAGE_MAX_ITEMS = 10000;  // 条数硬上限，防超大会话拖垮内存
const SESSION_PAGE_LIMIT = 100;   // 会话列表单页条数
const SESSION_MAX_PAGES = 20;     // 会话列表页数硬上限

/** 兼容解析会话更新时间戳（v2: time.updated / v1: time.updated 或驼峰） */
export function getSessionUpdatedTime(s) {
  if (!s) return 0;
  return Number(s.time?.updated ?? s.timeUpdated ?? s.time?.created ?? s.timeCreated ?? 0);
}

/** 兼容解析会话目录（v2: location.directory / v1: directory 或 path） */
export function getSessionDirectory(s) {
  if (!s) return '';
  return s.location?.directory || s.directory || s.path || '';
}

/** 归一化会话对象，屏蔽 v1/v2 字段差异，向上层提供稳定形状。 */
function normalizeSession(s) {
  if (!s || typeof s !== 'object') return s;
  return {
    ...s,
    directory: getSessionDirectory(s),
    timeUpdated: getSessionUpdatedTime(s),
    timeCreated: Number(s.time?.created ?? s.timeCreated ?? 0)
  };
}

/**
 * 归一化单条会话消息为 { role, text }：
 *   v1: entry.info.role + entry.parts[].{type:'text',text}
 *   v2: entry 为判别联合，entry.type ∈ {user, assistant, system, synthetic, ...}，
 *       user/system/synthetic 直接带 text；
 *       assistant 的文本在 entry.content[] 中按 type 过滤 text/reasoning。
 */
function normalizeMessage(entry) {
  if (!entry || typeof entry !== 'object') return null;

  // ---- v2 形状 ----
  const t = entry.type;
  if (t === 'assistant') {
    const content = Array.isArray(entry.content) ? entry.content : [];
    const texts = content
      .filter(c => (c?.type === 'text' || c?.type === 'reasoning') && typeof c?.text === 'string')
      .map(c => c.text);
    if (texts.length) return { role: 'assistant', text: texts.join('\n') };
    return null;
  }
  if (typeof t === 'string' && ['user', 'system', 'synthetic'].includes(t)) {
    return typeof entry.text === 'string' && entry.text
      ? { role: t === 'user' ? 'user' : 'system', text: entry.text }
      : null;
  }

  // ---- v1 形状 ----
  const role = entry?.info?.role || 'unknown';
  const parts = Array.isArray(entry?.parts) ? entry.parts : [];
  const texts = parts.filter(p => p?.type === 'text' && typeof p?.text === 'string').map(p => p.text);
  if (texts.length) return { role, text: texts.join('\n') };
  return null;
}

/**
 * 尝试探测某个 baseUrl 是否为可用的 opencode API server。
 * 兼容 V1（/global/health）与 V2（/api/info）两代端点；命中即返回版本号。
 * 返回 null 表示不可达/不是 opencode server。
 */
async function probeOpenCodeServer(baseUrl, timeoutMs = 3000) {
  const base = String(baseUrl).replace(/\/$/, '');
  const version = await detectApiVersion(base, timeoutMs);
  if (!version) return null;
  return { baseUrl: base, healthy: true, version };
}

function isWindows() {
  return os.platform() === 'win32';
}

/**
 * 策略 2：从运行中 opencode 进程的命令行解析 hostname/port。
 * 兼容进程名：opencode(.exe)，以及 OpenChamber 托管的 opencode-cli。
 */
function discoverFromProcessCommandLine() {
  const candidates = [];
  try {
    let lines;
    if (isWindows()) {
      const wmic = execFileSync('wmic', ['process', 'get', 'ProcessId,CommandLine'], {
        encoding: 'utf8', windowsHide: true, timeout: 10000
      });
      lines = wmic.split(/\r?\n/);
    } else {
      const ps = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8', timeout: 10000 });
      lines = ps.split(/\r?\n/);
    }

    for (const line of lines) {
      if (!/opencode/i.test(line)) continue;
      if (!/serve|tui|cli/i.test(line)) continue;
      const portMatch = line.match(/(?:^|\s)--port\s+(\d+)/);
      const hostMatch = line.match(/(?:^|\s)--hostname\s+([^\s]+)/);
      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        const host = hostMatch ? hostMatch[1].replace(/^\[|\]$/g, '') : '127.0.0.1';
        candidates.push({ host, port });
      }
    }
  } catch {
    return [];
  }
  return candidates;
}

/**
 * 策略 3：netstat 枚举监听中的 TCP 端口（默认全端口），交由 health 探测过滤。
 * 在 Windows 上也可通过 -ano 关联到 opencode 进程；这里返回全部监听端口，
 * 由上层逐端口 health 探测甄别。
 */
function enumerateListeningPorts() {
  const ports = new Set();
  try {
    let output;
    if (isWindows()) {
      output = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    } else {
      output = execFileSync('netstat', ['-tln'], { encoding: 'utf8', timeout: 10000 });
    }
    for (const rawLine of output.split(/\r?\n/)) {
      // 匹配形如 "TCP    127.0.0.1:57407 ... LISTENING" 的监听行
      const m = rawLine.match(/TCP\s+\S+:(\d+)\s+\S+:.*?\s+(?:LISTENING|LISTEN)/i);
      if (m) {
        const p = parseInt(m[1], 10);
        if (p > 0 && p < 65536) ports.add(p);
      }
    }
  } catch {
    return [];
  }
  return Array.from(ports);
}

const DEFAULT_PRIORITY_PORTS = [4096, 4097, 4098, 4100, 8080, 3000];
const FALLBACK_SCAN_MAX = 16;

/**
 * 主入口：动态发现可用的 opencode server baseUrl。
 * @param {Object} opts { explicitBaseUrl, timeoutMs, allowBroadScan }
 * @returns {Promise<string|null>} baseUrl，找不到返回 null
 */
export async function discoverOpenCodeServer(opts = {}) {
  const timeoutMs = opts.timeoutMs || 3000;
  const candidates = [];

  // 策略 1：显式 baseUrl。用户/配置显式指定时语义要严格——只探该地址，
  // 探不到即失败，不擅自 fallback 去发现别的 server（避免连错实例）。
  const explicit = opts.explicitBaseUrl || process.env.MEMHUB_OPENCODE_URL;
  if (explicit) {
    return (await probeOpenCodeServer(explicit.replace(/\/$/, ''), timeoutMs))?.baseUrl || null;
  }

  // 策略 2：进程命令行（带端口的最可靠）
  for (const { host, port } of discoverFromProcessCommandLine()) {
    const url = `http://${host}:${port}`;
    const hit = await probeOpenCodeServer(url, timeoutMs);
    if (hit) return hit.baseUrl;
    candidates.push(port);
  }

  // 策略 3 + 4：优先默认端口，再用 netstat 枚举监听端口逐探
  const scanPorts = new Set([
    ...DEFAULT_PRIORITY_PORTS,
    ...enumerateListeningPorts(),
    ...candidates
  ]);
  const checked = new Set();
  for (const port of scanPorts) {
    if (checked.has(port)) continue;
    checked.add(port);
    const url = `http://127.0.0.1:${port}`;
    const hit = await probeOpenCodeServer(url, timeoutMs);
    if (hit) return hit.baseUrl;
  }

  // 策略 5：兜底一段常用端口（避免 netstat 未生效时漏检）
  if (opts.allowBroadScan !== false) {
    for (let i = 0; i < FALLBACK_SCAN_MAX; i++) {
      const port = DEFAULT_PRIORITY_PORTS[0] + 1 + i;
      if (checked.has(port)) continue;
      checked.add(port);
      const url = `http://127.0.0.1:${port}`;
      const hit = await probeOpenCodeServer(url, timeoutMs);
      if (hit) return hit.baseUrl;
    }
  }

  return null;
}

/**
 * 拉取会话的全部原始消息条目（不做归一化），供上层按需解析。
 *
 * 【版本分流——真机 F13 确证的硬契约】
 *   - V1：`/session/:id/message` 返回**裸数组**，无分页概念（无 cursor 字段）。
 *         一次性读取，不传 limit/order（V1 是否理解这些 query 参数未验证，传了反而有风险）。
 *   - V2：`/api/session/:id/message` 返回 `{ data, cursor }` 信封，**默认仅 50 条且默认 desc**；
 *         必须显式翻页才能拿全。可用 `cursor.next` 循环翻页（`cursor.previous` 反向）。
 *
 * 【关键约束：order 与 cursor 互斥】
 *   真机（F13）实测 `?order=asc&cursor=xxx` → 400 `InvalidCursorError`。
 *   故 V2 翻页**只能只带 cursor、绝不同时带 order**，且翻页全程顺序为 **desc（新→旧）**。
 *   需要「最新一条」的调用方应取返回数组的首元素（desc 语义），而非末元素。
 *
 * @returns {Promise<Array<Object>>} 原始消息条目数组（V2 为 desc 顺序，即首元素最新）
 */
async function readAllMessages(baseUrl, sessionId, opts = {}) {
  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version, sessionId);
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;
  const timeoutMs = opts.timeoutMs || 8000;

  // ---- V1：裸数组，一次性读取（保持既有行为） ----
  if (version !== OPENCODE_API_VERSION.V2) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${ep.messages}`, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`读取会话消息失败 HTTP ${res.status}`);
      const payload = unwrap(await res.json());
      return Array.isArray(payload) ? payload : [];
    } finally {
      clearTimeout(t);
    }
  }

  // ---- V2：cursor 驱动的翻页（只带 cursor，不带 order） ----
  const all = [];
  let cursor = null;
  let pages = 0;
  // 真机 F17：limit 超服务端上限会 400。此处**循环降级**直至下限（1）：
  // 单次降级不足以覆盖「服务端上限很低」的版本，必须能一路降到 1 才可靠。
  let pageLimit = opts.pageLimit || MESSAGE_PAGE_LIMIT;
  const minLimit = opts.minPageLimit || 1;
  do {
    const qs = new URLSearchParams();
    qs.set('limit', String(pageLimit));
    if (cursor) qs.set('cursor', cursor);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, json;
    try {
      res = await fetch(`${baseUrl}${ep.messages}?${qs.toString()}`, { headers, signal: ctrl.signal });
      clearTimeout(t);
      // 400（如 limit 超上限 InvalidRequestError）→ 继续降半重试（同一 cursor 页）
      if (res.status === 400 && pageLimit > minLimit) {
        pageLimit = Math.max(minLimit, Math.floor(pageLimit / 2));
        continue;
      }
      if (!res.ok) throw new Error(`读取会话消息失败 HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(t);
    }
    const page = unwrap(json);
    if (Array.isArray(page)) all.push(...page);
    pages++;
    const next = unwrapCursor(json)?.next || null;
    // 防死循环：cursor 不推进 或 达页数/条数上限即止
    if (!next || next === cursor) break;
    if (pages >= (opts.maxPages || MESSAGE_MAX_PAGES)) break;
    if (all.length >= (opts.maxItems || MESSAGE_MAX_ITEMS)) break;
    cursor = next;
  } while (true);
  return all;
}

/**
 * 读取指定会话的文本消息列表（用于宿主 LLM 或后台分析）。
 * @param {string} baseUrl
 * @param {string} sessionId
 * @returns {Promise<Array<{role:string,text:string}>>}
 */
export async function readSessionMessages(baseUrl, sessionId, timeoutMs = 8000) {
  const entries = await readAllMessages(baseUrl, sessionId, { timeoutMs });
  const msgs = [];
  for (const entry of entries) {
    const m = normalizeMessage(entry);
    if (m) msgs.push(m);
  }
  return msgs;
}

/* 已知子代理（subagent）角色黑名单：仅拦截这些，未知 agent 默认放行，
   避免白名单式（非 build 即拦截）误杀 plan 等新主模式。来源：opencode 内置子代理。 */
const SUBAGENT_AGENTS = new Set(['review', 'explore', 'general', 'image-reader', 'subagent']);

/**
 * 统一 Subagent 判定门禁：识别并排除所有子任务与委派智能体
 * 判定依据（按可靠性降序）：
 * 1. 结构标记：parentID / parent_id 存在即代表子会话；
 * 2. **权威标记：session.fork.sessionID 存在即代表 fork 抽取副本**（真机 F14 确证
 *    `GET /api/session` 列表元素携带 fork 字段；比标题正则权威）；
 * 3. 角色特征：agent 命中已知子代理黑名单；
 * 4. 标题特征：包含 subagent、sub-agent 或 @review 等标记，或以 "(fork #N)" 结尾。
 */
export function isSubagentSession(session) {
  if (!session || typeof session !== 'object') return false;

  // 1. 父会话 ID 检查 (同时兼容 HTTP API 的 parentID 与 SQLite 的 parent_id)
  if (session.parentID || session.parent_id || session.parentId) {
    return true;
  }

  // 2. 权威 fork 标记（HTTP 路径有；DB 路径无此字段，仍靠下方标题兜底）
  if (session.fork && session.fork.sessionID) {
    return true;
  }

  // 3. 已知子智能体角色黑名单（未知 agent 默认放行，避免误杀新主模式）
  const agent = String(session.agent || '').toLowerCase().trim();
  if (agent && SUBAGENT_AGENTS.has(agent)) {
    return true;
  }

  // 4. 标题特征模式检查
  const title = String(session.title || '').toLowerCase();
  if (
    title.includes('subagent') ||
    title.includes('sub-agent') ||
    title.includes('(@review') ||
    title.includes('(@explore') ||
    title.includes('(@general')
  ) {
    return true;
  }

  // 5. 记忆抽取 fork 会话拦截：daemon 派发的 fork 会继承原目录且无 parentID，
  //    仅靠 parentID 无法识别，必须用标题后缀 "(fork #N)" 特征拦截，杜绝套娃循环抽取。
  if (/\(fork #\d+\)$/i.test(title)) {
    return true;
  }

  return false;
}

/**
 * 拉取会话列表（V1 裸数组一次性读取；V2 cursor 翻页拿全）。
 * @returns {Promise<Array<Object>>} 原始会话条目数组
 */
async function listAllSessions(baseUrl, ep, headers, version, timeoutMs = 8000) {
  // V1：裸数组，一次性读取
  if (version !== OPENCODE_API_VERSION.V2) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${ep.listSessions}`, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`列出会话失败 HTTP ${res.status}`);
      const payload = unwrap(await res.json());
      return Array.isArray(payload) ? payload : [];
    } finally {
      clearTimeout(t);
    }
  }

  // V2：cursor 翻页（只带 cursor，不带 order）；limit 超上限时循环降级（同消息接口）
  const all = [];
  let cursor = null;
  let pages = 0;
  let pageLimit = SESSION_PAGE_LIMIT;
  do {
    const qs = new URLSearchParams();
    qs.set('limit', String(pageLimit));
    if (cursor) qs.set('cursor', cursor);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let json;
    try {
      const res = await fetch(`${baseUrl}${ep.listSessions}?${qs.toString()}`, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 400 && pageLimit > 1) {
        pageLimit = Math.max(1, Math.floor(pageLimit / 2));
        continue;
      }
      if (!res.ok) throw new Error(`列出会话失败 HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(t);
    }
    const page = unwrap(json);
    if (Array.isArray(page)) all.push(...page);
    pages++;
    const next = unwrapCursor(json)?.next || null;
    if (!next || next === cursor) break;
    if (pages >= SESSION_MAX_PAGES) break;
    cursor = next;
  } while (true);
  return all;
}

/**
 * 从 OpenCode 宿主筛选符合定时抽取条件的候选历史会话。
 *
 * 过滤门禁（严格遵守系统规约）：
 *  1. 窗口过滤：更新时间在最近 windowDays 天内（默认 7 天）；
 *  2. 静默过滤：更新时间距现在超过 idleMinutes 分钟（默认 120 分钟），说明已结束交互进入冷态；
 *  3. 防重过滤：session_id 不在 excludeIds（已处理/已跳过）集合中；
 *  4. 运行态过滤：排除当前正在 running 的会话，避免打扰；
 *  5. Subagent 门禁：排除所有 parentID 存在、子智能体角色或带 subagent 标题的派生会话。
 *
 * @param {string} baseUrl
 * @param {Object} opts { windowDays, idleMinutes, excludeIds, limit }
 * @returns {Promise<Array<Object>>}
 */
export async function listCandidateSessions(baseUrl, opts = {}) {
  const windowDays = opts.windowDays ?? 7;
  const idleMinutes = opts.idleMinutes ?? 120;
  const excludeIds = opts.excludeIds || new Set();
  const limit = opts.limit || 5;

  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;

  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version);

  // 拉取会话列表。V2 为 { data, cursor } 信封且默认仅返回较新的 50 条，需翻页拿全；
  // V1 为裸数组，一次性读取。翻页仅带 cursor（不带 order，真机 F13 证二者互斥）。
  const sessions = await listAllSessions(baseUrl, ep, headers, version);

  const list = (Array.isArray(sessions) ? sessions : []).map(normalizeSession);
  const now = Date.now();
  const maxAgeMs = windowDays * 24 * 3600 * 1000;
  const minIdleMs = idleMinutes * 60 * 1000;
  const filter = opts.scanRules ? new PathFilter(opts.scanRules) : null;

  const candidates = [];
  for (const s of list) {
    if (!s || !s.id) continue;
    if (excludeIds.has(s.id)) continue;
    if (s.status === 'running') continue;

    // 核心门禁：坚决排除 Subagent 派生会话 (parentID / 子智能体 / 标题标记)
    if (isSubagentSession(s)) continue;

    // 路径 include / exclude 规则过滤
    const targetDir = getSessionDirectory(s);
    if (filter && targetDir && !filter.isAllowed(targetDir)) continue;

    const updated = getSessionUpdatedTime(s);
    if (!updated) continue;

    const age = now - updated;
    // 窗口校验：必须在最近 windowDays 天内
    if (age > maxAgeMs) continue;
    // 静默校验：必须距今至少 idleMinutes 分钟
    if (age < minIdleMs) continue;

    candidates.push({
      id: s.id,
      title: s.title || '',
      directory: getSessionDirectory(s),
      timeUpdated: updated,
      timeCreated: Number(s.time?.created ?? s.timeCreated ?? 0)
    });
  }

  // 按更新时间降序排，优先处理较新的会话
  candidates.sort((a, b) => b.timeUpdated - a.timeUpdated);
  return candidates.slice(0, limit);
}

/**
 * 挑选当前可注入的单个候选 idle 会话（向后兼容保留）。
 * @param {string} baseUrl
 * @param {Object} opts
 * @returns {Promise<Object|null>}
 */
export async function pickIdleSession(baseUrl, opts = {}) {
  const list = await listCandidateSessions(baseUrl, { ...opts, limit: 1 });
  return list.length > 0 ? list[0] : null;
}

import { buildExtractionPrompt } from '../prompt-template.js';
export { buildExtractionPrompt };

/**
 * 在指定目录下发起 fork，复制原会话上下文用于离线抽取。
 *
 * 说明：OpenCode 的 /session/:id/fork 会复制原会话历史（保留前缀 prompt cache），
 * 但其 directory 始终继承原会话，无法重定向到别的目录（API 限制）。fork 出的
 * 会话无 parentID，只能靠标题后缀 "(fork #N)" 识别，故需配合 isSubagentSession 拦截。
 *
 * @param {string} baseUrl
 * @param {string} sessionId 原会话 id
 * @param {Object} opts { messageID?, timeoutMs? }
 * @returns {Promise<Object>} fork 出的新会话对象（含 id/directory/title）
 */
export async function forkSession(baseUrl, sessionId, opts = {}) {
  if (!sessionId) throw new Error('forkSession: 缺少必须的 sessionId');
  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version, sessionId);
  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  // v2 用 before（msg_ 前缀）指定 fork 边界；v1 用 messageID。语义等价映射。
  const body = {};
  if (opts.messageID) {
    if (version === OPENCODE_API_VERSION.V2) body.before = opts.messageID;
    else body.messageID = opts.messageID;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(`${baseUrl}${ep.fork}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`fork 会话失败 HTTP ${res.status}`);
    return normalizeSession(unwrap(await res.json()));
  } finally {
    clearTimeout(t);
  }
}

/**
 * 对 fork 副本的当前消息 ID 做快照，作为「本次抽取新增消息」的基线。
 *
 * 【为什么需要（真机 F16 二次修正）】
 *   fork 副本会继承源会话历史（含 idle），且其消息 ID 被重写、boundary 不在副本中。
 *   故 fork 后先快照现有消息 ID，之后 `getLastAssistantProgress` / `waitForSessionIdle`
 *   只认可**不在快照中**的新增消息，即可隔离继承的历史 idle。
 *
 * 【关键：必须「等消息集稳定」而非固定等待（真机 F16-b/F18）】
 *   真机实测：副本历史复制**非同步完成**（约 6s 才稳定，且存在 20s 内 0 条的极端案例）。
 *   若用固定短等待（如 1.5s）快照，则复制在窗口之后插入的**继承消息**会被误当「新增」，
 * 【关键：必须「最小沉淀时长 + 消息集稳定」双保险（真机 F16-b/F18 + 复审实测）】
 *   真机实测：副本历史复制**非同步完成**（约 6s 才稳定，存在 20s 内 0 条的极端案例）。
 *   复审实测进一步证明：**单纯「连续两次一致」在复制长停顿时会误判稳定**
 *   （停顿 1800/3000/5000ms 均会漏掉随后插入的历史 idle，且**停顿越长越必然误判**）。
 *   故必须叠加**最小沉淀时长 `minSettleMs`（默认 6000ms，源自真机 6s 观察）**，
 *   在沉淀期结束前**绝不返回快照**，沉淀期后再要求消息集稳定。
 *
 * @param {string} baseUrl
 * @param {string} sessionId fork 副本 id
 * @param {Object} opts { timeoutMs?, maxWaitMs?, pollIntervalMs?, minSettleMs? }
 * @returns {Promise<Set<string>>} 消息 ID 快照集合
 */
export async function snapshotForkBaseline(baseUrl, sessionId, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const maxWaitMs = opts.maxWaitMs || 20000;      // 稳定等待上限
  const pollIntervalMs = opts.pollIntervalMs || 1500;
  // 最小沉淀时长：源自真机「复制约 6s 稳定」观察 + 复审实测「长停顿会误判稳定」。
  // 沉淀期内无论消息集是否"看起来稳定"，都不得返回快照。
  const minSettleMs = opts.minSettleMs ?? 6000;
  const start = Date.now();

  const snapshot = async () => {
    const entries = await readAllMessages(baseUrl, sessionId, { timeoutMs });
    const ids = new Set();
    for (const e of entries) {
      if (e && e.id) ids.add(e.id);
    }
    return ids;
  };
  const sameSet = (a, b) => {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  };

  let prev = await snapshot();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const cur = await snapshot();
    const settled = Date.now() - start >= minSettleMs;
    // 双保险：① 已过最小沉淀期；② 消息集连续两次一致。二者同时满足才返回。
    if (settled && sameSet(prev, cur)) return cur;
    prev = cur;
  }
  // 超时仍未观测到稳定：**抛错**而非返回残缺快照——残缺快照会把继承消息误当「新增」，
  // 正是 F16 要防的误判。抛错由 daemon 捕获后按「无基线」处理（保守：宁可超时也不误判完成）。
  throw new Error(`snapshotForkBaseline 超时未能确认副本消息稳定（sessionId=${sessionId}）`);
}

/**
 * 读取单个会话的运行态（idle / busy / retry）。
 *
 * 【关键语义修正——真机 F10/F11 确证】
 *   V2 的 `/api/session/active` **只返回 running 会话集合**，其语义是「当前是否有活跃任务」，
 *   **不代表会话是否存在或已完成**。真机实测：刚 fork 出的空副本**不在** active 集合中，
 *   若据此判定为 'idle'，会导致 `waitForSessionIdle` 秒短路（1015ms 就判完成）→ fork 被删
 *   → 抽取 100% 丢失。故 V2 下「不在 active 集合」必须返回 **'unknown'**（与 V1 语义对齐），
 *   完成判定改由 `type:'idle'` 消息承担（见 getLastAssistantProgress / waitForSessionIdle）。
 *
 * @returns {Promise<string>} 'idle' | 'busy' | 'retry' | 'running' | 'unknown'
 */
export async function getSessionStatus(baseUrl, sessionId, timeoutMs = 8000) {
  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version);
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${ep.active}`, { headers, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`读取会话状态失败 HTTP ${res.status}`);
    const payload = unwrap(await res.json());

    if (version === OPENCODE_API_VERSION.V2) {
      // v2 /api/session/active 只返回 running 会话集合。
      // 在集合中 -> running（有活跃任务）；不在集合中 -> unknown（**不可判 idle**，见上文说明）。
      if (payload && typeof payload === 'object' && payload[sessionId]) {
        const t = payload[sessionId]?.type;
        return typeof t === 'string' ? t : 'running';
      }
      return 'unknown';
    }
    // v1 /session/status 返回 { [sessionId]: { type } }
    const st = payload?.[sessionId];
    if (!st) return 'unknown';
    return st.type || 'unknown';
  } finally {
    clearTimeout(t);
  }
}

/**
 * 读取会话的完成状况。返回结构化三态，供上层区分「成功 / 失败 / 未完成」。
 *
 * 【完成判定设计——真机 F4/F12 确证】
 *   V2 宿主在任务结束后会写入一条 `type:'idle'` 消息，携带 `outcome`
 *   （OpenAPI: enum = succeeded | failed | interrupted）。这是**权威完成信号**，
 *   比 `/api/session/active`（只表示"有无活跃任务"，真机 F10/F11 已证其不可用于完成判定）
 *   和 `time.streamed`（语义可疑，已移除 OR 判定）都可靠。
 *
 * 【关键：fork 副本继承历史 idle（真机 F16）】
 *   真机实测：fork 出的副本**继承源会话全部历史消息**（含多条 `idle`+`succeeded`）。
 *   若直接取「末条 idle」，会把**继承来的历史 idle** 误当本次抽取的完成信号 →
 *   刚 fork 就秒判完成 → 仍然丢数据。
 *
 * 【锚点选择：为什么用「ID 快照集合」而非 boundary messageID（真机 F16 二次修正）】
 *   真机实测：fork 副本的消息 **ID 被整体重写**（如 `..._1416` 后缀），且**只保留最近 100 条**，
 *   而 `fork.boundary.messageID`（fork 点）**不在副本中**（超出保留范围）。
 *   故「按 boundary messageID 定位」在真机不可行。
 *   改用 **「fork 后对副本消息 ID 快照，只认不在快照中的消息」**——真机已验证：
 *   副本复制约 6s 后稳定，快照后新增的 idle 正是本次抽取完成信号。
 *
 * 【判定优先级】
 *   1. baseline 之外（即本次新增）存在 `type:'idle'` 消息：succeeded -> completed=true；
 *      failed/interrupted -> completed=false（status='failed'，上层置 FAILED）；
 *   2. 无 idle 时，回退看 baseline 之外末条 assistant 是否 `time.completed` 且 content 非空；
 *   3. 均无 -> 未完成。
 *
 * @param {Object} [opts] { baselineIds?: Set<string>|string[] } fork 后快照的消息 ID 集合
 *                       （只认可不在该集合中的新增消息）
 * @returns {Promise<{hasReply:boolean, completed:boolean, partsCount:number,
 *                    outcome:string|null, status:'success'|'failed'|'incomplete'}>}
 */
export async function getLastAssistantProgress(baseUrl, sessionId, timeoutMs = 8000, opts = {}) {
  const version = await resolveVersion(baseUrl);
  const arr = await readAllMessages(baseUrl, sessionId, { timeoutMs });
  const isV2 = version === OPENCODE_API_VERSION.V2;

  // 解析单条条目：返回 { kind:'idle'|'assistant'|null, outcome?, contentLen }
  const parse = (entry) => {
    if (!entry || typeof entry !== 'object') return { kind: null };
    // v2 typed message
    if (entry.type === 'idle') return { kind: 'idle', outcome: entry.outcome ?? null };
    if (entry.type === 'assistant') {
      const content = Array.isArray(entry.content) ? entry.content : [];
      return { kind: 'assistant', contentLen: content.length, completedFlag: !!entry.time?.completed };
    }
    // v1 形状
    const info = entry.info;
    if (info?.role === 'assistant') {
      const parts = Array.isArray(entry.parts) ? entry.parts : [];
      return { kind: 'assistant', contentLen: parts.length, completedFlag: !!info.time?.completed };
    }
    return { kind: null };
  };

  // 统一按「时间升序」处理：V2 为 desc -> 反转；V1 本身为 asc。
  const ordered = isV2 ? [...arr].reverse() : arr;

  // 【F16 修复】若给了 fork 后的消息 ID 快照，只保留**不在快照中**的新增消息，
  // 从而隔离 fork 继承的历史 idle（真机验证：副本消息 ID 会重写且 boundary 不在副本中，
  // 故只能用 ID 集合差集，不能用 boundary messageID 定位）。
  let scoped = ordered;
  const baselineIds = opts.baselineIds;
  if (baselineIds) {
    const set = baselineIds instanceof Set ? baselineIds : new Set(baselineIds);
    scoped = ordered.filter(e => e && e.id && !set.has(e.id));
  }

  let lastAssistant = null;   // 最后一条 assistant 的解析结果
  let lastIdle = null;        // 最后一条 idle 的解析结果
  for (const entry of scoped) {
    const p = parse(entry);
    if (p.kind === 'assistant') lastAssistant = p;
    else if (p.kind === 'idle') lastIdle = p;
  }

  // 信号 1（权威）：末条 idle 消息
  if (lastIdle) {
    const outcome = lastIdle.outcome;
    const succeeded = outcome === 'succeeded';
    return {
      hasReply: !!lastAssistant,
      completed: succeeded,
      partsCount: lastAssistant?.contentLen || 0,
      outcome: outcome ?? null,
      status: succeeded ? 'success' : 'failed'
    };
  }

  // 信号 2（回退）：末条 assistant 已完成且内容非空。仅用 completed，不再 OR streamed。
  if (lastAssistant && lastAssistant.completedFlag && lastAssistant.contentLen > 0) {
    return {
      hasReply: true,
      completed: true,
      partsCount: lastAssistant.contentLen,
      outcome: null,
      status: 'success'
    };
  }

  return {
    hasReply: !!lastAssistant,
    completed: false,
    partsCount: lastAssistant?.contentLen || 0,
    outcome: null,
    status: 'incomplete'
  };
}

/**
 * 轮询等待 fork 会话抽取完成。
 *
 * 判定策略（按版本分流——真机 F10/F11 确证的修复）：
 *   - **V1**：宿主 `/session/status` 会维护 fork 副本状态，`status==='idle'` 是有效快速信号，
 *     保留短路；同时保留消息完成度作双保险。
 *   - **V2**：`/api/session/active` 只表示「有无活跃任务」，**不能**用于判完成（空 fork 也会立即
 *     被判 idle → 秒短路丢数据）。故 V2 下**不再以 status 短路**，改由消息层的
 *     `type:'idle'` 消息（+ outcome）或 assistant 完成度判定。
 *
 * @param {Object} opts { pollIntervalMs=3000, maxWaitMs=300000, onWait?, baselineIds? }
 *   - baselineIds: fork 后对副本消息 ID 的快照集合（真机 F16）。传入后只考量
 *     **不在该集合中**的新增消息，避免把 fork 副本**继承的历史 idle** 误当完成信号。
 * @returns {Promise<{completed:boolean, waitedMs:number, finalStatus:string,
 *                    outcome:string|null, status:'success'|'failed'|'incomplete'|'timeout', sawReply:boolean}>}
 *   - completed=true 表示「抽取成功完成」（succeeded）；
 *   - completed=false 且 status='failed' 表示「已结束但失败/中断」（不得当作抽取成功）；
 *   - completed=false 且 status='timeout' 表示「超时未完成」（上层应可重试）。
 */
export async function waitForSessionIdle(baseUrl, sessionId, opts = {}) {
  const pollIntervalMs = opts.pollIntervalMs || 3000;
  const maxWaitMs = opts.maxWaitMs || 300000;
  const version = await resolveVersion(baseUrl);
  const isV2 = version === OPENCODE_API_VERSION.V2;
  const start = Date.now();
  let lastStatus = 'unknown';
  let sawReply = false;
  const progOpts = { baselineIds: opts.baselineIds };

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const waitedMs = Date.now() - start;

    // 信号 1：宿主状态。V1 下 status==='idle' 是可靠完成信号（保留短路）；
    // V2 下 status 只反映「有无活跃任务」，**不可**据此判完成（空 fork 会秒短路 → 丢数据）。
    let status = 'unknown';
    try {
      status = await getSessionStatus(baseUrl, sessionId);
    } catch {
      status = 'unknown';
    }
    lastStatus = status;
    if (!isV2 && status === 'idle') {
      return { completed: true, waitedMs, finalStatus: 'idle', outcome: null, status: 'success', sawReply };
    }

    // 信号 2：消息层完成判定（V2 主路径：type:'idle' 消息 + outcome；V1 双保险：assistant completed）
    try {
      const prog = await getLastAssistantProgress(baseUrl, sessionId, undefined, progOpts);
      if (prog.hasReply) sawReply = true;

      // 已结束但失败/中断：立即返回，交上层置 FAILED（不得当成功）
      if (prog.outcome === 'failed' || prog.outcome === 'interrupted') {
        return {
          completed: false, waitedMs, finalStatus: 'idle-message', outcome: prog.outcome,
          status: 'failed', sawReply
        };
      }

      if (prog.completed && prog.partsCount > 0) {
        // 二次确认：间隔一个周期后仍未变化，避免"part 刚写入"的中间态误判
        await new Promise(r => setTimeout(r, Math.min(pollIntervalMs, 1500)));
        const confirm = await getLastAssistantProgress(baseUrl, sessionId, undefined, progOpts);
        if (confirm.completed && confirm.partsCount > 0) {
          return {
            completed: true, waitedMs: Date.now() - start, finalStatus: 'completed',
            outcome: confirm.outcome ?? null, status: 'success', sawReply
          };
        }
      }
    } catch {
      // 消息读取失败不致命，继续等待
    }

    if (typeof opts.onWait === 'function') {
      try { opts.onWait(status, waitedMs); } catch {}
    }
  }

  // 超时兜底：明确标记为 timeout（非成功），上层据此置 FAILED 并可重试，杜绝静默腰斩。
  return { completed: false, waitedMs: Date.now() - start, finalStatus: lastStatus, outcome: null, status: 'timeout', sawReply };
}

/**
 * 删除会话（fork 抽取完成后必须调用，避免用户在会话列表中看到残留与再次被扫描）。
 * @returns {Promise<boolean>}
 */
export async function deleteSession(baseUrl, sessionId, timeoutMs = 8000) {
  if (!sessionId) return false;
  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version, sessionId);
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${ep.session}`, {
      method: 'DELETE',
      headers,
      signal: ctrl.signal
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 将沉淀指令注入目标会话，驱动宿主 LLM 执行抽取。
 * @param {string} baseUrl
 * @param {Object} opts { sessionId, originSessionId?, dryRun, timeoutMs }
 *   - sessionId: 实际接收 prompt 的会话（fork 场景下为 fork 出的副本）
 *   - originSessionId: 抽取结果归属的原会话 id，写入 memhub_save 的 session_id；
 *     缺省时回退为 sessionId（不 fork 的向后兼容场景）
 * @returns {Promise<{dryRun:boolean,url:string,prompt:string,posted?:boolean,httpStatus?:number}>}
 */
export async function dispatchExtractionPrompt(baseUrl, opts = {}) {
  const sessionId = opts.sessionId;
  if (!sessionId) throw new Error('dispatchExtractionPrompt: 缺少必须的 sessionId');
  const dryRun = opts.dryRun === true;
  const prompt = buildExtractionPrompt({ 
    targetSessionId: opts.originSessionId || sessionId,
    projectName: opts.projectName
  });

  // dry-run 是纯桩：绝不发起任何网络请求（含版本探测），故先按缓存/配置推断版本，
  // 不做主动探测。已探测过则用缓存版本，保证 URL 展示准确。
  if (dryRun) {
    const cached = versionCache.get(String(baseUrl).replace(/\/$/, ''));
    const ep = endpoints(cached || OPENCODE_API_VERSION.V1, sessionId);
    return { dryRun, url: `${baseUrl}${ep.prompt}`, prompt };
  }

  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version, sessionId);

  const payload = {
    dryRun,
    url: `${baseUrl}${ep.prompt}`,
    prompt
  };

  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  // v2 prompt 合并了异步语义（返回 Inbox User 项且不阻塞），body 为扁平 { text }；
  // v1 使用 prompt_async，body 为 { noReply, parts:[{type:'text',text}] }。
  const body = version === OPENCODE_API_VERSION.V2
    ? { text: prompt }
    : { noReply: false, parts: [{ type: 'text', text: prompt }] };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
  try {
    const res = await fetch(payload.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    payload.posted = res.ok;
    payload.httpStatus = res.status;
    return payload;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 创建全新的独立临时会话（如用于 AI 做梦反思任务）。
 * @param {string} baseUrl
 * @param {Object} opts { title, directory, timeoutMs }
 * @returns {Promise<Object>} 创建的会话对象 (含 id, title, directory)
 */
export async function createSession(baseUrl, opts = {}) {
  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version);
  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  const directory = opts.directory || process.cwd();
  // v2 将目录收进 location:{directory}；v1 使用顶层 directory。
  const body = version === OPENCODE_API_VERSION.V2
    ? { title: opts.title || 'MemHub Task', location: { directory } }
    : { title: opts.title || 'MemHub Task', directory };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
  try {
    const res = await fetch(`${baseUrl}${ep.listSessions}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`创建独立会话失败 HTTP ${res.status}`);
    return normalizeSession(unwrap(await res.json()));
  } finally {
    clearTimeout(t);
  }
}

/**
 * 向指定会话派发通用提示词。
 * @param {string} baseUrl
 * @param {string} sessionId
 * @param {string} promptText
 * @param {Object} opts { timeoutMs }
 * @returns {Promise<{ok:boolean, status:number}>}
 */
export async function dispatchSessionPrompt(baseUrl, sessionId, promptText, opts = {}) {
  if (!sessionId) throw new Error('dispatchSessionPrompt: 缺少必须的 sessionId');
  const version = await resolveVersion(baseUrl);
  const ep = endpoints(version, sessionId);
  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  const body = version === OPENCODE_API_VERSION.V2
    ? { text: promptText }
    : { noReply: false, parts: [{ type: 'text', text: promptText }] };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(`${baseUrl}${ep.prompt}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`向会话派发提示词失败 HTTP ${res.status}`);
    return { ok: true, status: res.status };
  } finally {
    clearTimeout(t);
  }
}
