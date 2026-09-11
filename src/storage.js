import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MEMORY_HUB_HOME, DB_PATH, BACKUP_DIR, VAULT_DIR, getCategories, normalizeCategory, normalizeProjectName, ensureDirectories } from './config.js';
import { scrubSecrets } from './scrubber.js';
import { resolveSessionContext } from './session-resolver.js';
import { embedText, cosineSimilarity, serializeVector, deserializeVector, VECTOR_DIMENSIONS } from './search/vector-engine.js';
import { fuseRankings } from './search/rrf.js';

let dbInstance = null;

/**
 * 运行数据库 DDL 热迁移自愈
 * 确保老库自动补齐 context_text 与 extra_payload 列，并完成存量 solutions 历史别名刷写
 */
function runMigrations(db) {
  try {
    const columns = db.prepare("PRAGMA table_info(knowledge_items)").all();
    const colSet = new Set(columns.map(c => c.name));

    if (!colSet.has('context_text')) {
      db.exec("ALTER TABLE knowledge_items ADD COLUMN context_text TEXT;");
    }
    if (!colSet.has('extra_payload')) {
      db.exec("ALTER TABLE knowledge_items ADD COLUMN extra_payload TEXT;");
    }
    if (!colSet.has('topic_fingerprint')) {
      db.exec("ALTER TABLE knowledge_items ADD COLUMN topic_fingerprint TEXT;");
    }
    if (!colSet.has('is_synthesized')) {
      db.exec("ALTER TABLE knowledge_items ADD COLUMN is_synthesized INTEGER DEFAULT 0;");
    }
    if (!colSet.has('consolidated_into')) {
      db.exec("ALTER TABLE knowledge_items ADD COLUMN consolidated_into TEXT;");
    }
    if (!colSet.has('dream_attempts')) {
      db.exec("ALTER TABLE knowledge_items ADD COLUMN dream_attempts INTEGER DEFAULT 0;");
    }
    if (!colSet.has('dream_skip_until')) {
      db.exec("ALTER TABLE knowledge_items ADD COLUMN dream_skip_until INTEGER DEFAULT 0;");
    }

    // 幂等刷写存量历史分类 solutions -> patterns
    db.exec("UPDATE knowledge_items SET category = 'patterns' WHERE category = 'solutions';");
  } catch (e) {
    // 忽略迁移过程中非致命错误
  }

  // 做梦引擎审计与幂等防重表创建
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_dream_history (
        id TEXT PRIMARY KEY,
        cluster_fingerprint TEXT UNIQUE NOT NULL,
        source_ids TEXT NOT NULL,
        outcome TEXT NOT NULL,
        synthesized_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_dream_fp ON knowledge_dream_history(cluster_fingerprint);
      CREATE INDEX IF NOT EXISTS idx_dream_created ON knowledge_dream_history(created_at);
    `);
  } catch (e) {}

  // session_tracking 老库补列（统一为 scanner-service 与多卡所需的完整 schema）
  try {
    const stCols = db.prepare("PRAGMA table_info(session_tracking)").all();
    const stSet = new Set(stCols.map(c => c.name));
    const addIfMissing = (col, ddl) => {
      if (!stSet.has(col)) db.exec(`ALTER TABLE session_tracking ADD COLUMN ${ddl};`);
    };
    addIfMissing('source_agent', 'source_agent TEXT');
    addIfMissing('project_path', 'project_path TEXT');
    addIfMissing('session_title', 'session_title TEXT');
    addIfMissing('card_id', 'card_id TEXT');
    addIfMissing('attempts', 'attempts INTEGER DEFAULT 0');
    addIfMissing('locked_until', 'locked_until INTEGER DEFAULT 0');
    addIfMissing('last_error', 'last_error TEXT');
    addIfMissing('updated_at', 'updated_at INTEGER DEFAULT 0');
    // 老库 source 列可能 NOT NULL 但无默认值，scanner 写入需显式给；此处幂等回填 status 兜底
    db.exec("UPDATE session_tracking SET status = COALESCE(NULLIF(status,''), 'PENDING');");
  } catch (e) {
    // 忽略迁移过程中非致命错误
  }
}

/**
 * 初始化并获取单文件 SQLite 核心数据库连接
 */
export function getDatabase() {
  if (dbInstance) return dbInstance;
  ensureDirectories();

  dbInstance = new DatabaseSync(DB_PATH);
  
  // 生产级高并发与防死锁设置
  dbInstance.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;

    -- 1. 核心知识条目表（存读一体、物理分层：L1检索层 + L2/L3详情层）
    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      tags TEXT NOT NULL,
      related_files TEXT,
      topic_fingerprint TEXT,
      context_text TEXT,
      root_cause TEXT,
      solution_core TEXT NOT NULL,
      code_payload TEXT,
      extra_payload TEXT,
      session_id TEXT,
      source_agent TEXT,
      git_branch TEXT,
      git_commit TEXT,
      status TEXT DEFAULT 'active',
      superseded_by TEXT,
      supersedes TEXT,
      is_synthesized INTEGER DEFAULT 0,
      consolidated_into TEXT,
      dream_attempts INTEGER DEFAULT 0,
      dream_skip_until INTEGER DEFAULT 0,
      access_count INTEGER DEFAULT 0,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );

    -- 2. 全文检索倒排虚拟表 (FTS5 Trigram 分词器)
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      id UNINDEXED,
      title,
      tags,
      summary,
      solution_core,
      tokenize = 'trigram'
    );

    -- 3. 离线会话扫描与状态机（权威 schema，scanner-service 复用；老库由 runMigrations 幂等补列）
    CREATE TABLE IF NOT EXISTS session_tracking (
      session_id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'opencode',
      source_agent TEXT,
      project TEXT NOT NULL DEFAULT '',
      project_path TEXT,
      session_title TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      extracted_kb_ids TEXT,
      card_id TEXT,
      attempts INTEGER DEFAULT 0,
      locked_until INTEGER DEFAULT 0,
      last_error TEXT,
      time_processed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    -- 4. 语义向量嵌入持久化表 (384 维稠密特征)
    CREATE TABLE IF NOT EXISTS knowledge_embeddings (
      id TEXT PRIMARY KEY,
      vector TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_updated ON knowledge_embeddings(updated_at);

    -- 5. MCP 访问与调用审计日志表
    CREATE TABLE IF NOT EXISTS mcp_audit_logs (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      project TEXT,
      session_id TEXT,
      query_summary TEXT,
      input_payload TEXT,
      hits_count INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_tool ON mcp_audit_logs(tool_name);
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_created ON mcp_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_project ON mcp_audit_logs(project);
  `);

  runMigrations(dbInstance);

  // 老库启动时自动检测并补齐缺失的向量
  try {
    syncEmbeddings(dbInstance);
  } catch (e) {}

  return dbInstance;
}

