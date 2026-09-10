import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfig, MEMHUB_HOME, ensureDirectories } from './config.js';
import { getDatabase } from './storage.js';
import { 
  discoverOpenCodeServer, 
  listCandidateSessions, 
  dispatchExtractionPrompt,
  forkSession,
  waitForSessionIdle,
  deleteSession
} from './host/opencode-client.js';
import { runDreamPipeline } from './dream/pipeline.js';
import { compileCron } from './cron.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.join(__dirname, 'cli.js');

export const PID_FILE = path.join(MEMHUB_HOME, 'daemon.pid');
export const LOG_FILE = path.join(MEMHUB_HOME, 'daemon.log');

/**
 * 检查指定 PID 进程是否在运行
 */
export function isProcessRunning(pid) {
  if (!pid || isNaN(pid)) return false;
  try {
    return process.kill(Number(pid), 0);
  } catch (e) {
    return e.code === 'EPERM'; // EPERM 表示存在但无权操作，依然存活
  }
}

/**
 * 安全终止指定 PID 的进程
 */
export function killProcess(pid) {
  if (!pid || !isProcessRunning(pid)) return false;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(Number(pid), 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 查看后台守护进程状态
 */
export function getDaemonStatus() {
  ensureDirectories();
  if (fs.existsSync(PID_FILE)) {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = parseInt(raw, 10);
    if (isProcessRunning(pid)) {
      console.log(`🟢 [memhub daemon] 正在后台运行`);
      console.log(`   - 进程 PID: ${pid}`);
      console.log(`   - 运行日志: ${LOG_FILE}`);
      console.log(`   - 停止服务: memhub daemon stop`);
      console.log(`   - 查看日志: memhub daemon logs`);
      return { running: true, pid, logFile: LOG_FILE };
    } else {
      // 遗留失效的 PID 文件，自动清理
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  }

  console.log(`⚪ [memhub daemon] 当前未在运行。`);
  console.log(`   - 后台启动: memhub daemon start (或直接 memhub daemon)`);
  console.log(`   - 前台调试: memhub daemon --foreground`);
  return { running: false };
}

/**
 * 停止后台守护进程
 */
export function stopDaemon() {
  ensureDirectories();
  if (!fs.existsSync(PID_FILE)) {
    console.log(`ℹ️ [memhub daemon] 未检测到正在运行的后台守护进程（PID 文件不存在）。`);
    return false;
  }

  const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
  const pid = parseInt(raw, 10);

  if (!isProcessRunning(pid)) {
    console.log(`ℹ️ [memhub daemon] 进程 PID ${pid} 已不存在，清理无效状态文件。`);
    try { fs.unlinkSync(PID_FILE); } catch {}
    return false;
  }

  console.log(`🛑 [memhub daemon] 正在停止后台守护进程 (PID: ${pid})...`);
  const killed = killProcess(pid);
  try { fs.unlinkSync(PID_FILE); } catch {}

  if (killed || !isProcessRunning(pid)) {
    console.log(`✅ [memhub daemon] 后台服务已成功停止。`);
    return true;
  } else {
    console.warn(`⚠️ 无法正常停止进程 PID ${pid}，请检查系统权限或手动在任务管理器结束。`);
    return false;
  }
}

/**
 * 查看守护进程最近日志
 */
export function showDaemonLogs(options = {}) {
  ensureDirectories();
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`ℹ️ 暂无日志文件: ${LOG_FILE}`);
    return;
  }

  const linesCount = options.lines || 30;
  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const allLines = content.split(/\r?\n/);
  const tailLines = allLines.slice(-linesCount);

  console.log(`📜 [memhub daemon] 最近 ${tailLines.length} 行日志 (${LOG_FILE}):\n`);
  console.log(tailLines.join('\n'));
}

/**
 * 后台脱机启动守护进程 (Detached Spawn)
 */
export function startDaemonBackground(cliOptions = {}) {
  ensureDirectories();

  // 1. 检查是否已有运行中的实例
  if (fs.existsSync(PID_FILE)) {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const existingPid = parseInt(raw, 10);
    if (isProcessRunning(existingPid)) {
      console.log(`⚠️ [memhub daemon] 后台已有一个运行中的守护进程 (PID: ${existingPid})！`);
      console.log(`   - 停止运行: memhub daemon stop`);
      console.log(`   - 查看日志: memhub daemon logs`);
      return { success: false, pid: existingPid };
    } else {
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  }

  // 2. 组装参数，转发给前台子进程
  const childArgs = [CLI_PATH, 'daemon', '--foreground'];
  if (cliOptions.interval) childArgs.push('--interval', String(cliOptions.interval));
  if (cliOptions.windowDays) childArgs.push('--window-days', String(cliOptions.windowDays));
  if (cliOptions.idleMinutes) childArgs.push('--idle', String(cliOptions.idleMinutes));
  if (cliOptions.limit) childArgs.push('--limit', String(cliOptions.limit));
  if (cliOptions.dryRun) childArgs.push('--dry-run');
  if (cliOptions.force) childArgs.push('--force');
  if (cliOptions.ui) childArgs.push('--ui');
  if (cliOptions.uiPort) childArgs.push('--ui-port', String(cliOptions.uiPort));

  // 3. 打开日志文件描述符并脱离当前终端派生 (detached)
  const logFd = fs.openSync(LOG_FILE, 'a');

  // 写入启动标记行
  fs.writeSync(logFd, `\n\n==================== [${new Date().toLocaleString()}] memhub daemon 后台启动 ====================\n`);

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true
  });

  const childPid = child.pid;
  fs.writeFileSync(PID_FILE, String(childPid), 'utf8');

  // 脱钩父进程
  child.unref();

  console.log(`✅ [memhub daemon] 成功在后台启动！`);
  console.log(`   - 进程 PID: ${childPid}`);
  console.log(`   - 轮询周期: 每 ${cliOptions.interval || 30} 分钟`);
  console.log(`   - 扫描窗口: 最近 ${cliOptions.windowDays || 7} 天内更新`);
  console.log(`   - 运行日志: ${LOG_FILE}`);
  console.log(`   - 停止服务: memhub daemon stop`);
  console.log(`   - 查看状态: memhub daemon status`);
  console.log(`   - 查看日志: memhub daemon logs`);

  return { success: true, pid: childPid, logFile: LOG_FILE };
}

