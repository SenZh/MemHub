import crypto from 'crypto';
import { getDatabase, recordKnowledge } from '../storage.js';
import { getConfig } from '../config.js';
import { getDreamCandidateItems, clusterCandidateItems } from './clustering.js';
import { buildDreamPrompt } from './prompt.js';
import { 
  discoverOpenCodeServer,
  createSession,
  dispatchSessionPrompt,
  waitForSessionIdle,
  readSessionMessages,
  deleteSession
} from '../host/opencode-client.js';

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
    prerequisites: synthesizedCard.prerequisites || '',
    mechanism: synthesizedCard.mechanism || '',
    boundaries: synthesizedCard.boundaries || '',
    verification: synthesizedCard.verification || '',
    supersedes: cluster.card_ids.join(','),
    is_synthesized: 1
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
 * 尝试从宿主 LLM 回复中解析标准 JSON 格式的做梦升华卡片
 */
export function parseSynthesizedCard(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. 检查是否显式放弃熔炼
  if (/放弃熔炼/i.test(text) || /无法抽象/i.test(text) || /不建议合并/i.test(text)) {
    return { rejected: true };
  }

  // 2. 匹配 ```json ... ``` 代码块
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const rawJson = jsonMatch ? jsonMatch[1] : text;

  // 3. 尝试定位第一个 { 到最后一个 }
  const startIdx = rawJson.indexOf('{');
  const endIdx = rawJson.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  try {
    const candidate = JSON.parse(rawJson.slice(startIdx, endIdx + 1));
    const title = candidate.title || candidate['标题'];
    const solution = candidate.content || candidate['正文'] || candidate['正文内容'] || candidate.solution || '';
    if (candidate && typeof candidate === 'object' && title && solution) {
      return {
        rejected: false,
        card: {
          title: String(title).trim(),
          category: candidate.category || candidate['分类'] || 'patterns',
          tags: Array.isArray(candidate.tags || candidate['标签']) ? (candidate.tags || candidate['标签']) : [],
          context: candidate.context || candidate['背景'] || '',
          solution: solution,
          guardrails: Array.isArray(candidate.guardrails) ? candidate.guardrails : [],
          related_files: Array.isArray(candidate.related_files) ? candidate.related_files : []
        }
      };
    }
  } catch {}

  return null;
}

/**
 * 执行一轮完整的做梦提炼管道
 * 步骤：获取候选碎片 -> 连通聚类 -> 发现宿主 OpenCode / 或 dry-run -> 创建做梦独立沙箱 -> 派发反思 -> 状态机落盘与清理
 */