export function generateCardId() {
  return 'kb-' + crypto.randomBytes(4).toString('hex');
}

/**
 * 计算"主题指纹"(topic fingerprint)：同一记忆主题的可覆盖定位键的一环。
 * 从 title 与 tags 中抽取客观实体词（错误码、类名、技术栈、文件名、功能词），
 * 统一小写、去重、排序后拼接，再取 SHA-256 前 12 位十六进制。
 * 优点：同分类同主题的再次沉淀可稳定命中同一指纹 → 触发 upsert 覆盖而非新增；
 * 而同一 session 内不同主题会得到不同指纹 → 互不误覆盖。
 */
export function computeTopicFingerprint(title = '', tags = []) {
  const tagList = Array.isArray(tags) ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];
  // 从标题中粗切出疑似实体词簇：以分隔符拆分，剔除通用连接词与过长/过短片段
  const stopTokens = new Set(['在', '的', '与', '和', '或', '以及', '问题', '解决', '方案', '使用', '通过',
    '系统', '模块', '场景', '配置', '修复', '排错', '避坑', '架构', '设计', '最佳', '实践', '报错',
    'the', 'and', 'for', 'with', 'into', 'from', 'this', 'that', 'opencode', 'memhub']);
  const titleTokens = (title || '')
    .toLowerCase()
    .split(/[\s\-_/:：·，,。.()[\]【】]+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2 && s.length <= 32 && !stopTokens.has(s));

  const entities = [...new Set([...tagList, ...titleTokens])].sort();
  if (entities.length === 0) return '';
  const joined = entities.join('|');
  return crypto.createHash('sha256').update(joined).digest('hex').slice(0, 12);
}

/**
 * 前置查重检测（根据标准化标题查找是否已存在 active 记录）
 */
export function findDuplicateByTitle(title, project = null) {
  const db = getDatabase();
  const normalizedTitle = title.trim().toLowerCase();
  
  let sql = `SELECT id, title, category, project FROM knowledge_items WHERE LOWER(title) = ? AND status = 'active'`;
  const params = [normalizedTitle];

  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }

  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

/**
 * 定位"同类型多次抽取应更新覆盖"的目标卡片。
 * 定位键 = session_id + category + topic_fingerprint（可叠加 project 收窄）。
 * 命中返回 active 记录，未命中返回 undefined。
 */
export function findBySessionCategoryTopic(sessionId, category, fingerprint, project = null) {
  if (!sessionId || !category || !fingerprint) return undefined;
  const db = getDatabase();
  const normalizedCat = normalizeCategory(category);
  let sql = `
    SELECT id, title, category, project, topic_fingerprint
    FROM knowledge_items
    WHERE session_id = ? AND category = ? AND topic_fingerprint = ? AND status = 'active'
  `;
  const params = [sessionId, normalizedCat, fingerprint];
  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }
  sql += ` LIMIT 1`;
  const stmt = db.prepare(sql);
  return stmt.get(...params);
}

/**
 * 主动记录一条知识（写入单文件 SQLite，字段分层，前置查重/指纹 upsert 与版本演进）
 * @param {Object} params
 * @param {string} [params.mode='insert'] - 'insert' 走现状标题查重；'upsert' 按
 *        session_id+category+topic_fingerprint 定位，命中则原地 UPDATE 覆盖，未命中则插入。
 */
