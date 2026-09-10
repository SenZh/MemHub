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

/**
 * 尝试探测某个 baseUrl 是否为可用的 opencode API server。
 * 兼容鉴权与无鉴权两种模式：无密码时直接探；有密码时先带 Authorization 探。
 * 返回 null 表示不可达/不是 opencode server。
 */
async function probeOpenCodeServer(baseUrl, timeoutMs = 3000) {
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;

  for (const withAuth of [true, false]) {
    const h = withAuth && auth ? { ...headers } : {};
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`${baseUrl}/global/health`, { headers: h, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === HTTP_OK) {
        const raw = await res.text();
        // 严格校验：opencode health 端点应返回 JSON 且含 healthy/version 字段，
        // 排除 SPA 前端资源对 /global/health 的 HTML 兜底误判。
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { /* 非 JSON 则非 opencode API server */ }
        if (parsed && (parsed.healthy !== undefined || parsed.version !== undefined)) {
          return { baseUrl, healthy: true, body: raw };
        }
        continue; // 200 但非 opencode health JSON -> 继续下一策略
      }
      if (res.status === HTTP_UNAUTHORIZED && !withAuth) continue;
    } catch {
      // 不可达，继续下一轮
    }
  }
  return null;
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
 * 读取指定会话的文本消息列表（用于宿主 LLM 或后台分析）。
 * @param {string} baseUrl
 * @param {string} sessionId
 * @returns {Promise<Array<{role:string,text:string}>>}
 */
