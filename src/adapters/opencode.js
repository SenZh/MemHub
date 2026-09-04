import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { AgentAdapter } from './base.js';

export class OpenCodeAdapter extends AgentAdapter {
  constructor(customDbPath = null) {
    super('opencode');
    this.dbPath = customDbPath || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  }

  isAvailable() {
    return fs.existsSync(this.dbPath);
  }

  _getDb() {
    if (!this.isAvailable()) {
      throw new Error(`OpenCode 数据库不存在: ${this.dbPath}`);
    }
    return new DatabaseSync(this.dbPath, { readOnly: true });
  }

  scanCandidateSessions(options = {}) {
    if (!this.isAvailable()) return [];
    const limit = options.limit || 10;
    const excludeIds = options.excludeIds || new Set();

    const db = this._getDb();
    const query = `
      SELECT id, title, directory, time_created, time_updated, model
      FROM session
      WHERE parent_id IS NULL
        AND title NOT LIKE '[ExoBrain]%'
      ORDER BY time_updated DESC
      LIMIT ?
    `;
    const candidates = db.prepare(query).all(limit * 2);

    const results = [];
    for (const c of candidates) {
      if (excludeIds.has(c.id)) continue;
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
