/**
 * 倒数排名融合算法 (Reciprocal Rank Fusion, RRF)
 *
 * 学术标准与工业界最佳实践（Cormack et al., SIGIR 2009）：
 * 将多个独立检索系统（如基于 BM25/Trigram 的倒排文本检索 与 基于向量余弦距离的语义检索）
 * 的排位结果通过倒数加权进行无偏平滑融合，无需对两路物理分数做不可靠的跨模态归一化。
 *
 * 核心公式：
 *   RRF_Score(d) = \sum_{m \in M} \frac{w_m}{k + Rank_m(d)}
 *   - k: 平滑常数（经典默认 60，避免头部名次断崖式拉开过大差距）
 *   - Rank_m(d): 候选条目在第 m 路中的排位索引（从 1 开始）
 *   - w_m: 该路的权重因子（默认 1.0）
 */

export const DEFAULT_RRF_K = 60;

/**
 * 执行两路（或多路）检索结果的倒数排名融合
 *
 * @param {Object} rankingSources 各路召回结果列表
 *   - fts: Array<{ id: string, ...extra }> (按文本相关性降序排好)
 *   - vector: Array<{ id: string, score?: number, ...extra }> (按向量余弦相似度降序排好)
 * @param {Object} options 配置参数
 *   - k: 平滑因子 (默认 60)
 *   - weights: 各路权重对象，例如 { fts: 1.0, vector: 1.0 }
 *   - limit: 融合后最终截取数量 (默认 10)
 * @returns {Array<{ id: string, rrfScore: number, ranks: Object, matchedSources: string[], item: Object }>}
 */
export function fuseRankings(rankingSources = {}, options = {}) {
  const k = options.k ?? DEFAULT_RRF_K;
  const weights = options.weights || { fts: 1.0, vector: 1.0 };
  const limit = options.limit || 10;

  // 聚合池：id -> 融合明细
  const scoreMap = new Map();

  for (const [sourceName, list] of Object.entries(rankingSources)) {
    if (!Array.isArray(list)) continue;
    const w = weights[sourceName] ?? 1.0;

    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      if (!entry || !entry.id) continue;
      const id = entry.id;
      const rank = i + 1; // 名次从 1 开始

      const rrfComponent = w * (1.0 / (k + rank));

      if (!scoreMap.has(id)) {
        scoreMap.set(id, {
          id,
          rrfScore: 0,
          ranks: {},
          matchedSources: [],
          item: entry
        });
      }

      const record = scoreMap.get(id);
      record.rrfScore += rrfComponent;
      record.ranks[sourceName] = rank;
      record.matchedSources.push(sourceName);
      // 若原实体包含完整数据，补全进 record.item
      record.item = { ...record.item, ...entry };
    }
  }

  // 按最终 RRF 得分降序排序
  const fusedList = Array.from(scoreMap.values());
  fusedList.sort((a, b) => b.rrfScore - a.rrfScore);

  return fusedList.slice(0, limit);
}
