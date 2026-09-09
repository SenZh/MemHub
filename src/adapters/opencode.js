import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { AgentAdapter } from './base.js';
import { PathFilter } from '../path-filter.js';
import { getConfig } from '../config.js';
import { isSubagentSession } from '../host/opencode-client.js';

export class OpenCodeAdapter extends AgentAdapter {
  constructor(customDbPath = null) {
    super('opencode');
    this.dbPath = customDbPath || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
    this._db = null;
  }

  isAvailable() {
    return fs.existsSync(this.dbPath);
  }

  _getDb() {
    if (!this.isAvailable()) {
      throw new Error(`OpenCode 数据库不存在: ${this.dbPath}`);
    }
    if (!this._db) {
      this._db = new DatabaseSync(this.dbPath, { readOnly: true });
    }
    return this._db;
  }

  close() {
    if (this._db) {
      try {
        this._db.close();
      } catch (e) {}
      this._db = null;
    }
  }

  /**
   * 扫描符合条件的候选会话
   * 结合动态 idleMinutes 与 PathFilter 规则引擎（watchDirectories/include/exclude）
   */
  scanCandidateSessions(options = {}) {
    if (!this.isAvailable()) return [];
    const limit = options.limit || 10;
    const excludeIds = options.excludeIds || new Set();

    // 仅在未传入时才按需读取配置（避免冗余 I/O）
    let idleMinutes = options.idleMinutes;
    let scanRules = options.scanRules;

    if (idleMinutes === undefined || !scanRules) {
      const globalConfig = getConfig();
      if (idleMinutes === undefined) idleMinutes = globalConfig.idleMinutes;
      if (!scanRules) scanRules = globalConfig.scanRules;
    }

    const idleMs = (idleMinutes ?? 120) * 60 * 1000;
    const forceScan = Boolean(options.force);
    const now = Date.now();

    // 可选"最近 N 天窗口"上界：仅当显式传入 windowDays（daemon 调度）时启用，
    // 将扫描范围收窄为 [now - windowDays, now - idleMs]；手动 scan 不传则维持原逻辑。
    const windowDays = options.windowDays;
    const windowMs = typeof windowDays === 'number' && windowDays > 0 ? windowDays * 86400000 : null;

    // 构建路径过滤器
    const filter = new PathFilter(scanRules);

    const db = this._getDb();
    let sql = `
      SELECT id, title, directory, time_created, time_updated, model
      FROM session
      WHERE parent_id IS NULL
        AND title NOT LIKE '[ExoBrain]%'
        AND title NOT LIKE '[MemoryHub]%'
        AND title NOT LIKE '[MemHub]%'
        AND (time_updated < (? - ?) OR ? = 1)
    `;
    const params = [now, idleMs, forceScan ? 1 : 0];
    // 上界窗口：time_updated 不得早于 now - windowDays（只扫最近 windowDays 天内的会话）
    if (windowMs && !forceScan) {
      sql += ` AND time_updated >= ?`;
      params.push(now - windowMs);
    }
    sql += ` ORDER BY time_updated DESC LIMIT ?`;
    params.push(limit * 4);

    const candidates = db.prepare(sql).all(...params);

    const results = [];
    for (const c of candidates) {
      if (excludeIds.has(c.id)) continue;

      // 统一门禁：排除任何可能的 Subagent
      if (isSubagentSession(c)) continue;

      // 路径规则与白名单/黑名单过滤
      if (!filter.isMatch(c.directory)) {
        continue;
      }

      results.push({
        id: c.id,
        title: c.title,
        projectPath: c.directory,
        timeCreated: Number(c.time_created),
        timeUpdated: Number(c.time_updated),
        model: c.model
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  readSessionContext(sessionId) {
    if (!this.isAvailable()) return [];
    const db = this._getDb();
    const partsQuery = `
      SELECT data FROM part 
      WHERE session_id = ? AND data LIKE '%text%'
      ORDER BY time_created ASC
    `;
    const parts = db.prepare(partsQuery).all(sessionId);

    const textBlocks = [];
    for (const p of parts) {
      try {
        const parsed = JSON.parse(p.data);
        if (parsed.text && typeof parsed.text === 'string') {
          textBlocks.push(parsed.text);
        }
      } catch (e) {}
    }
    return textBlocks;
  }

  resolveActiveSessionId(cwd) {
    if (!this.isAvailable()) return null;
    try {
      const db = this._getDb();
      const normalizedCwd = path.resolve(cwd).toLowerCase();
      const stmt = db.prepare(`
        SELECT id, directory, time_updated 
        FROM session 
        ORDER BY time_updated DESC 
        LIMIT 10
      `);
      const recent = stmt.all();

      for (const s of recent) {
        if (s.directory && path.resolve(s.directory).toLowerCase() === normalizedCwd) {
          return s.id;
        }
      }

      if (recent.length > 0 && Date.now() - Number(recent[0].time_updated) < 5 * 60 * 1000) {
        return recent[0].id;
      }
    } catch (err) {
      return null;
    }
    return null;
  }
}