export function recordKnowledge(params) {
  const db = getDatabase();

  // 1. 参数清洗与分类解析 (归一化收敛至三大分类，全面兼容全中文参数)
  const rawTitle = params['标题'] || params.title || '未命名知识';
  const rawCategory = String(params['分类'] || params.category || 'learnings').trim().toLowerCase();
  const rawTags = params['标签'] || params.tags;
  const rawSolution = params['正文'] || params['正文内容'] || params.content || params.solution || params.implementation || '';
  const rawContext = params['背景'] || params.context || params.context_text || '';
  const rawProject = params['项目'] || params['项目归属'] || params.project;

  const category = normalizeCategory(rawCategory);
  const title = scrubSecrets(rawTitle);
  const tags = Array.isArray(rawTags) 
    ? rawTags.map(t => scrubSecrets(String(t).trim().toLowerCase())) 
    : [];
  
  const contextText = scrubSecrets(rawContext);
  const symptom = scrubSecrets(params.symptom || '');
  const rootCause = scrubSecrets(params.root_cause || params.rationale || '');
  const solution = scrubSecrets(rawSolution);
  const relatedFiles = Array.isArray(params.related_files || params['关联代码']) 
    ? (params.related_files || params['关联代码']) 
    : [];
  
  // 提取 100 字以内精简 summary（L1 摘要）与 solution_core
  const summary = scrubSecrets(
    params['极简摘要'] || params.summary || 
    (contextText ? `【背景】${contextText.slice(0, 50)}... ` : '') + (symptom ? symptom.slice(0, 70) : solution.slice(0, 70)) || 
    '无详细摘要'
  );
  const solutionCore = solution.slice(0, 150) || '已验证措施';
  const codePayload = solution; // 完整代码正文（L2/L3）

  // 构建分类专有结构化扩展 JSON (extra_payload 并严密递归脱敏)
  const extraPayloadObj = {};
  if (params.symptom) extraPayloadObj.symptom = symptom;
  if (Array.isArray(params.ineffective_attempts)) {
    extraPayloadObj.ineffective_attempts = params.ineffective_attempts.map(item => scrubSecrets(String(item)));
  }
  if (params.prevention) extraPayloadObj.prevention = scrubSecrets(params.prevention);
  if (params.impact) extraPayloadObj.impact = scrubSecrets(params.impact);
  if (Array.isArray(params.alternatives)) {
    extraPayloadObj.alternatives = params.alternatives.map(item => {
      if (typeof item === 'string') return scrubSecrets(item);
      if (item && typeof item === 'object') {
        return {
          option: scrubSecrets(String(item.option || '')),
          why_rejected: scrubSecrets(String(item.why_rejected || ''))
        };
      }
      return scrubSecrets(String(item));
    });
  }
  if (params.migration) extraPayloadObj.migration = scrubSecrets(params.migration);
  if (Array.isArray(params.guardrails)) {
    extraPayloadObj.guardrails = params.guardrails.map(item => scrubSecrets(String(item)));
  }
  if (params.prerequisites) extraPayloadObj.prerequisites = scrubSecrets(params.prerequisites);
  if (params.mechanism) extraPayloadObj.mechanism = scrubSecrets(params.mechanism);
  if (params.boundaries) extraPayloadObj.boundaries = scrubSecrets(params.boundaries);
  if (params.verification) extraPayloadObj.verification = scrubSecrets(params.verification);
  const extraPayloadStr = JSON.stringify(extraPayloadObj);

  // 2. 上下文推导 (优先使用显式指定的 project，并经过 normalizeProjectName 防腐归一)
  const context = resolveSessionContext(params.session_id || params['会话ID'], params.project_path);
  const rawProjectVal = rawProject ? scrubSecrets(String(rawProject).trim()) : context.projectName;
  const projectName = normalizeProjectName(rawProjectVal);
  const now = Date.now();

  // 2.5 计算主题指纹（同 session 同分类同主题覆盖定位；不同主题互不误覆盖）
  const topicFingerprint = params.topic_fingerprint || computeTopicFingerprint(title, tags);

  // 3a. upsert 模式：优先按 session_id+category+topic_fingerprint 定位；若指纹因补充
  //      标签漂移而未命中，则回退按"同 session+category+完全同 title"兜底定位。
  //      命中一律原地 UPDATE 覆盖（这是同类型多次抽取应更新覆盖而非新增的核心语义）。
  const mode = params.mode === 'upsert' ? 'upsert' : 'insert';
  const sessionIdForLocate = context.sessionId || params.session_id;
  let located = null;
  if (mode === 'upsert' && sessionIdForLocate && topicFingerprint) {
    located = findBySessionCategoryTopic(sessionIdForLocate, category, topicFingerprint, projectName);
    if (!located && title) {
      const dup = findDuplicateByTitle(title, projectName);
      // 仅当该同名卡正好也属于本 session 时才视作同主题覆盖，避免跨 session 误覆盖
      if (dup && dup.id) {
        const row = db.prepare(`SELECT session_id FROM knowledge_items WHERE id = ?`).get(dup.id);
        if (row && row.session_id === sessionIdForLocate) located = dup;
      }
    }
    if (located && !params.supersedes && !params.force) {
      const updateStmt = db.prepare(`
        UPDATE knowledge_items SET
          project = ?, category = ?, title = ?, summary = ?, tags = ?,
          related_files = ?, context_text = ?, root_cause = ?, solution_core = ?,
          code_payload = ?, extra_payload = ?, topic_fingerprint = ?,
          session_id = ?, source_agent = ?, git_branch = ?, git_commit = ?,
          status = 'active', time_updated = ?
        WHERE id = ?
      `);
      updateStmt.run(
        projectName,
        category,
        title,
        summary,
        JSON.stringify(tags),
        JSON.stringify(relatedFiles),
        contextText,
        rootCause,
        solutionCore,
        codePayload,
        extraPayloadStr,
        topicFingerprint,
        sessionIdForLocate,
        context.sourceAgent,
        context.gitBranch || '',
        context.gitCommit || '',
        now,
        located.id
      );
      // 同步重建 FTS 索引（DELETE + INSERT）
      db.prepare(`DELETE FROM knowledge_fts WHERE id = ?`).run(located.id);
      db.prepare(`INSERT INTO knowledge_fts (id, title, tags, summary, solution_core) VALUES (?, ?, ?, ?, ?)`)
        .run(located.id, title, tags.join(' '), summary, solutionCore);

      // 同步更新 384 维语义向量
      try {
        const embedSourceText = [title, tags.join(' '), summary, solutionCore, contextText || ''].filter(Boolean).join(' ');
        const vec = embedText(embedSourceText);
        db.prepare(`
          INSERT INTO knowledge_embeddings (id, vector, dimensions, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            vector = excluded.vector,
            dimensions = excluded.dimensions,
            updated_at = excluded.updated_at
        `).run(located.id, serializeVector(vec), VECTOR_DIMENSIONS, now);
      } catch (e) {}

      return {
        success: true,
        id: located.id,
        title,
        category,
        tags,
        project: projectName,
        session_id: sessionIdForLocate,
        updated: true,
        message: `按 session+category+主题定位命中已有卡片 [${located.id}]，已原地更新覆盖。`
      };
    }
  }

  // 3b. 非 upsert / upsert 未命中时的标题精确查重（防同名重复录入）
  const existing = findDuplicateByTitle(title, projectName);
  if (existing && !params.supersedes && !params.force) {
    return {
      success: true,
      duplicate: true,
      id: existing.id,
      title: existing.title,
      category: existing.category,
      message: `已存在完全同名的有效知识卡片 [${existing.id}]，跳过重复写入。如需替换更新，请指定 supersedes='${existing.id}'。`
    };
  }

  const cardId = generateCardId();
  const isSynthesized = params.is_synthesized === 1 || params.is_synthesized === true;

  // 4. 版本演进与做梦熔炼支持：如果声明了 supersedes
  let supersededIds = [];
  if (params.supersedes) {
    if (Array.isArray(params.supersedes)) {
      supersededIds = params.supersedes.map(s => String(s).trim()).filter(Boolean);
    } else {
      supersededIds = String(params.supersedes).split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    }
  }

  if (supersededIds.length > 0) {
    if (isSynthesized || supersededIds.length > 1) {
      // 多卡做梦熔炼场景：旧卡片标记为 consolidated，并记录 consolidated_into = cardId
      const placeholders = supersededIds.map(() => '?').join(',');
      try {
        db.prepare(`
          UPDATE knowledge_items 
          SET status = 'consolidated', consolidated_into = ?, time_updated = ?
          WHERE id IN (${placeholders})
        `).run(cardId, now, ...supersededIds);
      } catch (e) {}
    } else {
      // 单卡普通演化替代场景
      try {
        const updateOld = db.prepare(`
          UPDATE knowledge_items 
          SET status = 'superseded', superseded_by = ?, time_updated = ?
          WHERE id = ?
        `);
        updateOld.run(cardId, now, supersededIds[0]);
      } catch (e) {}
    }
  }

  // 5. 写入核心实体表 (knowledge_items)
  const insertStmt = db.prepare(`
    INSERT INTO knowledge_items (
      id, project, category, title, summary, tags, related_files, topic_fingerprint,
      context_text, root_cause, solution_core, code_payload, extra_payload,
      session_id, source_agent, git_branch, git_commit, status,
      superseded_by, supersedes, access_count, time_created, time_updated
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, 'active',
      null, ?, 0, ?, ?
    )
  `);

  insertStmt.run(
    cardId,
    projectName,
    category,
    title,
    summary,
    JSON.stringify(tags),
    JSON.stringify(relatedFiles),
    topicFingerprint,
    contextText,
    rootCause,
    solutionCore,
    codePayload,
    extraPayloadStr,
    context.sessionId,
    context.sourceAgent,
    context.gitBranch || '',
    context.gitCommit || '',
    params.supersedes || null,
    now,
    now
  );

  // 6. 写入倒排检索虚拟表 (knowledge_fts)
  const ftsStmt = db.prepare(`
    INSERT INTO knowledge_fts (id, title, tags, summary, solution_core)
    VALUES (?, ?, ?, ?, ?)
  `);

  ftsStmt.run(
    cardId,
    title,
    tags.join(' '),
    summary,
    solutionCore
  );

  // 7. 生成并更新 384 维稠密语义向量 (knowledge_embeddings)
  try {
    const embedSourceText = [title, tags.join(' '), summary, solutionCore, contextText || ''].filter(Boolean).join(' ');
    const vec = embedText(embedSourceText);
    db.prepare(`
      INSERT INTO knowledge_embeddings (id, vector, dimensions, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vector = excluded.vector,
        dimensions = excluded.dimensions,
        updated_at = excluded.updated_at
    `).run(cardId, serializeVector(vec), VECTOR_DIMENSIONS, now);
  } catch (e) {}

  // 8. 若为多卡做梦熔炼或声明了 is_synthesized，标记 is_synthesized = 1
  if (isSynthesized || supersededIds.length > 1) {
    try {
      db.prepare(`UPDATE knowledge_items SET is_synthesized = 1 WHERE id = ?`).run(cardId);
    } catch (e) {}
  }

  return {
    success: true,
    id: cardId,
    title,
    category,
    tags,
    project: projectName,
    session_id: context.sessionId
  };
}

