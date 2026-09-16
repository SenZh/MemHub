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
    ? `\n   - 【所属项目】：必须准确填写 "${opts.projectName}"！`
    : '';
  return [
    `【MemHub 自动化工程暗知识与长效记忆沉淀】`,
    `你的任务是复盘当前会话，把它记录成【一张】可长期复用的工程记忆卡片。`,
    `【核心规则】一个会话 = 一张卡。无论本会话涉及多少主题、产出多少内容，都必须写进这一张卡，严禁拆成多张。`,
    `若本会话确实没有任何可复用的知识（纯闲聊、纯临时操作、未定位根因的无效尝试），直接回复 "无需沉淀"，不要为凑数而强行成卡。`,
    ``,
    `【第一铁律：只记事实，严禁编造】`,
    `- 卡片内容必须全部来自本会话中真实出现过的事实：读到的代码、写入的文件、执行的结论、用户的原话。`,
    `- 严禁补全、严禁推断、严禁虚构。具体禁止：`,
    `  · 禁止把"待办/建议/风险"写成"已完成/已修复"（会话说"建议修 SQL"就只能写"待修复"，绝不能写"已修复"）；`,
    `  · 禁止编造会话中不存在的上下文（如虚构"本次承接上次工作""checkpoint 核对""第 N 阶段"等叙事）；`,
    `  · 禁止补因果（"因为 A 所以 B"）、补状态、补结论——原文没说的，一律不写。`,
    `- 如果某个信息会话里没讲清楚，就如实留空或标注"会话未涉及"，绝对不要靠推测填满。`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `一、内容来源（盘点范围，务必完整）：`,
    `- 不要只看对话文本！本次会话中读取、写入、修改的文件（文档、代码、SQL、配置）所承载的知识同样是核心素材，必须一并纳入。`,
    `- 很多会话的对话部分只是"我读一下""现在提交"这类过程话，真正的知识全在读到的代码与写入的文件内容里。`,
    `- 目标是把这个会话"做了什么、了解到什么、得到什么知识"如实记录完整，不遗漏主干，不被零散细节带偏。`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `二、正文撰写规范（固定五段式；以事实罗列为主体，允许归并同类项，但不得跨越事实边界）：`,
    `正文必须按以下五段组织（使用这五段作为小标题）：`,
    `1. 【目标】：本次会话做了什么、目标是什么；有多个目标就写多条；达成了就写达成，没达成就写未达成（不夸大）。`,
    `2. 【背景】：了解到的背景，即“现状 -> 目标”，包括业务事实、业务逻辑、技术架构等。写会话里查证到的事实。`,
    `3. 【方案】：为达成目标采用的方案、做法或排查路径。【非必填】——纯查询/分析/知识梳理类可省略此段。`,
    `4. 【结论】：本次会话得出的关键事实与结论（查到的事实、判定的结果、核心要点等）。这是全卡的重心，要写全。`,
    `5. 【经验】：有什么坑、误区或红线需要告知其他人。【有才写，没有就整段不写，严禁硬凑】。`,
    `撰写铁律：`,
    `- 事实优先：以"逐条陈述事实"为主，每句话都必须是会话里真实存在的信息，宁可略碎，也不得为了通顺而编造。`,
    `- 允许归并：同类事实可以合并成一条、去掉重复表述，但不允许改变事实内容（不得把"待处理"归并成"已处理"）。`,
    `- 写全主干：会话的主要产出（背景澄清、方案、结论）都要写上，不得只抓某一块细节而丢主干。`,
    `- 去水分：只删过程性叙述与一次性细节（逐步排查时间线、具体设备号/时间点/人员对话、环境偶发状态），不删知识本身。`,
    `- 【严禁工程过程痕迹】：commit hash、提交推送动作（"已提交/已推送/已交付/已落盘"）、测试用例数量（"758 例全绿"）、文件行号、分支名、执行流水（"先查A再改B"）——这些对后人无复用价值，一律不写。`,
    `- 【可执行细节要保留】：凡是能帮后人直接行动的细节必须写全，例如：具体文件路径、"请在 X 环境验证"、精确的时间窗口（如 UTC 01:00–02:00）、具体的 SQL/配置片段、需滚动重启的服务清单。这类内容不算水分，写具体比写笼统好。`,
    `- 严禁出现“标准环境”、“结合业务评估”等敷衍废话。`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `三、关键涉及文件（【可选】，只列核心文件）：`,
    `- 只列【承载本卡核心知识】的文件，通常 1-5 个即可，**不要求穷尽会话中读过的所有文件**。`,
    `- 判断标准：未来读者要理解或复用这张卡的知识，最需要去打开的 1-5 个文件。测试文件、设计文档、只被只读浏览过的文件一般不必列。`,
    `- 路径必须与会话中出现的完全一致（用相对路径），不要凭猜测构造路径。`,
    `- 【没有文件也要正常沉淀】：本项是可选信息，不是沉淀的前提条件。纯概念讨论、纯线上排查、纯分析类会话即使不涉及任何文件，也必须正常产出卡片，此时本项写"无"或直接省略。`,
    `- 格式示例（有文件时）：`,
    `  \`\`\``,
    `  ## 关键涉及文件`,
    `  - \`saasomsappconfig/src/main/java/com/dahua/oms/dao/oemdao/mappers/DeviceAddConfigDao.xml\``,
    `  - \`omsdeviceservice/src/main/resources/application.tpl.properties\``,
    `  \`\`\``,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `四、标题规格（20-45 字，一句话摘要式，概括整个会话是什么知识）：`,
    `格式：[业务模块/核心主题] 本次会话讲清的核心知识与结论`,
    `要求：像一条可检索的知识索引，让后人一眼看出"这张卡记录了什么问题、得到什么结论"，直奔主题，严禁句号。`,
    `❌ 反例（含糊/灌水/右侧写成动作）: [OMS/权限体系] 角色四字段与用户·角色·菜单·厂商校验 -> 源码实证+SOP沉淀`,
    `❌ 反例（含糊）: [权限中心/全局Redis废弃] 旁路C3跨区流量未清零阻断下线 -> 明确改造脱节成因并对齐真实流量清零`,
    `✅ 正例（说清是什么知识）: [oemconfig/MySQL升级] OMS+Dubhe共用配置库5.7升8.4：影响面、DTS方案与P0兼容风险`,
    `✅ 正例（说清是什么知识）: [OMS/权限模型] 角色四字段真实语义与用户-角色-菜单-厂商校验链`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `五、tags 生成规则（严格遵守，tags 是检索入口，宁缺毋滥）：`,
    `tags 只能从以下三类中选取，共 3-6 个：`,
    `1. 业务模块/系统名：如 oms、saasomsappconfig、bindCenter、ProductService（已有系统名照实写）；`,
    `2. 技术实体名：客观存在的技术栈/中间件/协议/表名，如 redis、mysql8、canal、feign、dts、only_full_group_by；`,
    `3. 核心业务概念：领域名词，如 权限模型、跨区、分享、设备绑定、数据同步。`,
    `【严禁】以下内容作为 tag：`,
    `- 工具与画图类：mermaid、lark-cli、powershell、opencode 等（本次用过但不构成知识属性）；`,
    `- 方法/流程词：tdd、重构、排查、审查、测试；`,
    `- 动作词与泛词：修复、优化、新增、问题、方案、业务、系统、模块；`,
    `- 代码结构词：handler、util、service、mgr。`,
    `格式：全部小写英文（如 oms、redis、mysql8）；中文概念保留原样（如 权限模型、跨区）；不要带空格。`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `六、落盘保存规约：`,
    `1. 若具备沉淀价值，必须调用 memhub_save 工具进行保存，且【只调用一次】，参数规范：`,
    `   - title: [业务模块/核心主题] 核心知识与结论 (20-45字)`,
    `   - category: 固定填 "default"`,
    `   - tags: 按第五节的规则，3-6 个（业务模块名 + 技术实体/业务概念）`,
    `   - content: 按【目标】【背景】【方案】【结论】【经验】五段式撰写的高密度 Markdown 正文（方案可省，经验无则不写）`,
    `   - related_files: 【可选】1-5 个承载本卡核心知识的文件相对路径数组（如 ["a/b.xml","c/d.properties"]）；没有则传空数组 []，不影响沉淀`,
    `   - session_id: "${sessionId}"${projectConstraint}`,
    `2. 再次强调：整个会话只产出这一张卡，禁止拆分为多张。`,
    `3. 【严禁自我引用与重复保存】：`,
    `   - 保存完成后，立即结束任务。严禁再调用 memhub_get / memhub_search / memhub_recent 去查看记忆库；`,
    `   - 严禁因为你"看到记忆库里已有本次会话的卡片"而认为存在"上次的检查点/前情"，并据此再写一张"续接/checkpoint/核对"卡；`,
    `   - 严禁使用 supersedes 参数，严禁覆盖任何已有卡片。`,
    `   - 你的任务只有一次：基于本会话内容写一张卡，写完即止。记忆库里已有什么，与你无关。`
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

/**
 * 创建全新的独立临时会话（如用于 AI 做梦反思任务）。
 * @param {string} baseUrl
 * @param {Object} opts { title, directory, timeoutMs }
 * @returns {Promise<Object>} 创建的会话对象 (含 id, title, directory)
 */
export async function createSession(baseUrl, opts = {}) {
  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  const body = {
    title: opts.title || 'MemHub Task',
    directory: opts.directory || process.cwd()
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
  try {
    const res = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`创建独立会话失败 HTTP ${res.status}`);
    return await res.json();
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
  const auth = basicAuthHeader();
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 20000);
  try {
    const res = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        noReply: false,
        parts: [{ type: 'text', text: promptText }]
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`向会话派发提示词失败 HTTP ${res.status}`);
    return { ok: true, status: res.status };
  } finally {
    clearTimeout(t);
  }
}
