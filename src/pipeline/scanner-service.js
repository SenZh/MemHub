import { registry } from '../adapters/index.js';
import { KnowledgeExtractor } from './extractor.js';
import { getDatabase, recordKnowledge } from '../storage.js';
import { getConfig } from '../config.js';

/**
 * 离线会话扫描与提炼调度服务 (Scanner Service)
 *
 * 职责：
 *  1. 从适配器(默认 OpenCode)选出符合条件的候选会话（静默完成态 + 可选最近N天窗口 + 未处理）；
 *  2. 对每个会话调 KnowledgeExtractor.extractAll 产出"可能的多张不同类型卡片"；
 *  3. 逐张以 recordKnowledge(mode:'upsert') 落库 —— 同一 session 同一分类同一主题会原地覆盖更新，
 *     不同主题/不同分类则各成一张，真正实现"同一 session 抽取多类型记忆 + 防重复"；
 *  4. 在统一权威表 session_tracking（schema 由 storage 提供并自愈）记录状态与产物 id 数组。
 *
 * 注：session_tracking 的 schema 在 src/storage.js 中统一维护，本类不再各自建表，
 *     根治"同名表两套列定义"导致的既有 P0 冲突。
 */
export class ScannerService {
  constructor(adapter = null) {
    this.adapter = adapter || registry.get('opencode');
    this.db = getDatabase();
  }

  /** 已处理(EXTRACTED/SKIPPED/FAILED 不再重试)的会话 id 集合，用于防重复扫描 */
  getProcessedSessionIds() {
    const rows = this.db.prepare(`
      SELECT session_id FROM session_tracking 
      WHERE status IN ('EXTRACTED', 'SKIPPED')
    `).all();
    return new Set(rows.map(r => r.session_id));
  }

  /**
   * 执行单次批量离线扫描 (注入全局配置与动态规则)
   * @param {Object|number} options
   *   - limit: 本次最多处理数
   *   - windowDays: [仅 daemon] 只扫最近 N 天更新的会话；手动 scan 不传则不过滤
   */
  scanAndProcess(options = {}) {
    const limit = typeof options === 'number' ? options : (options.limit || 2);
    const globalConfig = getConfig();

    if (!this.adapter || !this.adapter.isAvailable()) {
      return { success: false, message: `适配器不可用或未安装` };
    }

    const excludeIds = this.getProcessedSessionIds();
    const candidates = this.adapter.scanCandidateSessions({
      limit,
      excludeIds,
      idleMinutes: options.idleMinutes ?? globalConfig.idleMinutes,
      scanRules: options.scanRules ?? globalConfig.scanRules,
      windowDays: options.windowDays,
      force: options.force
    });

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
   * 处理单个候选会话：读取上下文 -> extractAll 多卡 -> 逐张 upsert 落库 -> 状态机归档。
   */
  processSingleSession(session) {
    const now = Date.now();

    // 1. 状态加锁（插入占位并推进 attempts，防止并发/超时重复处理）
    this.db.prepare(`
      INSERT INTO session_tracking (
        session_id, source, source_agent, project, project_path, session_title,
        status, attempts, locked_until, time_processed, updated_at
      ) VALUES (?, 'opencode', ?, ?, ?, ?, 'EXTRACTING', 1, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        source_agent = excluded.source_agent,
        project_path = excluded.project_path,
        session_title = excluded.session_title,
        status = 'EXTRACTING',
        attempts = attempts + 1,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
    `).run(
      session.id, this.adapter.name, session.projectPath,
      session.projectPath, session.title,
      now + 180000, now, now
    );

    // 2. 从适配器读取上下文
    const textBlocks = this.adapter.readSessionContext(session.id);

    // 3. 领域层多卡萃取（含 Truth Gate；空则跳过）
    const entities = KnowledgeExtractor.extractAll(session, textBlocks);

    if (!Array.isArray(entities) || entities.length === 0) {
      this.db.prepare(`
        UPDATE session_tracking 
        SET status = 'SKIPPED', updated_at = ? 
        WHERE session_id = ?
      `).run(Date.now(), session.id);
      return { status: 'skipped', reason: 'no significant knowledge' };
    }

    // 4. 基础设施层逐张落库（upsert：同 session+category+主题原地覆盖，不同主题新增）
    const cardIds = [];
    const titles = [];
    for (const entity of entities) {
      const rec = recordKnowledge({ ...entity, mode: 'upsert' });
      if (rec && rec.id) {
        cardIds.push(rec.id);
        if (rec.title) titles.push(rec.title);
      }
    }

    // 5. 状态机归档：card_id 存产物 id 数组(JSON)，兼容单卡读取
    this.db.prepare(`
      UPDATE session_tracking 
      SET status = 'EXTRACTED', card_id = ?, extracted_kb_ids = ?, updated_at = ?
      WHERE session_id = ?
    `).run(JSON.stringify(cardIds), JSON.stringify(cardIds), Date.now(), session.id);

    return {
      status: 'extracted',
      cardIds,
      cardId: cardIds[0] || null,
      title: titles[0] || null,
      titles
    };
  }
}