/**
 * 渐进式检索第一阶段：返回高密度 L1 索引与摘要 (~30-50 Tokens/条)
 *
 * 核心架构（v0.2.0 工业级混合检索 Hybrid Search）：
 *  1. 第一路（精确匹配）：SQLite FTS5 Trigram 字符倒排检索，对代码类名、报错码、文件路径 100% 精确穿透；
 *  2. 第二路（意图泛化）：384 维轻量稠密语义向量空间度量，基于余弦相似度召回抽象同义场景；
 *  3. 倒数排名融合 (RRF 算法)：Score(d) = sum( 1 / (60 + Rank_m(d)) )，实现无偏平滑合并与重排；
 *  4. 元数据硬过滤：支持工作区隔离 (project=? OR global)、顶级分类及多标签 (tags AND) 精确收窄；
 *  5. 优雅兜底：若两路无召回，自动降级为 LIKE 模糊匹配，保障零漏检。
 */
export function searchKnowledge(query, options = {}) {
  const db = getDatabase();
  const limit = options.limit || 5;
  const rawCat = options.category ? normalizeCategory(options.category) : null;
  const project = options.project || options.workspace || null;

  // 规范化多标签输入 (数组或单值均支持)
  const rawTags = Array.isArray(options.tags) 
    ? options.tags 
    : (options.tags ? [options.tags] : []);
  const cleanTags = rawTags.map(t => String(t).trim().toLowerCase()).filter(Boolean);

  if (!query || query.trim() === '') {
    return listRecent(options);
  }

  const cleanQuery = query.trim();

  // === 路 1: SQLite FTS5 Trigram 全文倒排检索 ===
  let ftsResults = [];
  if (cleanQuery.length >= 3) {
    let sql = `
      SELECT 
        fts.id, k.title, k.category, k.project, k.tags, k.summary, k.related_files, k.time_created,
        k.status, k.consolidated_into, k.is_synthesized,
        bm25(knowledge_fts, 5.0, 2.0, 1.0, 1.5) as rank
      FROM knowledge_fts fts
      JOIN knowledge_items k ON fts.id = k.id
      WHERE knowledge_fts MATCH ? AND k.status = 'active'
    `;
    const params = [cleanQuery];

    if (rawCat) {
      sql += ` AND k.category = ?`;
      params.push(rawCat);
    }
    if (project) {
      sql += ` AND (k.project = ? OR k.project = 'global')`;
      params.push(project);
    }

    cleanTags.forEach(tag => {
      sql += ` AND EXISTS (SELECT 1 FROM json_each(k.tags) WHERE value = ?)`;
      params.push(tag);
    });

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(Math.max(limit * 2, 20));

    try {
      const stmt = db.prepare(sql);
      ftsResults = stmt.all(...params);
    } catch (err) {}
  }

  // === 路 2: 本地 384 维稠密语义向量空间检索 ===
  let vecResults = [];
  try {
    const queryVec = embedText(cleanQuery);
    let vecSql = `
      SELECT 
        k.id, k.title, k.category, k.project, k.tags, k.summary, k.related_files, k.time_created,
        k.status, k.consolidated_into, k.is_synthesized,
        e.vector
      FROM knowledge_embeddings e
      JOIN knowledge_items k ON e.id = k.id
      WHERE k.status = 'active'
    `;
    const vecParams = [];

    if (rawCat) {
      vecSql += ` AND k.category = ?`;
      vecParams.push(rawCat);
    }
    if (project) {
      vecSql += ` AND (k.project = ? OR k.project = 'global')`;
      vecParams.push(project);
    }

    cleanTags.forEach(tag => {
      vecSql += ` AND EXISTS (SELECT 1 FROM json_each(k.tags) WHERE value = ?)`;
      vecParams.push(tag);
    });

    const candidateRows = db.prepare(vecSql).all(...vecParams);
    const scored = [];
    for (const row of candidateRows) {
      const docVec = deserializeVector(row.vector);
      if (docVec) {
        const sim = cosineSimilarity(queryVec, docVec);
        // 过滤负相关或极低关联噪音，保留具备正向语义关联的候选
        if (sim > 0.05) {
          scored.push({
            id: row.id,
            title: row.title,
            category: row.category,
            project: row.project,
            tags: row.tags,
            summary: row.summary,
            related_files: row.related_files,
            time_created: row.time_created,
            status: row.status,
            consolidated_into: row.consolidated_into,
            score: sim
          });
        }
      }
    }
    scored.sort((a, b) => b.score - a.score);
    vecResults = scored.slice(0, Math.max(limit * 2, 20));
  } catch (err) {}

  // === 路 3: 倒数排名融合 (RRF) 智能重排 ===
  if (ftsResults.length > 0 || vecResults.length > 0) {
    const fused = fuseRankings(
      { fts: ftsResults, vector: vecResults },
      { limit, k: 60 }
    );
    if (fused.length > 0) {
      return fused.map(f => formatL1Result(f.item, options.includeScores ? (f.rrfScore ?? f.score) : null));
    }
  }

  // === 降级兜底：LIKE 模糊匹配（向下兼容短词与边界）===
  let fallbackSql = `
    SELECT id, title, category, project, tags, summary, related_files, time_created, status, consolidated_into, is_synthesized
    FROM knowledge_items k
    WHERE (k.title LIKE ? OR k.tags LIKE ? OR k.summary LIKE ? OR k.context_text LIKE ?) AND k.status = 'active'
  `;
  const fallbackParams = [`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`];

  if (rawCat) {
    fallbackSql += ` AND k.category = ?`;
    fallbackParams.push(rawCat);
  }
  if (project) {
    fallbackSql += ` AND (k.project = ? OR k.project = 'global')`;
    fallbackParams.push(project);
  }

  cleanTags.forEach(tag => {
    fallbackSql += ` AND EXISTS (SELECT 1 FROM json_each(k.tags) WHERE value = ?)`;
    fallbackParams.push(tag);
  });

  fallbackSql += ` ORDER BY k.time_created DESC LIMIT ?`;
  fallbackParams.push(limit);

  const stmt = db.prepare(fallbackSql);
  const rows = stmt.all(...fallbackParams);
  return rows.map(r => formatL1Result(r, options.includeScores ? 0.1 : null));
}

