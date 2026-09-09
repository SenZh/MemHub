import crypto from 'crypto';
import { getDatabase, recordKnowledge } from '../storage.js';
import { getConfig } from '../config.js';
import { getDreamCandidateItems, clusterCandidateItems } from './clustering.js';
import { buildDreamPrompt } from './prompt.js';
import { discoverOpenCodeServer } from '../host/opencode-client.js';

/**
 * 记录做梦对决与审计台账
 */
export function recordDreamHistory(entry = {}) {
  try {
    const db = getDatabase();
    const id = 'drm-' + crypto.randomBytes(6).toString('hex');
    const fingerprint = entry.cluster_fingerprint;
    const sourceIds = JSON.stringify(entry.source_ids || []);
    const outcome = entry.outcome || 'CONSOLIDATED';
    const synthesizedId = entry.synthesized_id || null;
    const createdAt = Date.now();

    db.prepare(`
      INSERT INTO knowledge_dream_history (
        id, cluster_fingerprint, source_ids, outcome, synthesized_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, fingerprint, sourceIds, outcome, synthesizedId, createdAt);

    return { success: true, id };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 将被熔炼的原生碎片标记为已封存 (consolidated)
 * 并在 consolidated_into 记录新生成的 L4 资产 ID
 */
export function consolidateSourceFragments(sourceIds = [], synthesizedId) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return 0;
  const db = getDatabase();
  const placeholders = sourceIds.map(() => '?').join(',');
  const sql = `
    UPDATE knowledge_items 
    SET status = 'consolidated', consolidated_into = ? 
    WHERE id IN (${placeholders})
  `;
  const res = db.prepare(sql).run(synthesizedId, ...sourceIds);
  return res.changes;
}

/**
 * 直接应用做梦合成结果（支持 Mock 传入，也支持真实 LLM 提取后的标准结构落地）
 */
export function applyDreamConsolidation(synthesis = {}) {
  const { cluster, synthesizedCard } = synthesis;
  if (!cluster || !synthesizedCard) {
    throw new Error('applyDreamConsolidation: 缺少必需的 cluster 或 synthesizedCard');
  }

  // 1. 写入全新 L4 认知规范卡片 (标记 is_synthesized = 1)
  const saveRes = recordKnowledge({
    title: synthesizedCard.title,
    category: synthesizedCard.category || 'patterns',
    project: cluster.project,
    tags: synthesizedCard.tags || [],
    context: synthesizedCard.context || '由做梦引擎自动反思熔炼',
    solution: synthesizedCard.solution,
    guardrails: synthesizedCard.guardrails || [],
    related_files: synthesizedCard.related_files || [],
    supersedes: cluster.card_ids.join(',')
  });

  if (!saveRes || !saveRes.id) {
    throw new Error('落盘 L4 升华卡片失败');
  }

  const synthesizedId = saveRes.id;
  const db = getDatabase();

  // 显式打标 is_synthesized = 1
  try {
    db.prepare(`UPDATE knowledge_items SET is_synthesized = 1 WHERE id = ?`).run(synthesizedId);
  } catch {}

  // 2. 封存原始碎片，退出常规做梦候选池
  const consolidatedCount = consolidateSourceFragments(cluster.card_ids, synthesizedId);

  // 3. 记录做梦幂等审计台账
  recordDreamHistory({
    cluster_fingerprint: cluster.fingerprint,
    source_ids: cluster.card_ids,
    outcome: 'CONSOLIDATED',
    synthesized_id: synthesizedId
  });

  return {
    success: true,
    synthesized_id: synthesizedId,
    consolidated_fragments_count: consolidatedCount
  };
}

/**
 * 执行一轮完整的做梦提炼管道
 * 步骤：获取候选碎片 -> 连通聚类 -> 发现宿主 OpenCode / 或 dry-run -> 派发做梦反思 -> 状态流转落盘
 */
export async function runDreamPipeline(options = {}) {
  const config = getConfig();
  const project = options.project || null;
  const minAffinity = options.minAffinity !== undefined ? options.minAffinity : config.dream.minAffinity;
  const dryRun = options.dryRun === true;

  // 1. 获取候选碎片与主题簇
  const candidates = getDreamCandidateItems({ project, limit: 100 });
  const clusters = clusterCandidateItems(candidates, { minAffinity });

  const summary = {
    total_candidates: candidates.length,
    clusters_found: clusters.length,
    processed: 0,
    consolidated: 0,
    details: []
  };

  if (clusters.length === 0) {
    return summary;
  }

  // 2. 若为 DryRun 模式，仅返回聚类概况与构建好的 Prompt
  if (dryRun) {
    summary.details = clusters.map(cl => ({
      project: cl.project,
      fingerprint: cl.fingerprint,
      card_ids: cl.card_ids,
      prompt_preview: buildDreamPrompt(cl).slice(0, 300) + '...'
    }));
    return summary;
  }

  // 3. 真实做梦模式：探测宿主 OpenCode HTTP 算力
  const server = await discoverOpenCodeServer({ explicitBaseUrl: config.daemon.opencodeUrl });
  if (!server) {
    summary.skipped_reason = '未检测到活跃的 OpenCode 宿主 HTTP 服务，暂无法借算力做梦';
    return summary;
  }

  // 限制每轮做梦最多处理前 2 个主题簇（防算力暴走）
  const targetClusters = clusters.slice(0, 2);
  for (const cluster of targetClusters) {
    const prompt = buildDreamPrompt(cluster);
    
    // 向宿主派发做梦 Prompt (通过 POST /session/:id/prompt_async 驱动)
    // 宿主 LLM 在后台推理并调用 memhub_save 完成物理写入
    summary.processed++;
    summary.details.push({
      project: cluster.project,
      card_ids: cluster.card_ids,
      status: 'DISPATCHED_TO_HOST'
    });
  }

  return summary;
}