/**
 * 在 (from, to] 时间区间内查找是否跨过任一 cron 命中分钟。
 *
 * 背景：daemon 轮询粒度通常为分钟级以上（如 60 分钟一轮），若只判断"当前这一分钟
 * 是否命中 cron"，相位错位会导致 `0 3 * * *` 这类精确时刻永远命中不到。故需检测
 * 本轮 tick 与上一轮之间是否跨过命中点。遍历步长为 1 分钟，并对区间长度做上限保护。
 *
 * @param {{match:(d:Date)=>boolean}} matcher 已编译的 cron 匹配器
 * @param {number} fromTs 区间起点（不含），毫秒
 * @param {number} toTs 区间终点（含），毫秒
 * @returns {Date|null} 命中的时刻，无则 null
 */
export function findCronHitBetween(matcher, fromTs, toTs) {
  if (!matcher || !(toTs > fromTs)) return null;

  // 对齐到下一整分钟
  const start = Math.floor(fromTs / 60000) * 60000 + 60000;
  // 区间上限保护：最多向前回溯 7 天，防止极端情况下长时间未 tick 造成超大循环
  const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
  const lowerBound = Math.max(start, toTs - MAX_LOOKBACK_MS);
  const end = Math.floor(toTs / 60000) * 60000;

  for (let ts = lowerBound; ts <= end; ts += 60000) {
    const d = new Date(ts);
    if (matcher.match(d)) return d;
  }
  return null;
}

/**
 * 守护进程前台执行核心循环 (Foreground Engine)
 */