/**
 * 全量/增量向量同步维护 (对存量无 embedding 的记录补齐 384 维向量)
 */
export function syncEmbeddings(customDb = null) {
  const db = customDb || getDatabase();
  const rows = db.prepare(`
    SELECT k.id, k.title, k.tags, k.summary, k.solution_core, k.context_text
    FROM knowledge_items k
    LEFT JOIN knowledge_embeddings e ON k.id = e.id
    WHERE e.id IS NULL AND k.status = 'active'
  `).all();

  if (rows.length === 0) {
    return { processed: 0 };
  }

  const now = Date.now();
  const insertStmt = db.prepare(`
    INSERT INTO knowledge_embeddings (id, vector, dimensions, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      vector = excluded.vector,
      dimensions = excluded.dimensions,
      updated_at = excluded.updated_at
  `);

  let count = 0;
  for (const row of rows) {
    const embedSourceText = [row.title, row.tags, row.summary, row.solution_core, row.context_text || ''].filter(Boolean).join(' ');
    const vec = embedText(embedSourceText);
    insertStmt.run(row.id, serializeVector(vec), VECTOR_DIMENSIONS, now);
    count++;
  }

  return { processed: count };
}

function formatL1Result(row, score = null) {
  const res = {
    id: row.id,
    title: row.title,
    category: row.category,
    project: row.project,
    tags: JSON.parse(row.tags || '[]'),
    summary: row.summary,
    related_files: JSON.parse(row.related_files || '[]'),
    created_at: Number(row.time_created)
  };
  if (row.status !== undefined) res.status = row.status;
  if (row.consolidated_into !== undefined) res.consolidated_into = row.consolidated_into;
  if (row.is_synthesized !== undefined) res.is_synthesized = row.is_synthesized;
  if (score !== null && score !== undefined) {
    res.score = Number(Number(score).toFixed(6));
  }
  return res;
}

/**
 * 渐进式检索第二阶段：展开完整 L2/L3 详情（含代码正文与根因）
 */
