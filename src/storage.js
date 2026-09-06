import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MEMORY_HUB_HOME, DB_PATH, BACKUP_DIR, VAULT_DIR, getCategories, ensureDirectories } from './config.js';
import { scrubSecrets } from './scrubber.js';
import { resolveSessionContext } from './session-resolver.js';

let dbInstance = null;

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
      root_cause TEXT,
      solution_core TEXT NOT NULL,
      code_payload TEXT,
      session_id TEXT,
      source_agent TEXT,
      git_branch TEXT,
      git_commit TEXT,
      status TEXT DEFAULT 'active',
      superseded_by TEXT,
      supersedes TEXT,
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

    -- 3. 离线会话扫描与状态机
    CREATE TABLE IF NOT EXISTS session_tracking (
      session_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      project TEXT NOT NULL,
      status TEXT NOT NULL,
      extracted_kb_ids TEXT,
      time_processed INTEGER NOT NULL
    );
  `);

  return dbInstance;
}

export function generateCardId() {
  return 'kb-' + crypto.randomBytes(4).toString('hex');
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
 * 主动记录一条知识（写入单文件 SQLite，字段分层，前置查重与版本演进）
 */
export function recordKnowledge(params) {
  const db = getDatabase();

  // 1. 参数清洗与分类解析
  const validCategories = getCategories(params.project_path || process.cwd());
  const rawCategory = String(params.category || 'learnings').trim().toLowerCase();
  const category = validCategories.includes(rawCategory) ? rawCategory : 'learnings';

  const title = scrubSecrets(params.title || '未命名知识');
  const tags = Array.isArray(params.tags) 
    ? params.tags.map(t => scrubSecrets(String(t).trim().toLowerCase())) 
    : [];
  
  const symptom = scrubSecrets(params.symptom || '');
  const rootCause = scrubSecrets(params.root_cause || '');
  const solution = scrubSecrets(params.solution || '');
  const relatedFiles = Array.isArray(params.related_files) ? params.related_files : [];
  
  // 提取 100 字以内精简 summary（L1 摘要）与 solution_core
  const summary = scrubSecrets(params.summary || symptom.slice(0, 120) || '无详细现象记录');
  const solutionCore = solution.slice(0, 150) || '已验证修复措施';
  const codePayload = solution; // 完整代码正文（L2/L3）

  // 2. 上下文推导
  const context = resolveSessionContext(params.session_id, params.project_path);
  const now = Date.now();

  // 3. 前置查重逻辑（防重复录入）
  const existing = findDuplicateByTitle(title, context.projectName);
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

  // 4. 版本演进支持：如果声明了 supersedes，将旧版本标记为 superseded
  if (params.supersedes) {
    const updateOld = db.prepare(`
      UPDATE knowledge_items 
      SET status = 'superseded', superseded_by = ?, time_updated = ?
      WHERE id = ?
    `);
    updateOld.run(cardId, now, params.supersedes);
  }

  // 5. 写入核心实体表 (knowledge_items)
  const insertStmt = db.prepare(`
    INSERT INTO knowledge_items (
      id, project, category, title, summary, tags, related_files,
      root_cause, solution_core, code_payload, session_id, source_agent,
      git_branch, git_commit, status, superseded_by, supersedes,
      access_count, time_created, time_updated
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, 'active', null, ?,
      0, ?, ?
    )
  `);

  insertStmt.run(
    cardId,
    context.projectName,
    category,
    title,
    summary,
    JSON.stringify(tags),
    JSON.stringify(relatedFiles),
    rootCause,
    solutionCore,
    codePayload,
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

  return {
    success: true,
    id: cardId,
    title,
    category,
    tags,
    project: context.projectName,
    session_id: context.sessionId
  };
}

/**
 * 渐进式检索第一阶段：返回高密度 L1 索引与摘要 (~30-50 Tokens/条)
 */
export function searchKnowledge(query, options = {}) {
  const db = getDatabase();
  const limit = options.limit || 5;
  const category = options.category || null;
  const project = options.project || null;

  if (!query || query.trim() === '') {
    return listRecent(options);
  }

  const cleanQuery = query.trim();

  // 优先尝试 FTS5 Trigram 全文检索
  if (cleanQuery.length >= 3) {
    let sql = `
      SELECT 
        k.id, k.title, k.category, k.project, k.tags, k.summary, k.related_files, k.time_created
      FROM knowledge_fts fts
      JOIN knowledge_items k ON fts.id = k.id
      WHERE knowledge_fts MATCH ? AND k.status = 'active'
    `;
    const params = [cleanQuery];

    if (category) {
      sql += ` AND k.category = ?`;
      params.push(category);
    }
    if (project) {
      sql += ` AND (k.project = ? OR k.project = 'global')`;
      params.push(project);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params);
      if (rows.length > 0) {
        return rows.map(formatL1Result);
      }
    } catch (err) {}
  }

  // 降级策略：LIKE 模糊匹配
  let fallbackSql = `
    SELECT id, title, category, project, tags, summary, related_files, time_created
    FROM knowledge_items
    WHERE (title LIKE ? OR tags LIKE ? OR summary LIKE ?) AND status = 'active'
  `;
  const fallbackParams = [`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`];

  if (category) {
    fallbackSql += ` AND category = ?`;
    fallbackParams.push(category);
  }
  if (project) {
    fallbackSql += ` AND (project = ? OR project = 'global')`;
    fallbackParams.push(project);
  }

  fallbackSql += ` ORDER BY time_created DESC LIMIT ?`;
  fallbackParams.push(limit);

  const stmt = db.prepare(fallbackSql);
  const rows = stmt.all(...fallbackParams);
  return rows.map(formatL1Result);
}

function formatL1Result(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    project: row.project,
    tags: JSON.parse(row.tags || '[]'),
    summary: row.summary,
    related_files: JSON.parse(row.related_files || '[]'),
    created_at: Number(row.time_created)
  };
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

  // 格式化为 Markdown 呈现文本
  const tags = JSON.parse(item.tags || '[]');
  const relatedFiles = JSON.parse(item.related_files || '[]');
  
  const markdownView = [
    '---',
    `id: "${item.id}"`,
    `title: "${item.title.replace(/"/g, '\\"')}"`,
    `category: "${item.category}"`,
    `project: "${item.project}"`,
    `tags: ${JSON.stringify(tags)}`,
    `created_at: "${new Date(Number(item.time_created)).toISOString()}"`,
    item.session_id ? `session_id: "${item.session_id}"` : null,
    '---',
    '',
    '## 现象与摘要 (Symptom & Summary)',
    item.summary || '无详细现象',
    '',
    '## 深入技术根因 (Root Cause)',
    item.root_cause || '无详细记录',
    '',
    '## 经过验证的正解 (Solution & Code)',
    item.code_payload || item.solution_core || '无详细代码',
    '',
    '## 关键涉及文件',
    relatedFiles.length > 0 ? relatedFiles.map(f => `- \`${f}\``).join('\n') : '- 暂无关联文件'
  ].filter(line => line !== null).join('\n');

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
 * 最近知识列表
 */
export function listRecent(options = {}) {
  const db = getDatabase();
  const limit = options.limit || 10;
  const project = options.project || null;
  const category = options.category || null;

  let sql = `
    SELECT id, title, category, project, tags, summary, related_files, time_created 
    FROM knowledge_items 
    WHERE status = 'active'
  `;
  const params = [];

  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }
  if (category) {
    sql += ` AND category = ?`;
    params.push(category);
  }

  sql += ` ORDER BY time_created DESC LIMIT ?`;
  params.push(limit);

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
 * 统计全局与项目研发态势与资产 (hub stats)
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

  // 3. 已扫描会话数
  let sessSql = `SELECT status, COUNT(*) as count FROM session_tracking`;
  const sessParams = [];
  if (project) {
    sessSql += ` WHERE project = ?`;
    sessParams.push(project);
  }
  sessSql += ` GROUP BY status`;
  const sessionStats = db.prepare(sessSql).all(...sessParams);

  return {
    project: project || 'all_projects',
    total_knowledge_entries: totalCount,
    categories: categoryStats,
    sessions_scanned: sessionStats
  };
}