export function runDaemonForeground(cliOptions = {}) {
  const cfg = getConfig();
  const daemon = cfg.daemon || { intervalMinutes: 30, windowDays: 7, idleMinutes: 120 };

  const intervalMinutes = (cliOptions.interval || daemon.intervalMinutes) || 30;
  const windowDays = cliOptions.windowDays || daemon.windowDays || 7;
  const idleMinutes = cliOptions.idleMinutes || daemon.idleMinutes || 120;
  // 默认单轮仅处理 1 个会话，细水长流，防止并发唤醒多会话挤占推理资源导致前端卡顿
  const limit = cliOptions.limit || 1;
  const dryRun = cliOptions.dryRun === true;
  const force = cliOptions.force === true;

  console.log(`🕐 [memhub daemon] 启动常驻定时记忆提炼调度器 (PID: ${process.pid})`);
  console.log(`   - 轮询周期: 每 ${intervalMinutes} 分钟`);
  console.log(`   - 扫描窗口: 最近 ${windowDays} 天内更新`);
  console.log(`   - 静默阈值: 距现在超过 ${idleMinutes} 分钟`);
  console.log(`   - 单轮上限: 最多处理 ${limit} 个会话`);
  console.log(`   - 驱动模式: OpenCode HTTP 宿主驱动 (fork 副本抽取, 原会话零污染, 抽完即删)`);
  if (dryRun) console.log(`   - [注意] 当前处于 dry-run 桩模式，不真发 POST 请求`);

  const db = getDatabase();
  let running = false;

  // 做梦调度状态：当日去重 + cron 编译缓存（避免每轮重复解析）
  let lastDreamDate = null;   // 形如 '2026-09-10'，记录最近一次做梦触发的本地日期
  let dreamCronCache = { expr: null, matcher: null, lastRunTs: Date.now() };

  // 获取已处理过的 session_id 集合
  function getProcessedSessionIds() {
    if (force) return new Set();
    const rows = db.prepare(`
      SELECT session_id FROM session_tracking 
      WHERE status IN ('EXTRACTED', 'SKIPPED')
    `).all();
    return new Set(rows.map(r => r.session_id));
  }

  /**
   * 做梦自省调度：读取配置 cron，本区间跨过命中时刻且当日未跑过则执行。
   * 规则：
   *   1. dream.enabled 为假 -> 跳过；
   *   2. 配置了合法 cron -> 检测 (上次 tick, 现在] 是否跨过命中分钟（兼容轮询相位错位），当日仅触发一次；
   *   3. cron 缺失/非法 -> 回退按 intervalMinutes 间隔触发（兜底）。
   * 每轮 tick 调用，配置热重载即改即生效。
   */
  async function maybeRunDream(liveCfg) {
    const dream = liveCfg?.dream;
    if (!dream || dream.enabled !== true) return;

    const now = new Date();
    const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

    // 当日已触发过则跳过
    if (lastDreamDate === dateKey) return;

    let shouldRun = false;
    let reason = '';

    const cronExpr = typeof dream.cron === 'string' ? dream.cron.trim() : '';
    let cronValid = false;
    if (cronExpr) {
      try {
        if (dreamCronCache.expr !== cronExpr) {
          dreamCronCache.expr = cronExpr;
          dreamCronCache.matcher = compileCron(cronExpr);
        }
        cronValid = true;
      } catch (ce) {
        console.warn(`   ⚠️ dream.cron 表达式非法（${ce.message}），回退按间隔调度`);
        dreamCronCache.expr = cronExpr;
        dreamCronCache.matcher = null;
      }
    }

    // 1) cron 命中：因 daemon 轮询粒度 >= 1 分钟，不能只判断"当前这一分钟"，
    //    而要检测 (上次检查, 现在] 区间内是否跨过了任一 cron 命中分钟，避免相位错位永远命中不到。
    if (cronValid && dreamCronCache.matcher) {
      const from = dreamCronCache.lastCheckTs || (Date.now() - intervalMinutes * 60 * 1000);
      if (findCronHitBetween(dreamCronCache.matcher, from, Date.now())) {
        shouldRun = true;
        reason = `cron "${cronExpr}" 命中`;
      }
    }

    // 2) 无有效 cron 时，按 intervalMinutes 间隔兜底
    if (!shouldRun && !cronValid) {
      const intervalMs = (dream.intervalMinutes || 1440) * 60 * 1000;
      const lastRunTs = dreamCronCache.lastRunTs || Date.now();
      if (Date.now() - lastRunTs >= intervalMs) {
        shouldRun = true;
        reason = `间隔调度（每 ${dream.intervalMinutes || 1440} 分钟）`;
      }
    }

    dreamCronCache.lastCheckTs = Date.now();

    if (!shouldRun) return;

    console.log(`\n🌙 [memhub daemon] 触发做梦自省引擎（${reason}）...`);
    try {
      const dreamRes = await runDreamPipeline({ dryRun: false });
      lastDreamDate = dateKey;
      dreamCronCache.lastRunTs = Date.now();
      if (dreamRes.processed > 0) {
        console.log(`   ✅ 做梦成功派发 ${dreamRes.processed} 个碎片簇进行高阶熔炼`);
      } else if (dreamRes.clusters_found === 0) {
        console.log(`   ℹ️ 当前无可做梦的碎片簇，跳过本轮`);
      } else {
        console.log(`   ℹ️ 做梦本轮未派发（候选 ${dreamRes.total_candidates}，簇 ${dreamRes.clusters_found}）`);
      }
    } catch (de) {
      console.warn(`   ⚠️ 做梦流水线异常: ${de.message}`);
    }
  }

  async function tick() {
    if (running) return; // 防止上一轮未跑完时重入
    running = true;
    const ts = new Date().toLocaleTimeString();
    console.log(`\n=== [${ts}] memhub daemon 触发一轮检查 ===`);

    try {
      // 0. 每轮热重载配置：无需重启 daemon 即可让 config.json 的改动生效
      const liveCfg = getConfig();
      const liveDaemon = liveCfg.daemon || daemon;

      // 0.1 做梦自省调度（独立于会话抽取，先于 OpenCode 探测，避免被提前 return 跳过）
      await maybeRunDream(liveCfg);

      // 1. 动态发现 OpenCode Server
      const baseUrl = await discoverOpenCodeServer({
        explicitBaseUrl: liveDaemon.opencodeUrl || undefined,
        timeoutMs: 3000
      });

      if (!baseUrl) {
        console.log(`ℹ️  未检测到运行中的 OpenCode HTTP 服务，跳过本轮（将在 ${intervalMinutes} 分钟后重试）。`);
        return;
      }

      console.log(`🔗 成功连通 OpenCode 宿主服务: ${baseUrl}`);

      // 2. 获取候选历史会话
      const excludeIds = getProcessedSessionIds();
      const candidates = await listCandidateSessions(baseUrl, {
        windowDays,
        idleMinutes,
        excludeIds,
        limit,
        scanRules: liveCfg.scanRules
      });

      if (candidates.length === 0) {
        console.log(`✅ 检查完毕：当前无符合条件的冷态未抽取会话（最近 ${windowDays} 天内 / 静默 >= ${idleMinutes} 分钟）。`);
        return;
      }

      console.log(`🎯 发现 ${candidates.length} 个符合条件的候选会话，准备驱动 LLM 抽取:`);

      // 3. 逐个会话注入沉淀指令
      for (const session of candidates) {
        const now = Date.now();
        console.log(`   👉 正在处理会话: [${session.id}] "${session.title}" (更新于 ${new Date(session.timeUpdated).toLocaleString()})`);

        // 在 session_tracking 中记录并锁定
        try {
          db.prepare(`
            INSERT INTO session_tracking (
              session_id, source, source_agent, project, project_path, session_title,
              status, attempts, locked_until, time_processed, updated_at
            ) VALUES (?, 'opencode', 'opencode-http', ?, ?, ?, 'EXTRACTING', 1, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              source_agent = excluded.source_agent,
              project_path = excluded.project_path,
              session_title = excluded.session_title,
              status = 'EXTRACTING',
              attempts = attempts + 1,
              locked_until = excluded.locked_until,
              updated_at = excluded.updated_at
          `).run(
            session.id,
            session.directory || 'global',
            session.directory || '',
            session.title || '',
            now + 300000,
            now,
            now
          );
        } catch (e) {
          console.warn(`   ⚠️ session_tracking 记录失败: ${e.message}`);
        }

        // 调用 OpenCode HTTP：fork 原会话 -> 在 fork 副本内抽取 -> 轮询完成 -> 删除 fork
        // 关键约束：
        //   1. 绝不向原会话写消息，原会话排序/缓存完全不受影响；
        //   2. fork 会话必须无论成败都在 finally 中删除，避免用户可见与再次被扫描套娃；
        //   3. 抽取结果归属原会话 (originSessionId)，写入 memhub_save 的 session_id。
        let forkId = null;
        try {
          if (dryRun) {
            const res = await dispatchExtractionPrompt(baseUrl, {
              sessionId: session.id,
              originSessionId: session.id,
              dryRun: true
            });
            console.log(`   [dry-run] 已生成沉淀指令桩（未 fork，未发送）`);
            console.log(`   [dry-run] 目标原会话: ${res.url}`);
            continue;
          }

          // 1. fork 原会话，复制上下文（保留前缀 prompt cache），不触碰原会话
          const fork = await forkSession(baseUrl, session.id, { timeoutMs: 20000 });
          forkId = fork?.id;
          if (!forkId) throw new Error('fork 未返回有效会话 id');
          console.log(`   🍴 已 fork 抽取副本: ${forkId} (目录: ${fork.directory || session.directory})`);

          // 2. 向 fork 副本注入沉淀指令（结果归属原会话）
          const res = await dispatchExtractionPrompt(baseUrl, {
            sessionId: forkId,
            originSessionId: session.id,
            dryRun: false,
            timeoutMs: 25000
          });

          if (!res.posted) {
            console.warn(`   ⚠️ 注入指令返回异常 HTTP ${res.httpStatus}`);
            throw new Error(`注入 fork 副本失败 HTTP ${res.httpStatus}`);
          }

          // 3. 轮询等待 fork 副本抽取完成（idle）或超时
          console.log(`   ⏳ 等待 fork 副本完成复盘提炼...`);
          const waited = await waitForSessionIdle(baseUrl, forkId, {
            pollIntervalMs: 3000,
            maxWaitMs: 300000,
            onWait: (st, ms) => {
              if (ms > 0 && ms % 30000 < 3000) {
                console.log(`      ...仍处理中 (状态: ${st}, 已等待 ${Math.round(ms / 1000)}s)`);
              }
            }
          });
          if (waited.completed) {
            console.log(`   ✅ fork 副本复盘完成 (耗时 ${Math.round(waited.waitedMs / 1000)}s)，宿主 LLM 已调用 memhub_save`);
          } else {
            console.warn(`   ⚠️ fork 副本等待超时 (最终状态: ${waited.finalStatus})`);
          }

          // 更新 tracking 状态为 EXTRACTED
          db.prepare(`
            UPDATE session_tracking 
            SET status = 'EXTRACTED', updated_at = ? 
            WHERE session_id = ?
          `).run(Date.now(), session.id);
        } catch (e) {
          console.error(`   ❌ 驱动抽取失败: ${e.message}`);
          db.prepare(`
            UPDATE session_tracking 
            SET status = 'FAILED', updated_at = ? 
            WHERE session_id = ?
          `).run(Date.now(), session.id);
        } finally {
          // 无论成败，必须清理 fork 副本，防止残留可见与循环抽取
          if (forkId) {
            const ok = await deleteSession(baseUrl, forkId).catch(() => false);
            console.log(ok ? `   🧹 已清理 fork 副本 ${forkId}` : `   ⚠️ fork 副本 ${forkId} 清理失败，请手动删除`);
          }
        }

        // 会话间平滑冷却间隔，防止并发打爆宿主推理与 WebSocket
        if (candidates.indexOf(session) < candidates.length - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      console.log(`✨ 本轮会话处理完毕。`);
    } catch (err) {
      console.error(`[memhub daemon] 本轮调度异常: ${err.message}`);
    } finally {
      running = false;
    }
  }

  // --once：执行一轮即退出
  if (cliOptions.once) {
    tick().then(() => {
      console.log('\n[memhub daemon] --once 单轮执行完毕，退出。');
      process.exit(0);
    });
    return;
  }

  // 常驻定时
  let webServerInstance = null;
  if (cliOptions.ui) {
    import('./server/index.js').then(({ startWebServer }) => {
      const port = Number(cliOptions.uiPort) || 3900;
      startWebServer({ port, open: false }).then(instance => {
        webServerInstance = instance.server;
        console.log(`[memhub daemon] 伴生 WebUI HTTP Server 启动成功 (端口: ${port})`);
      }).catch(err => {
        console.warn(`[memhub daemon] 伴生 WebUI HTTP Server 启动警告: ${err.message}`);
      });
    }).catch(err => {
      console.warn(`[memhub daemon] 加载 WebServer 模块失败: ${err.message}`);
    });
  }

  tick();
  const timer = setInterval(tick, intervalMinutes * 60 * 1000);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[memhub daemon] 收到退出信号，正在优雅退出...');
    clearInterval(timer);
    if (webServerInstance) {
      try { webServerInstance.close(); } catch {}
    }
    try {
      if (fs.existsSync(PID_FILE)) {
        const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
        if (parseInt(raw, 10) === process.pid) fs.unlinkSync(PID_FILE);
      }
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/**
 * 统一 CLI 入口调度函数
 */
export function runDaemon(cliOptions = {}) {
  // 若显式指定 foreground / once / dryRun，则前台直接运行
  if (cliOptions.foreground || cliOptions.once || cliOptions.dryRun) {
    return runDaemonForeground(cliOptions);
  }

  // 否则默认进入后台运行模式
  return startDaemonBackground(cliOptions);
}