export async function runDreamPipeline(options = {}) {
  const config = getConfig();
  const project = options.project || null;
  const minAffinity = options.minAffinity !== undefined ? options.minAffinity : config.dream.minAffinity;
  const dryRun = options.dryRun === true;
  const force = options.force === true;
  const db = getDatabase();

  // 1. 获取候选碎片与主题簇
  const candidates = getDreamCandidateItems({ project, limit: 100, force });
  const clusters = clusterCandidateItems(candidates, { minAffinity, force });

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
  const maxBatches = Number(options.limit) || 2;
  const targetClusters = clusters.slice(0, maxBatches);

  for (const cluster of targetClusters) {
    const prompt = buildDreamPrompt(cluster);
    let dreamSessionId = null;
    const startTime = Date.now();

    try {
      if (typeof options.onProgress === 'function') {
        options.onProgress('start', cluster);
      }

      // 步骤 1：创建专用的做梦独立沙箱会话
      const sessionObj = await createSession(server, {
        title: `[MemHub] AI做梦自省: ${cluster.project} (${cluster.card_ids.length}碎片)`,
        directory: process.cwd(),
        timeoutMs: 15000
      });
      dreamSessionId = sessionObj?.id;
      if (!dreamSessionId) {
        throw new Error('未能创建做梦沙箱会话');
      }

      // 步骤 2：向做梦会话注入架构反思 Prompt
      await dispatchSessionPrompt(server, dreamSessionId, prompt, { timeoutMs: 25000 });

      // 步骤 3：轮询等待会话 idle（或超时）
      await waitForSessionIdle(server, dreamSessionId, {
        pollIntervalMs: 3000,
        maxWaitMs: 300000,
        onWait: (st, ms) => {
          if (typeof options.onProgress === 'function' && ms > 0 && ms % 15000 < 3000) {
            options.onProgress('waiting', { cluster, status: st, waitedMs: ms });
          }
        }
      });

      // 步骤 4：落盘与结果核验（双轨判定：优先 MCP memhub_save，次选 JSON 解析）
      const checkSql = `
        SELECT id, title, supersedes, is_synthesized, status, time_created 
        FROM knowledge_items 
        WHERE time_created >= ?
        ORDER BY time_created DESC LIMIT 10
      `;
      const recentCards = db.prepare(checkSql).all(startTime - 5000);
      let mcpSynthesizedCard = null;
      for (const card of recentCards) {
        const cardSupersedes = String(card.supersedes || '');
        const matchesCluster = cluster.card_ids.some(cid => cardSupersedes.includes(cid));
        if (card.is_synthesized === 1 || matchesCluster) {
          mcpSynthesizedCard = card;
          break;
        }
      }

      if (mcpSynthesizedCard) {
        // 确保打标 is_synthesized = 1
        db.prepare(`UPDATE knowledge_items SET is_synthesized = 1 WHERE id = ?`).run(mcpSynthesizedCard.id);
        // MCP 工具已成功直接落盘
        consolidateSourceFragments(cluster.card_ids, mcpSynthesizedCard.id);
        recordDreamHistory({
          cluster_fingerprint: cluster.fingerprint,
          source_ids: cluster.card_ids,
          outcome: 'CONSOLIDATED',
          synthesized_id: mcpSynthesizedCard.id
        });
        summary.processed++;
        summary.consolidated += cluster.card_ids.length;
        summary.details.push({
          project: cluster.project,
          card_ids: cluster.card_ids,
          status: 'CONSOLIDATED_VIA_MCP',
          synthesized_id: mcpSynthesizedCard.id,
          title: mcpSynthesizedCard.title
        });
        if (typeof options.onProgress === 'function') {
          options.onProgress('done', { cluster, synthesized_id: mcpSynthesizedCard.id, via: 'mcp' });
        }
      } else {
        // 从会话文本消息中尝试解析规约卡片或放弃熔炼标识
        const msgs = await readSessionMessages(server, dreamSessionId).catch(() => []);
        const lastAssistant = msgs.slice().reverse().find(m => m.role === 'assistant');
        const parseRes = parseSynthesizedCard(lastAssistant?.text || '');

        if (parseRes?.rejected) {
          recordDreamHistory({
            cluster_fingerprint: cluster.fingerprint,
            source_ids: cluster.card_ids,
            outcome: 'REJECTED'
          });
          const skipUntil = Date.now() + 7 * 24 * 3600 * 1000;
          const placeholders = cluster.card_ids.map(() => '?').join(',');
          db.prepare(`UPDATE knowledge_items SET dream_skip_until = ? WHERE id IN (${placeholders})`)
            .run(skipUntil, ...cluster.card_ids);

          summary.details.push({
            project: cluster.project,
            card_ids: cluster.card_ids,
            status: 'REJECTED_BY_LLM',
            message: '宿主 LLM 判定场景特异不可合并，已设置 7 天防扰冷却'
          });
          if (typeof options.onProgress === 'function') {
            options.onProgress('rejected', { cluster });
          }
        } else if (parseRes?.card) {
          const applyRes = applyDreamConsolidation({
            cluster,
            synthesizedCard: parseRes.card
          });
          summary.processed++;
          summary.consolidated += cluster.card_ids.length;
          summary.details.push({
            project: cluster.project,
            card_ids: cluster.card_ids,
            status: 'CONSOLIDATED_VIA_JSON',
            synthesized_id: applyRes.synthesized_id,
            title: parseRes.card.title
          });
          if (typeof options.onProgress === 'function') {
            options.onProgress('done', { cluster, synthesized_id: applyRes.synthesized_id, via: 'json' });
          }
        } else {
          summary.details.push({
            project: cluster.project,
            card_ids: cluster.card_ids,
            status: 'NO_CONSENSUS',
            message: '宿主回复未包含标准 JSON 或 memhub_save 调用'
          });
        }
      }
    } catch (err) {
      summary.details.push({
        project: cluster.project,
        card_ids: cluster.card_ids,
        status: 'FAILED',
        error: err.message
      });
    } finally {
      if (dreamSessionId) {
        await deleteSession(server, dreamSessionId).catch(() => {});
      }
    }
  }

  return summary;
}
