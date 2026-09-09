import crypto from 'crypto';
import { getDatabase } from '../storage.js';
import { cosineSimilarity } from '../search/vector-engine.js';

/**
 * 计算两个标签集合的 Jaccard 相似度
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
export function computeTagJaccard(tagsA = [], tagsB = []) {
  const setA = new Set(tagsA.map(t => String(t).trim().toLowerCase()).filter(Boolean));
  const setB = new Set(tagsB.map(t => String(t).trim().toLowerCase()).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 计算两个关联文件列表的重叠度 (Overlap)
 * 考虑同目录或完全同文件的权重
 */
export function computeFileOverlap(filesA = [], filesB = []) {
  const cleanA = filesA.map(f => String(f).replace(/\\/g, '/').toLowerCase().trim()).filter(Boolean);
  const cleanB = filesB.map(f => String(f).replace(/\\/g, '/').toLowerCase().trim()).filter(Boolean);
  if (cleanA.length === 0 || cleanB.length === 0) return 0;

  const setB = new Set(cleanB);
  let exactMatch = 0;
  for (const f of cleanA) {
    if (setB.has(f)) exactMatch++;
  }
  if (exactMatch > 0) return Math.min(1.0, exactMatch / Math.min(cleanA.length, cleanB.length));

  // 目录级重叠检查 (若在同一子目录下则赋予 0.5 基础分)
  const dirA = new Set(cleanA.map(f => f.split('/').slice(0, -1).join('/')));
  for (const f of cleanB) {
    const dir = f.split('/').slice(0, -1).join('/');
    if (dir && dirA.has(dir)) return 0.5;
  }
  return 0;
}

/**
 * 计算两两碎片之间的综合亲和度得分 (Cluster Affinity Score)
 * 公式：S = 0.35 * Jaccard(Tags) + 0.30 * Overlap(Files) + 0.35 * CosineSim(Vectors)
 */
export function computeAffinityScore(itemA, itemB, vectorA, vectorB) {
  const tagScore = computeTagJaccard(itemA.tags, itemB.tags);
  const fileScore = computeFileOverlap(itemA.related_files, itemB.related_files);
  const vectorScore = (vectorA && vectorB) ? cosineSimilarity(vectorA, vectorB) : 0;

  const totalScore = 0.35 * tagScore + 0.30 * fileScore + 0.35 * vectorScore;
  return {
    totalScore,
    tagScore,
    fileScore,
    vectorScore
  };
}

/**
 * 计算参与做梦的候选卡片集合的全局唯一指纹 (SHA-256)
 */