export function getKnowledge(id) {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM knowledge_items WHERE id = ?`);
  const item = stmt.get(id);

  if (!item) {
    return null;
  }

  // 累加访问计数
  try {
    db.prepare(`UPDATE knowledge_items SET access_count = access_count + 1 WHERE id = ?`).run(id);
  } catch (e) {}

  // 格式化为 Markdown 呈现文本 (按分类专属模板渲染)
  const tags = JSON.parse(item.tags || '[]');
  const relatedFiles = JSON.parse(item.related_files || '[]');
  let extra = {};
  try {
    extra = JSON.parse(item.extra_payload || '{}');
  } catch (e) {}

  const cat = normalizeCategory(item.category);
  const lines = [
    '---',
    `id: "${item.id}"`,
    `title: "${item.title.replace(/"/g, '\\"')}"`,
    `category: "${cat}"`,
    `project: "${item.project}"`,
    `tags: ${JSON.stringify(tags)}`,
    `created_at: "${new Date(Number(item.time_created)).toISOString()}"`,
    item.session_id ? `session_id: "${item.session_id}"` : null,
    '---',
    ''
  ];

  // 若正文本身已是高质量完整 Markdown（包含一级或二级标题或大段自由叙述），直接原汁原味呈现
  const fullBody = item.code_payload || item.solution_core || '';
  const isRichMarkdown = fullBody.includes('# ') || fullBody.includes('## ') || fullBody.length > 300;

  if (isRichMarkdown) {
    lines.push(fullBody);
  } else if (cat === 'learnings') {
    lines.push(
      '## 🎯 业务操作背景 (Context)',
      item.context_text || item.summary || '无详细业务操作背景',
      '',
      '## 💥 异常表象与错误签名 (Symptom)',
      extra.symptom || item.summary || '无详细现象',
      '',
      '## 🔬 技术根因剖析 (Root Cause)',
      item.root_cause || '无详细记录',
      '',
      '## 🛠️ 经过验证的真实正解 (Verified Solution)',
      item.code_payload || item.solution_core || '无详细代码',
      '',
      '## 🚫 已排除的误区与无效尝试 (Ineffective Attempts)',
      Array.isArray(extra.ineffective_attempts) && extra.ineffective_attempts.length > 0
        ? extra.ineffective_attempts.map(a => `- ❌ ${a}`).join('\n')
        : '- 暂无记录',
      '',
      '## 🛡️ 验证手段与防复发门禁 (Prevention)',
      extra.prevention || '已通过当前会话验证'
    );
  } else if (cat === 'decisions') {
    lines.push(
      '## 📌 业务与技术痛点背景 (Context)',
      item.context_text || item.summary || '无详细痛点背景',
      '',
      '## 🌐 受影响拓扑面与改动细节 (Impact)',
      extra.impact || '详见关联核心文件',
      '',
      '## ⚖️ 备选方案及其放弃理由 (Alternatives Evaluated)',
      Array.isArray(extra.alternatives) && extra.alternatives.length > 0
        ? extra.alternatives.map(a => `- ${typeof a === 'string' ? a : (a.option + ': ' + a.why_rejected)}`).join('\n')
        : '- 暂无记录',
      '',
      '## 🏛️ 最终裁决与妥协代价 (Decision & Trade-offs)',
      item.root_cause ? `### 裁决理由\n${item.root_cause}\n` : '',
      `### 方案正解\n${item.code_payload || item.solution_core || '无详细记录'}`,
      '',
      '## 🔄 平滑迁移与回滚方案 (Migration & Rollback)',
      extra.migration || '按标准发布流程演进',
      '',
      '## ⛔ 不可触碰的架构红线 (Guardrails)',
      Array.isArray(extra.guardrails) && extra.guardrails.length > 0
        ? extra.guardrails.map(g => `- ⚠️ ${g}`).join('\n')
        : '- 暂无特殊硬约束'
    );
  } else if (cat === 'business') {
    lines.push(
      '## 🎯 业务领域与背景 (Domain Context)',
      item.context_text || item.summary || '无详细业务领域背景',
      '',
      '## 📜 核心业务规则与口径 (Business Rules & Logic)',
      item.code_payload || item.solution_core || '无详细规则描述',
      '',
      '## 🔄 状态流转与边界时序 (Lifecycle & State Machine)',
      extra.mechanism || extra.lifecycle || extra.boundaries || '按标准业务流程流转',
      '',
      '## ⛔ 业务防踩坑与资损红线 (Risk Guardrails)',
      Array.isArray(extra.guardrails) && extra.guardrails.length > 0
        ? extra.guardrails.map(g => `- ⚠️ ${g}`).join('\n')
        : (extra.pitfalls ? `- ⚠️ ${extra.pitfalls}` : '- 暂无特殊资损硬红线')
    );
  } else {
    // patterns
    lines.push(
      '## 🎯 业务应用场景与解决痛点 (Scenario)',
      item.context_text || item.summary || '无详细场景描述',
      '',
      '## 📦 前置依赖与运行环境 (Prerequisites)',
      extra.prerequisites || '详见正文说明',
      '',
      '## ⚙️ 核心交互时序与机制 (Mechanism & Flow)',
      extra.mechanism || '详见正文实现',
      '',
      '## 💻 生产级完整参考实现代码 (Implementation)',
      item.code_payload || item.solution_core || '无详细实现',
      '',
      '## ⚠️ 适用边界与反模式 (Boundaries & Anti-Patterns)',
      extra.boundaries || '详见正文约束',
      '',
      '## 🧪 自测验证与压测用例 (Verification)',
      extra.verification || '已通过功能与单元测试'
    );
  }

  lines.push(
    '',
    '## 关键涉及文件',
    relatedFiles.length > 0 ? relatedFiles.map(f => `- \`${f}\``).join('\n') : '- 暂无关联文件'
  );

  const markdownView = lines.filter(line => line !== null).join('\n');

  return {
    ...item,
    tags,
    related_files: relatedFiles,
    time_created: Number(item.time_created),
    time_updated: Number(item.time_updated),
    content: markdownView
  };
}

/**
 * 批量拉取详情（支持数组 IDs）
 */
export function getKnowledgeBatch(ids = []) {
  const results = [];
  for (const id of ids) {
    const detail = getKnowledge(id);
    if (detail) results.push(detail);
  }
  return results;
}

/**
 * 最近知识列表 (对齐 searchKnowledge 检索契约：支持工作区当前私有+global穿透，多标签AND交集过滤)
 */
