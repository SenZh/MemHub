import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getConfig, MEMHUB_HOME, ensureDirectories } from './config.js';
import { getDatabase } from './storage.js';
import {
  discoverOpenCodeServer,
  listCandidateSessions,
  dispatchExtractionPrompt
} from './host/opencode-client.js';

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
  console.log(`   - 驱动模式: OpenCode HTTP 宿主驱动 (不 fork, 原地 LLM 复盘)`);
  if (dryRun) console.log(`   - [注意] 当前处于 dry-run 桩模式，不真发 POST 请求`);

  const db = getDatabase();
  let running = false;

  // 获取已处理过的 session_id 集合
  function getProcessedSessionIds() {
    if (force) return new Set();
    const rows = db.prepare(`
      SELECT session_id FROM session_tracking 
      WHERE status IN ('EXTRACTED', 'SKIPPED')
    `).all();
    return new Set(rows.map(r => r.session_id));
  }

  async function tick() {
    if (running) return; // 防止上一轮未跑完时重入
    running = true;
    const ts = new Date().toLocaleTimeString();
    console.log(`\n=== [${ts}] memhub daemon 触发一轮检查 ===`);

    try {
      // 1. 动态发现 OpenCode Server
      const baseUrl = await discoverOpenCodeServer({
        explicitBaseUrl: daemon.opencodeUrl || undefined,
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
        scanRules: cfg.scanRules
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

        // 调用 OpenCode HTTP 发送抽取 Prompt
        try {
          const res = await dispatchExtractionPrompt(baseUrl, {
            sessionId: session.id,
            dryRun,
            timeoutMs: 25000
          });

          if (dryRun) {
            console.log(`   [dry-run] 已生成沉淀指令桩（未发送）`);
          } else if (res.posted) {
            console.log(`   ✅ 已成功注入沉淀指令，宿主 LLM 正在会话内复盘提炼并调用 memhub_save`);
            // 更新 tracking 状态为 EXTRACTED
            db.prepare(`
              UPDATE session_tracking 
              SET status = 'EXTRACTED', updated_at = ? 
              WHERE session_id = ?
            `).run(Date.now(), session.id);
          } else {
            console.warn(`   ⚠️ 注入指令返回异常 HTTP ${res.httpStatus}`);
          }
        } catch (e) {
          console.error(`   ❌ 驱动抽取失败: ${e.message}`);
          db.prepare(`
            UPDATE session_tracking 
            SET status = 'FAILED', updated_at = ? 
            WHERE session_id = ?
          `).run(Date.now(), session.id);
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
  tick();
  const timer = setInterval(tick, intervalMinutes * 60 * 1000);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[memhub daemon] 收到退出信号，正在优雅退出...');
    clearInterval(timer);
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