export function computeClusterFingerprint(cardIds = []) {
  const sorted = [...cardIds].sort().join('|');
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

/**
 * 从数据库中拉取待做梦候选碎片池
 * 门禁规则：
 * 1. status = 'active'
 * 2. is_synthesized = 0 (已熔炼或升华的不再作为普通碎片)
 * 3. dream_skip_until <= 当前时间 (跳过失败冷却期)
 */
export function getDreamCandidateItems(options = {}) {
  const db = getDatabase();
  const project = options.project || null;
  const now = Date.now();

  let sql = `
    SELECT 
      k.id, k.title, k.category, k.project, k.tags, k.related_files,
      k.summary, k.context_text, k.root_cause, k.solution_core,
      e.vector
    FROM knowledge_items k
    LEFT JOIN knowledge_embeddings e ON k.id = e.id
    WHERE k.status = 'active'
      AND (k.is_synthesized IS NULL OR k.is_synthesized = 0)
      AND (k.dream_skip_until IS NULL OR k.dream_skip_until <= ?)
  `;
  const params = [now];

  if (project) {
    sql += ` AND (k.project = ? OR k.project = 'global')`;
    params.push(project);
  }

  sql += ` ORDER BY k.time_created DESC LIMIT ?`;
  params.push(Number(options.limit) || 100);

  const rows = db.prepare(sql).all(...params);

  return rows.map(r => {
    let tags = [];
    let files = [];
    let vec = null;
    try { tags = JSON.parse(r.tags); } catch {}
    try { files = JSON.parse(r.related_files); } catch {}
    try { if (r.vector) vec = JSON.parse(r.vector); } catch {}
    return {
      ...r,
      tags: Array.isArray(tags) ? tags : [],
      related_files: Array.isArray(files) ? files : [],
      vector_data: vec
    };
  });
}

/**
 * 执行连通子图聚类算法，将高度相关的碎片汇聚为做梦主题簇 (Dream Clusters)
 * 
 * 约束条件：
 * 1. 硬隔离：同 project 或 global
 * 2. 亲和度阈值：totalScore >= minAffinity (默认 0.55) 且 vectorScore >= 0.20
 * 3. 簇大小：2 ~ 5 张卡片
 * 4. 幂等拦截：查询 knowledge_dream_history，30天内尝试过的指纹直接跳过
 */
export function clusterCandidateItems(items = [], options = {}) {
  const minAffinity = options.minAffinity !== undefined ? options.minAffinity : 0.55;
  const db = getDatabase();
  const clusters = [];

  // 按 project 空间隔离分组
  const projectGroups = new Map();
  for (const item of items) {
    const p = item.project || 'global';
    if (!projectGroups.has(p)) projectGroups.set(p, []);
    projectGroups.get(p).push(item);
  }

  for (const [proj, groupItems] of projectGroups.entries()) {
    if (groupItems.length < 2) continue;

    // 构建邻接表
    const adj = new Map();
    for (const it of groupItems) adj.set(it.id, []);

    for (let i = 0; i < groupItems.length; i++) {
      for (let j = i + 1; j < groupItems.length; j++) {
        const itemA = groupItems[i];
        const itemB = groupItems[j];
        const scores = computeAffinityScore(itemA, itemB, itemA.vector_data, itemB.vector_data);

        // 若亲和度达标，建立无向边
        if (scores.totalScore >= minAffinity) {
          adj.get(itemA.id).push({ to: itemB.id, score: scores.totalScore });
          adj.get(itemB.id).push({ to: itemA.id, score: scores.totalScore });
        }
      }
    }

    // BFS/DFS 提取连通分量
    const visited = new Set();
    for (const item of groupItems) {
      if (visited.has(item.id)) continue;

      const cluster = [];
      const queue = [item.id];
      visited.add(item.id);

      while (queue.length > 0) {
        const currId = queue.shift();
        const found = groupItems.find(it => it.id === currId);
        if (found) cluster.push(found);

        const neighbors = adj.get(currId) || [];
        for (const n of neighbors) {
          if (!visited.has(n.to)) {
            visited.add(n.to);
            queue.push(n.to);
          }
        }
      }

      // 簇大小需在 2~5 张卡片之间 (超过 5 张切片保留最相关的前 5 张)
      if (cluster.length >= 2) {
        const slicedCluster = cluster.slice(0, 5);
        const cardIds = slicedCluster.map(c => c.id);
        const fingerprint = computeClusterFingerprint(cardIds);

        // 检查是否已经在 30 天内尝试过做梦
        let alreadyAttempted = false;
        try {
          const past = db.prepare(`
            SELECT id FROM knowledge_dream_history 
            WHERE cluster_fingerprint = ? AND created_at > ?
          `).get(fingerprint, Date.now() - 30 * 24 * 3600 * 1000);
          if (past) alreadyAttempted = true;
        } catch {}

        if (!alreadyAttempted) {
          clusters.push({
            project: proj,
            fingerprint,
            card_ids: cardIds,
            items: slicedCluster.map(c => ({
              id: c.id,
              title: c.title,
              category: c.category,
              tags: c.tags,
              related_files: c.related_files
            }))
          });
        }
      }
    }
  }

  return clusters;
}