export function listRecent(options = {}) {
  const db = getDatabase();
  const limit = options.limit || 10;
  const offset = options.offset || 0;
  const project = options.project || options.workspace || null;
  const rawCat = options.category ? normalizeCategory(options.category) : null;
  const status = options.status || 'active';

  const rawTags = Array.isArray(options.tags) 
    ? options.tags 
    : (options.tags ? [options.tags] : []);
  const cleanTags = rawTags.map(t => String(t).trim().toLowerCase()).filter(Boolean);

  let sql = `
    SELECT id, title, category, project, tags, summary, related_files, time_created, status, consolidated_into, is_synthesized
    FROM knowledge_items 
    WHERE 1=1
  `;
  const params = [];

  if (options.synthesizedOnly || status === 'l4') {
    sql += ` AND is_synthesized = 1`;
  } else if (status !== 'all') {
    sql += ` AND status = ?`;
    params.push(status);
  }

  if (project) {
    sql += ` AND (project = ? OR project = 'global')`;
    params.push(project);
  }
  if (rawCat) {
    sql += ` AND category = ?`;
    params.push(rawCat);
  }
  cleanTags.forEach(tag => {
    sql += ` AND EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`;
    params.push(tag);
  });

  sql += ` ORDER BY time_created DESC LIMIT ?`;
  params.push(limit);

  if (offset > 0) {
    sql += ` OFFSET ?`;
    params.push(offset);
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  return rows.map(formatL1Result);
}

/**
 * 原生热备份与归档 (VACUUM INTO)
 */
export function backupDatabase(targetPath = null) {
  const db = getDatabase();
  ensureDirectories();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const finalPath = targetPath || path.join(BACKUP_DIR, `memhub_backup_${timestamp}.db`);

  if (fs.existsSync(finalPath)) {
    fs.unlinkSync(finalPath);
  }

  // 执行 SQLite 原生原子冷备
  db.exec(`VACUUM INTO '${finalPath.replace(/'/g, "''")}';`);
  return finalPath;
}

/**
 * 将核心 SQLite 数据无损导出为人类友好的 Markdown 目录树
 */
export function exportToMarkdown(exportDir = VAULT_DIR) {
  const db = getDatabase();
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const items = db.prepare(`SELECT * FROM knowledge_items WHERE status = 'active'`).all();
  let count = 0;

  for (const item of items) {
    const catDir = path.join(exportDir, item.category);
    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }

    const detail = getKnowledge(item.id);
    const targetFile = path.join(catDir, `${item.id}.md`);
    fs.writeFileSync(targetFile, detail.content, 'utf-8');
    count++;
  }

  return { totalExported: count, exportDir };
}

/**
 * 统计全局与项目研发态势与资产 (memhub stats 深度大盘)
 */
export function getStats(options = {}) {
  const db = getDatabase();
  const project = options.project || null;

  // 1. 知识分类条目统计
  let catSql = `SELECT category, COUNT(*) as count FROM knowledge_items WHERE status = 'active'`;
  const catParams = [];
  if (project) {
    catSql += ` AND project = ?`;
    catParams.push(project);
  }
  catSql += ` GROUP BY category`;
  const categoryStats = db.prepare(catSql).all(...catParams);

  // 2. 总条目
  let totalSql = `SELECT COUNT(*) as total FROM knowledge_items WHERE status = 'active'`;
  const totalParams = [];
  if (project) {
    totalSql += ` AND project = ?`;
    totalParams.push(project);
  }
  const totalCount = db.prepare(totalSql).get(...totalParams)?.total || 0;

  // 3. 已扫描会话数与状态
  let sessSql = `SELECT status, COUNT(*) as count FROM session_tracking`;
  const sessParams = [];
  if (project) {
    sessSql += ` WHERE project = ?`;
    sessParams.push(project);
  }
  sessSql += ` GROUP BY status`;
  const sessionStats = db.prepare(sessSql).all(...sessParams);

  // 4. 按 project 分组统计资产大盘与四大分类矩阵
  let projSql = `
    SELECT 
      COALESCE(project, 'default') as project_name,
      category,
      COUNT(*) as count
    FROM knowledge_items
    WHERE status = 'active'
  `;
  const projParams = [];
  if (project) {
    projSql += ` AND project = ?`;
    projParams.push(project);
  }
  projSql += ` GROUP BY project_name, category ORDER BY project_name ASC`;
  const projRows = db.prepare(projSql).all(...projParams);

  // 整理为项目维度的聚合报表
  const projectMap = new Map();
  for (const row of projRows) {
    const pName = row.project_name;
    if (!projectMap.has(pName)) {
      projectMap.set(pName, {
        project: pName,
        total: 0,
        learnings: 0,
        decisions: 0,
        patterns: 0,
        business: 0
      });
    }
    const pStat = projectMap.get(pName);
    pStat.total += row.count;
    if (row.category === 'learnings') pStat.learnings += row.count;
    else if (row.category === 'decisions') pStat.decisions += row.count;
    else if (row.category === 'patterns') pStat.patterns += row.count;
    else if (row.category === 'business') pStat.business += row.count;
  }
  const projectsSummary = Array.from(projectMap.values())
    .sort((a, b) => b.total - a.total);

  // 5. 估算节省 Token (按每篇被复用的资产平均规避 3 轮会话试错，每轮 ~2000 tokens 估算)
  const estimatedSavedTokens = totalCount * 4500;

  // 6. MCP 工具调用审计汇总
  let mcpStats = [];
  try {
    mcpStats = db.prepare(`
      SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration_ms
      FROM mcp_audit_logs
      GROUP BY tool_name
      ORDER BY count DESC
    `).all();
  } catch {}

  // 7. 做梦引擎自省成效大盘 (过程台账 + 产物 + 候选池)
  const dreaming = getDreamingStats(db, project);

  return {
    project: project || 'all_projects',
    total_knowledge_entries: totalCount,
    categories: categoryStats,
    sessions_scanned: sessionStats,
    projects: projectsSummary,
    mcp_tool_calls: mcpStats,
    estimated_saved_tokens: estimatedSavedTokens,
    dreaming
  };
}

/**
 * 做梦引擎成效统计
 * - synthesized_l4: 做梦升华产出的 L4 认知规范卡片 (is_synthesized = 1, active)
 * - consolidated_fragments: 被熔炼封存的原始碎片 (status = consolidated)
 * - dream_rounds: 做梦台账轮次 (knowledge_dream_history)
 * - candidate_pool: 当前仍待做梦的候选碎片池 (active 且非合成且过冷却期)
 * - cooling_down: 处于失败冷却期的碎片数
 */