export async function readSessionMessages(baseUrl, sessionId, timeoutMs = 8000) {
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {
      headers, signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`读取会话消息失败 HTTP ${res.status}`);
    const arr = await res.json();
    const msgs = [];
    for (const entry of Array.isArray(arr) ? arr : []) {
      const role = entry?.info?.role || 'unknown';
      const parts = Array.isArray(entry?.parts) ? entry.parts : [];
      const texts = parts.filter(p => p?.type === 'text' && typeof p?.text === 'string').map(p => p.text);
      if (texts.length) msgs.push({ role, text: texts.join('\n') });
    }
    return msgs;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 安全解析会话更新时间戳（兼容 OpenCode 原生 time.updated 与驼峰 timeUpdated）
 */
export function getSessionUpdatedTime(s) {
  if (!s) return 0;
  return Number(s.time?.updated ?? s.timeUpdated ?? s.time?.created ?? s.timeCreated ?? 0);
}

/**
 * 统一 Subagent 判定门禁：识别并排除所有子任务与委派智能体
 * 判定依据：
 * 1. 结构标记：parentID / parent_id 存在即代表子会话；
 * 2. 角色特征：agent 属于 review / explore / general / image-reader 等辅助子代理；
 * 3. 标题特征：包含 subagent、sub-agent 或 @review 等标记。
 */
export function isSubagentSession(session) {
  if (!session || typeof session !== 'object') return false;

  // 1. 父会话 ID 检查 (同时兼容 HTTP API 的 parentID 与 SQLite 的 parent_id)
  if (session.parentID || session.parent_id || session.parentId) {
    return true;
  }

  // 2. 专用子智能体角色检查 (排除非主任务 agent)
  const agent = String(session.agent || '').toLowerCase().trim();
  if (agent && agent !== 'build' && agent !== 'main' && agent !== 'default') {
    return true;
  }

  // 3. 标题特征模式检查
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

  // 4. 记忆抽取 fork 会话拦截：daemon 派发的 fork 会继承原目录且无 parentID，
  //    仅靠 parentID 无法识别，必须用标题后缀 "(fork #N)" 特征拦截，杜绝套娃循环抽取。
  if (/\(fork #\d+\)$/i.test(title)) {
    return true;
  }

  return false;
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

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  let sessions;
  try {
    const res = await fetch(`${baseUrl}/session`, { headers, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`列出会话失败 HTTP ${res.status}`);
    sessions = await res.json();
  } finally {
    clearTimeout(t);
  }

  const list = Array.isArray(sessions) ? sessions : [];
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
    const targetDir = s.directory || s.path || '';
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
      directory: s.directory || s.path || '',
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

/**
 * 构建注入给宿主 LLM 的高质量记忆沉淀提示词。
 *
 * 强化约束：
 *  - 严禁空洞泛化与无价值沉淀：无价值或纯闲聊直接回复"无需沉淀"，禁止调用 memhub_save；
 *  - 物理终态成功证据门禁：必须有可信验证结论（测试通过、构建成功、根因定位并修复）；
 *  - 多卡拆分：同 session 同时存在问题排查与架构决策时，拆为多卡分别调用 memhub_save；
 *  - 规范命名：[技术栈/模块] 核心场景/症状 -> 最终结论/正解 (25-45字，含实体名)；
 *  - 覆盖机制：必传 session_id 与 topic_fingerprint，支持原地更新覆盖。
 *
 * @param {Object} opts { targetSessionId, projectName }
 */
export function buildExtractionPrompt(opts = {}) {
  const sessionId = opts.targetSessionId || '当前会话';
  const projectConstraint = opts.projectName 
    ? `\n   - 【严格所属项目约束】：调用 memhub_save 时，project 字段必须严格填 "${opts.projectName}"，严禁擅自修改或添加前后缀！`
    : '';
  return [
    `【MemHub 自动化工程记忆提炼任务】`,
    `请全面复盘本会话发生的真实代码修改、排错过程或架构权衡决策，提炼出可供团队跨会话长期复用的工程暗知识资产。`,
    ``,
    `【硬性门禁与执行规约】（这是后台静默分析任务，严禁修改业务代码或新建无关文件）：`,
    `1. 【无价值坚决不沉淀】：`,
    `   - 若本会话仅为简单查询、文件浏览、日常闲聊、未经验证的代码改动或未定位根因的失败尝试，请直接回复"无需沉淀"，【绝对不要】调用 memhub_save！`,
    `2. 【物理终态成功证据门禁 (Truth Gate)】：`,
    `   - 只有具备明确物理终态成功证据（例如测试用例通过、编译构建成功、运行时服务正常启动、或报错已彻底排查并验证修复）的内容才允许沉淀。未验证的猜测一律禁止入库！`,
    `3. 【多卡独立抽取】：`,
    `   - 若本会话同时包含两类或以上的独立有价值主题（例如既成功排查定位了复杂 Bug，又沉淀了新的架构选型决策 ADR），请务必拆分为多张独立的记忆卡片，分别单独调用 memhub_save！`,
    `4. 【四大基石分类与规范标题】：`,
    `   - category 必须是以下四者之一：`,
    `     * learnings: 排错避坑因果链（必须包含 symptom、root_cause、solution、ineffective_attempts）`,
    `     * decisions: 架构决策与设计权衡 ADR（必须包含 context、solution、guardrails、alternatives）`,
    `     * patterns: 验证通过的可复用代码配置模板（必须包含 context、solution、boundaries）`,
    `     * business: 业务领域暗知识与隐性潜规则（必须包含 context[业务域]、solution[业务口径与计算规则]、guardrails[业务资损与防踩坑红线]、mechanism[状态机流转时序]）`,
    `   - title 格式严格遵守：[技术栈/模块] 核心场景/症状 -> 最终结论/正解 (25-45字，必须含具体实体名，如: [Docker/Alpine] glibc缺失致canvas崩溃 -> 改用debian-slim或加libc6-compat)。`,
    `5. 【防重与覆盖机制】：`,
    `   - 调用 memhub_save 时，务必传入 session_id="${sessionId}"。${projectConstraint}`,
    `   - 若可能，传入简明小写的 topic_fingerprint（如 "docker-alpine-glibc"），系统将自动执行原地更新覆盖，防止重复落库。`
  ].join('\n');
}

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
  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  const body = {};
  if (opts.messageID) body.messageID = opts.messageID;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/fork`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`fork 会话失败 HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * 读取单个会话的运行态（idle / busy / retry）。
 * @returns {Promise<string>} 'idle' | 'busy' | 'retry' | 'unknown'
 */
export async function getSessionStatus(baseUrl, sessionId, timeoutMs = 8000) {
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/session/status`, { headers, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`读取会话状态失败 HTTP ${res.status}`);
    const map = await res.json();
    const st = map?.[sessionId];
    if (!st) return 'unknown';
    return st.type || 'unknown';
  } finally {
    clearTimeout(t);
  }
}

/**
 * 读取会话最后一次 assistant 回复的完成度。
 *
 * 背景：/session/status 并不总是包含 fork 副本（部分宿主实现只跟踪 TUI 侧会话），
 * 因此不能仅靠 status 判定抽取是否结束。更可靠的信号是最后一条 assistant 消息：
 *   - 仍在推理：parts 为空 / 无 time.completed
 *   - 已完成：存在 time.completed，或 parts 非空且不再增长
 *
 * @returns {Promise<{hasReply:boolean, completed:boolean, partsCount:number}>}
 */
export async function getLastAssistantProgress(baseUrl, sessionId, timeoutMs = 8000) {
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/message`, {
      headers, signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`读取会话消息失败 HTTP ${res.status}`);
    const arr = await res.json();
    const list = Array.isArray(arr) ? arr : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const info = list[i]?.info;
      if (info?.role === 'assistant') {
        const parts = Array.isArray(list[i]?.parts) ? list[i].parts : [];
        const completed = !!info.time?.completed;
        return { hasReply: true, completed, partsCount: parts.length };
      }
    }
    return { hasReply: false, completed: false, partsCount: 0 };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 轮询等待 fork 会话抽取完成。
 * prompt_async 为"发完即返回"，需主动轮询直到目标会话产出完成回复或超时。
 * 判定策略（双保险）：
 *   1. status 变为 idle —— 若宿主维护了该副本状态，最快信号；
 *   2. 最后一条 assistant 消息出现 time.completed 且 parts 非空 —— 通用可靠信号。
 * @param {Object} opts { pollIntervalMs=3000, maxWaitMs=300000, onWait? }
 * @returns {Promise<{completed:boolean, waitedMs:number, finalStatus:string}>}
 */
export async function waitForSessionIdle(baseUrl, sessionId, opts = {}) {
  const pollIntervalMs = opts.pollIntervalMs || 3000;
  const maxWaitMs = opts.maxWaitMs || 300000;
  const start = Date.now();
  let lastStatus = 'unknown';
  let sawReply = false;

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const waitedMs = Date.now() - start;

    // 信号 1：宿主状态 idle
    let status = 'unknown';
    try {
      status = await getSessionStatus(baseUrl, sessionId);
    } catch {
      status = 'unknown';
    }
    lastStatus = status;
    if (status === 'idle') {
      return { completed: true, waitedMs, finalStatus: 'idle' };
    }

    // 信号 2：最后一条 assistant 消息已完成
    try {
      const prog = await getLastAssistantProgress(baseUrl, sessionId);
      if (prog.completed && prog.partsCount > 0) {
        // 二次确认：间隔一个周期后仍未变化，避免"part 刚写入"的中间态误判
        await new Promise(r => setTimeout(r, Math.min(pollIntervalMs, 1500)));
        const confirm = await getLastAssistantProgress(baseUrl, sessionId);
        if (confirm.completed && confirm.partsCount > 0) {
          return { completed: true, waitedMs: Date.now() - start, finalStatus: 'completed' };
        }
      }
      if (prog.hasReply) sawReply = true;
    } catch {
      // 消息读取失败不致命，继续等待
    }

    if (typeof opts.onWait === 'function') {
      try { opts.onWait(status, waitedMs); } catch {}
    }
  }

  // 超时兜底：若期间至少出现过 assistant 回复且已无新增迹象，视为大概完成
  return { completed: false, waitedMs: Date.now() - start, finalStatus: lastStatus, sawReply };
}

/**
 * 删除会话（fork 抽取完成后必须调用，避免用户在会话列表中看到残留与再次被扫描）。
 * @returns {Promise<boolean>}
 */
export async function deleteSession(baseUrl, sessionId, timeoutMs = 8000) {
  if (!sessionId) return false;
  const auth = basicAuthHeader();
  const headers = {};
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}`, {
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

  const payload = {
    dryRun,
    url: `${baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async`,
    prompt
  };
  if (dryRun) return payload;

  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
  try {
    const res = await fetch(payload.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        noReply: false,
        parts: [{ type: 'text', text: prompt }]
      }),
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
