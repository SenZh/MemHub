import { registry } from '../adapters/index.js';
import { KnowledgeExtractor } from './extractor.js';
import { getDatabase, recordKnowledge } from '../storage.js';

export class ScannerService {
  constructor(adapter = null) {
    this.adapter = adapter || registry.get('opencode');
    this.db = getDatabase();
    this._ensureTrackingTable();
  }

  _ensureTrackingTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_tracking (
        session_id TEXT PRIMARY KEY,
        source_agent TEXT NOT NULL,
        project_path TEXT,
        session_title TEXT,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'EXTRACTING', 'EXTRACTED', 'SKIPPED', 'FAILED')),
        attempts INTEGER DEFAULT 0,
        locked_until INTEGER DEFAULT 0,
        last_error TEXT,
        card_id TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getProcessedSessionIds() {
    const rows = this.db.prepare(`
      SELECT session_id FROM session_tracking 
      WHERE status IN ('EXTRACTED', 'SKIPPED')
    `).all();
    return new Set(rows.map(r => r.session_id));
  }

  /**
   * 执行单次批量离线扫描
   */
  scanAndProcess(limit = 2) {
    if (!this.adapter || !this.adapter.isAvailable()) {
      return { success: false, message: `适配器不可用或未安装` };
    }

    const excludeIds = this.getProcessedSessionIds();
    const candidates = this.adapter.scanCandidateSessions({ limit, excludeIds });

    const results = [];
    for (const session of candidates) {
      const res = this.processSingleSession(session);
      results.push({ sessionId: session.id, ...res });
    }

    return {
      success: true,
      processedCount: results.length,
      results
    };
  }

  /**
   * 处理单个候选会话
   */
  processSingleSession(session) {
    const now = Date.now();

    // 1. 状态加锁
    this.db.prepare(`
      INSERT INTO session_tracking (session_id, source_agent, project_path, session_title, status, attempts, locked_until, updated_at)
      VALUES (?, ?, ?, ?, 'EXTRACTING', 1, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        status = 'EXTRACTING',
        attempts = attempts + 1,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
    `).run(session.id, this.adapter.name, session.projectPath, session.title, now + 180000, now);

    // 2. 从适配器读取上下文
    const textBlocks = this.adapter.readSessionContext(session.id);

    // 3. 领域层知识萃取
    const entity = KnowledgeExtractor.extract(session, textBlocks);

    if (!entity) {
      this.db.prepare(`
        UPDATE session_tracking 
        SET status = 'SKIPPED', updated_at = ? 
        WHERE session_id = ?
      `).run(Date.now(), session.id);
      return { status: 'skipped', reason: 'no significant knowledge' };
    }

    // 4. 基础设施层落盘
    const recordResult = recordKnowledge(entity);

    // 5. 状态机归档
    this.db.prepare(`
      UPDATE session_tracking 
      SET status = 'EXTRACTED', card_id = ?, updated_at = ?
      WHERE session_id = ?
    `).run(recordResult.id, Date.now(), session.id);

    return {
      status: 'extracted',
      cardId: recordResult.id,
      title: recordResult.title
    };
  }
}