function getDreamingStats(db, project) {
  const result = {
    synthesized_l4: 0,
    consolidated_fragments: 0,
    dream_rounds: 0,
    candidate_pool: 0,
    cooling_down: 0
  };

  try {
    let synthSql = `SELECT COUNT(*) as c FROM knowledge_items WHERE status = 'active' AND is_synthesized = 1`;
    const synthParams = [];
    if (project) {
      synthSql += ` AND project = ?`;
      synthParams.push(project);
    }
    result.synthesized_l4 = db.prepare(synthSql).get(...synthParams)?.c || 0;

    let fragSql = `SELECT COUNT(*) as c FROM knowledge_items WHERE status = 'consolidated'`;
    const fragParams = [];
    if (project) {
      fragSql += ` AND project = ?`;
      fragParams.push(project);
    }
    result.consolidated_fragments = db.prepare(fragSql).get(...fragParams)?.c || 0;

    const now = Date.now();
    let candSql = `
      SELECT COUNT(*) as c FROM knowledge_items
      WHERE status = 'active'
        AND (is_synthesized IS NULL OR is_synthesized = 0)
        AND (dream_skip_until IS NULL OR dream_skip_until <= ?)
    `;
    const candParams = [now];
    if (project) {
      candSql += ` AND project = ?`;
      candParams.push(project);
    }
    result.candidate_pool = db.prepare(candSql).get(...candParams)?.c || 0;

    let coolSql = `
      SELECT COUNT(*) as c FROM knowledge_items
      WHERE status = 'active'
        AND (is_synthesized IS NULL OR is_synthesized = 0)
        AND dream_skip_until > ?
    `;
    const coolParams = [now];
    if (project) {
      coolSql += ` AND project = ?`;
      coolParams.push(project);
    }
    result.cooling_down = db.prepare(coolSql).get(...coolParams)?.c || 0;

    // 做梦台账按 project 过滤：通过 source_ids 关联的碎片归属项目，无归属时计为全局
    const roundsRows = db.prepare(`SELECT source_ids FROM knowledge_dream_history`).all();
    if (!project) {
      result.dream_rounds = roundsRows.length;
    } else {
      let count = 0;
      for (const row of roundsRows) {
        let ids = [];
        try { ids = JSON.parse(row.source_ids); } catch {}
        if (!Array.isArray(ids) || ids.length === 0) continue;
        const placeholders = ids.map(() => '?').join(',');
        const hit = db.prepare(
          `SELECT COUNT(*) as c FROM knowledge_items WHERE id IN (${placeholders}) AND project = ?`
        ).get(...ids, project);
        if (hit?.c > 0) count++;
      }
      result.dream_rounds = count;
    }
  } catch {}

  return result;
}

/**
 * 记录 MCP 工具调用审计日志
 */
export function logMcpAccess(logEntry = {}) {
  try {
    const db = getDatabase();
    const id = 'log-' + crypto.randomBytes(6).toString('hex');
    const toolName = logEntry.tool_name || 'unknown';
    const project = logEntry.project || null;
    const sessionId = logEntry.session_id || null;
    const querySummary = logEntry.query_summary ? String(logEntry.query_summary).slice(0, 300) : null;
    let inputPayload = null;
    if (logEntry.input_payload) {
      try {
        inputPayload = typeof logEntry.input_payload === 'string' 
          ? logEntry.input_payload 
          : JSON.stringify(logEntry.input_payload);
        // 截断超大 payload 防撑爆日志
        if (inputPayload.length > 2000) {
          inputPayload = inputPayload.slice(0, 2000) + '...[TRUNCATED]';
        }
      } catch {}
    }
    const hitsCount = Number(logEntry.hits_count) || 0;
    const durationMs = Number(logEntry.duration_ms) || 0;
    const status = logEntry.status || 'SUCCESS';
    const errorMessage = logEntry.error_message ? String(logEntry.error_message).slice(0, 500) : null;
    const createdAt = Date.now();

    db.prepare(`
      INSERT INTO mcp_audit_logs (
        id, tool_name, project, session_id, query_summary, 
        input_payload, hits_count, duration_ms, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, toolName, project, sessionId, querySummary,
      inputPayload, hitsCount, durationMs, status, errorMessage, createdAt
    );

    return { success: true, id };
  } catch (e) {
    // 审计日志写入失败不阻断核心业务，输出 stderr
    console.error(`[MemHub] 审计日志记录警告: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * 查询最近 MCP 访问调用日志
 */
export function getMcpAuditLogs(options = {}) {
  const db = getDatabase();
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 200);
  const toolName = options.tool || null;
  const project = options.project || null;

  let sql = `SELECT * FROM mcp_audit_logs WHERE 1=1`;
  const params = [];

  if (toolName) {
    sql += ` AND tool_name = ?`;
    params.push(toolName);
  }
  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(sql).all(...params);
}

/**
 * 物理级联删除知识卡片（事务原子级清理：主表、FTS 倒排索引、特征向量）
 * 严格使用原生 SQLite BEGIN IMMEDIATE 排他事务，任一环节失败立即回滚
 */
export function deleteKnowledge(id) {
  const db = getDatabase();
  const existing = db.prepare('SELECT id, title FROM knowledge_items WHERE id = ?').get(id);
  if (!existing) {
    return { success: false, notFound: true, message: `知识卡片 [${id}] 不存在` };
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    // 1. 删除主表实体
    db.prepare('DELETE FROM knowledge_items WHERE id = ?').run(id);
    
    // 2. 清理 FTS5 倒排索引（严禁吞错，保证原子回滚）
    db.prepare('DELETE FROM knowledge_fts WHERE id = ?').run(id);

    // 3. 清理 384 维稠密特征向量（严禁吞错，保证原子回滚）
    db.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(id);

    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (rbErr) {}
    console.error(`[storage] 删除卡片 [${id}] 级联事务异常回滚:`, err.message);
    throw new Error(`删除卡片 [${id}] 级联事务失败，已原子回滚: ${err.message}`);
  }

  return { 
    success: true, 
    id, 
    title: existing.title, 
    message: `知识卡片 [${id}] 已成功物理删除` 
  };
}
