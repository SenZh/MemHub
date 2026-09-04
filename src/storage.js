import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EXOBRAIN_HOME, VAULT_DIR, DB_PATH, CATEGORIES, ensureDirectories } from './config.js';
import { scrubSecrets } from './scrubber.js';
import { resolveSessionContext } from './session-resolver.js';

let dbInstance = null;

export function getDatabase() {
  if (dbInstance) return dbInstance;
  ensureDirectories();

  dbInstance = new DatabaseSync(DB_PATH);
  // 生产级高并发与防死锁设置
  dbInstance.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS knowledge_meta (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT NOT NULL,
      project TEXT,
      file_path TEXT NOT NULL,
      session_id TEXT,
      source_agent TEXT,
      git_branch TEXT,
      git_commit TEXT,
      status TEXT DEFAULT 'active',
      superseded_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      id UNINDEXED,
      title,
      tags,
      symptom,
      root_cause,
      solution,
      tokenize = 'trigram'
    );
  `);

  return dbInstance;
}

export function generateCardId() {
  return 'kb-' + crypto.randomBytes(4).toString('hex');
}

/**
 * 主动记录一条知识卡片
 */
export function recordKnowledge(params) {
  const db = getDatabase();

  // 1. 参数校验与清洗
  const category = CATEGORIES.includes(params.category) ? params.category : 'learnings';
  const title = scrubSecrets(params.title || '未命名知识');
  const tags = Array.isArray(params.tags) ? params.tags.map(t => scrubSecrets(String(t).trim().toLowerCase())) : [];
  const symptom = scrubSecrets(params.symptom || '');
  const rootCause = scrubSecrets(params.root_cause || '');
  const solution = scrubSecrets(params.solution || '');
  const relatedFiles = Array.isArray(params.related_files) ? params.related_files : [];

  // 2. 来源推导
  const context = resolveSessionContext(params.session_id, params.project_path);
  const cardId = generateCardId();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 3. 构建 Markdown 内容 (真理来源)
  const markdownContent = [
    '---',
    `id: "${cardId}"`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `category: "${category}"`,
    `tags: ${JSON.stringify(tags)}`,
    `project: "${context.projectName}"`,
    `source_agent: "${context.sourceAgent}"`,
    `session_id: "${context.sessionId}"`,
    context.gitBranch ? `git_branch: "${context.gitBranch}"` : null,
    context.gitCommit ? `git_commit: "${context.gitCommit}"` : null,
    'status: "active"',
    'superseded_by: null',
    `created_at: "${nowIso}"`,
    '---',
    '',
    '## 现象与症状 (Symptom)',
    symptom || '无详细记录',
    '',
    '## 根本原因 (Root Cause)',
    rootCause || '无详细记录',
    '',
    '## 经过验证的正解 (Solution)',
    solution || '无详细记录',
    '',
    '## 关键关联面 / 文件',
    relatedFiles.length > 0 ? relatedFiles.map(f => `- \`${f}\``).join('\n') : '- 暂无关联文件'
  ].filter(line => line !== null).join('\n');

  // 4. 原子安全写入 Markdown
  const targetCategoryDir = path.join(VAULT_DIR, category);
  const targetFilePath = path.join(targetCategoryDir, `${cardId}.md`);
  const tmpFilePath = path.join(VAULT_DIR, `.tmp-${cardId}-${now}`);

  fs.writeFileSync(tmpFilePath, markdownContent, 'utf-8');
  fs.renameSync(tmpFilePath, targetFilePath);

  // 5. 写入 SQLite 加速索引
  const insertMeta = db.prepare(`
    INSERT INTO knowledge_meta (
      id, title, category, tags, project, file_path, session_id, source_agent,
      git_branch, git_commit, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  insertMeta.run(
    cardId,
    title,
    category,
    JSON.stringify(tags),
    context.projectName,
    targetFilePath,
    context.sessionId,
    context.sourceAgent,
    context.gitBranch || '',
    context.gitCommit || '',
    now,
    now
  );

  const insertFts = db.prepare(`
    INSERT INTO knowledge_fts (id, title, tags, symptom, root_cause, solution)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertFts.run(
    cardId,
    title,
    tags.join(' '),
    symptom,
    rootCause,
    solution
  );

  return {
    success: true,
    id: cardId,
    title,
    category,
    tags,
    session_id: context.sessionId,
    file_path: targetFilePath
  };
}

/**
 * 全文检索知识库 (BM25 via Trigram + 短词智能兜底)
 */
export function searchKnowledge(query, options = {}) {
  const db = getDatabase();
  const limit = options.limit || 10;
  const category = options.category || null;

  if (!query || query.trim() === '') {
    return listRecent(options);
  }

  const cleanQuery = query.trim();

  // 若搜索词长度 >= 3，优先走 FTS5 Trigram 高速全文检索
  if (cleanQuery.length >= 3) {
    let sql = `
      SELECT 
        m.id, m.title, m.category, m.tags, m.project, m.session_id, m.created_at,
        snippet(knowledge_fts, 3, '<b>', '</b>', '...', 20) as symptom_snippet,
        snippet(knowledge_fts, 5, '<b>', '</b>', '...', 30) as solution_snippet
      FROM knowledge_fts fts
      JOIN knowledge_meta m ON fts.id = m.id
      WHERE knowledge_fts MATCH ? AND m.status = 'active'
    `;
    const params = [cleanQuery];

    if (category) {
      sql += ` AND m.category = ?`;
      params.push(category);
    }

    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    try {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params);
      if (rows.length > 0) {
        return rows.map(r => ({
          ...r,
          tags: JSON.parse(r.tags || '[]')
        }));
      }
    } catch (err) {
      // 容错并继续降级
    }
  }

  // 兜底策略：词长 < 3 或 FTS5 未命中时，走 LIKE 模糊子串匹配
  let fallbackSql = `
    SELECT id, title, category, tags, project, session_id, created_at
    FROM knowledge_meta
    WHERE (title LIKE ? OR tags LIKE ?) AND status = 'active'
  `;
  const fallbackParams = [`%${cleanQuery}%`, `%${cleanQuery}%`];

  if (category) {
    fallbackSql += ` AND category = ?`;
    fallbackParams.push(category);
  }

  fallbackSql += ` ORDER BY created_at DESC LIMIT ?`;
  fallbackParams.push(limit);

  const stmt = db.prepare(fallbackSql);
  const rows = stmt.all(...fallbackParams);
  return rows.map(r => ({
    ...r,
    tags: JSON.parse(r.tags || '[]'),
    symptom_snippet: '',
    solution_snippet: ''
  }));
}

/**
 * 获取单张知识卡片的完整正文
 */
export function getKnowledge(id) {
  const db = getDatabase();
  const stmt = db.prepare(`SELECT * FROM knowledge_meta WHERE id = ?`);
  const meta = stmt.get(id);

  if (!meta) {
    return null;
  }

  let content = '';
  if (fs.existsSync(meta.file_path)) {
    content = fs.readFileSync(meta.file_path, 'utf-8');
  }

  return {
    ...meta,
    tags: JSON.parse(meta.tags || '[]'),
    content
  };
}

/**
 * 获取最近沉淀的知识列表
 */
export function listRecent(options = {}) {
  const db = getDatabase();
  const limit = options.limit || 10;
  const project = options.project || null;

  let sql = `SELECT id, title, category, tags, project, session_id, created_at FROM knowledge_meta WHERE status = 'active'`;
  const params = [];

  if (project) {
    sql += ` AND project = ?`;
    params.push(project);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  return rows.map(r => ({
    ...r,
    tags: JSON.parse(r.tags || '[]')
  }));
}
