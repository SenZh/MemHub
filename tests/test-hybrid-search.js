import assert from 'node:assert';
import { embedText, cosineSimilarity, VECTOR_DIMENSIONS } from '../src/search/vector-engine.js';
import { fuseRankings } from '../src/search/rrf.js';
import { recordKnowledge, searchKnowledge, getDatabase } from '../src/storage.js';

console.log('=== [单测: Hybrid Search 混合检索与向量融合引擎] ===');

// 1. 验证向量维度与 L2 归一化
console.log('1. 验证 384 维向量生成与 L2 范数归一化...');
const vec1 = embedText('Docker Alpine glibc 缺失导致 sharp 编译失败');
assert.strictEqual(vec1.length, VECTOR_DIMENSIONS, `向量维度应为 ${VECTOR_DIMENSIONS}`);

let norm = 0;
for (let i = 0; i < vec1.length; i++) norm += vec1[i] * vec1[i];
assert(Math.abs(Math.sqrt(norm) - 1.0) < 1e-4, '向量必须满足 L2 范数归一化 (模长接近 1.0)');
console.log('   ✅ 384 维向量与 L2 归一化断言通过');

// 2. 验证余弦相似度区分度（同义相关 vs 无关）
console.log('2. 验证余弦相似度度量（同义相近度显著高于跨域文本）...');
const vecSame = embedText('Docker Alpine glibc 缺失导致 sharp 编译失败');
const vecSimilar = embedText('Alpine 容器构建缺 glibc 动态库报错');
const vecUnrelated = embedText('充值赠送阶梯金额与账户钱包账本分离设计');

const simIdentical = cosineSimilarity(vec1, vecSame);
const simClose = cosineSimilarity(vec1, vecSimilar);
const simFar = cosineSimilarity(vec1, vecUnrelated);

console.log(`   - 完全相同余弦相似度: ${simIdentical.toFixed(4)}`);
console.log(`   - 语义相近余弦相似度: ${simClose.toFixed(4)}`);
console.log(`   - 跨域无关余弦相似度: ${simFar.toFixed(4)}`);

assert(Math.abs(simIdentical - 1.0) < 1e-4, '相同文本相似度应为 1.0');
assert(simClose > simFar + 0.10, `语义相近文本相似度 (${simClose.toFixed(3)}) 应显著高于无关文本 (${simFar.toFixed(3)})`);
console.log('   ✅ 语义相似度空间区分度断言通过');

// 3. 验证 RRF 倒数排名融合算法
console.log('3. 验证 RRF (Reciprocal Rank Fusion) 算法结算与双路加权...');
const ftsList = [
  { id: 'doc-a', title: 'A' },
  { id: 'doc-b', title: 'B' },
  { id: 'doc-c', title: 'C' }
];
const vecList = [
  { id: 'doc-b', title: 'B' },
  { id: 'doc-a', title: 'A' },
  { id: 'doc-d', title: 'D' }
];

const fused = fuseRankings({ fts: ftsList, vector: vecList }, { k: 60, limit: 10 });
assert(fused.length === 4, '去重后应有 4 个条目');
// doc-b: fts rank 2, vec rank 1 -> 1/(60+2) + 1/(60+1) = 1/62 + 1/61 = 0.016129 + 0.016393 = 0.032522
// doc-a: fts rank 1, vec rank 2 -> 1/(60+1) + 1/(60+2) = 0.032522
// doc-c: fts rank 3 -> 1/63 = 0.015873
// doc-d: vec rank 3 -> 1/63 = 0.015873
assert(fused[0].rrfScore > fused[2].rrfScore, '双路均命中的文档得分必须显著高于单路命中的文档');
assert(fused[0].matchedSources.includes('fts') && fused[0].matchedSources.includes('vector'), '双路命中文档标记正确');
console.log('   ✅ RRF 算法无偏平滑融合断言通过');

// 4. 验证混合检索落地：解决“词汇鸿沟”真实场景
console.log('4. 验证端到端混合检索 (解决同义词与词汇鸿沟)...');
const testProject = 'hybrid-test-' + Date.now();

// 写入一条使用正式术语的知识卡片（标题与内容不包含口语词"掉单"）
recordKnowledge({
  title: '[Webhook/支付] 第三方支付回调丢包补偿机制与超时重试幂等正解',
  category: 'patterns',
  project: testProject,
  tags: ['webhook', 'payment', 'retry', 'idempotent'],
  context: '接收第三方支付通道回调通知的高可靠异步处理',
  solution: '建立支付补单兜底定时轮询任务，结合分布式锁与流水号保证幂等',
  topic_fingerprint: 'pay-webhook-retry'
});

// 验证 1: 精确关键词搜索 (FTS 命中)
const ftsHits = searchKnowledge('webhook retry', { project: testProject });
assert(ftsHits.length >= 1, '精确 FTS 关键词必须命中');

// 验证 2: 语义相近/词汇鸿沟搜索（搜索"支付 补单 兜底 定时轮询"）
const hybridHits = searchKnowledge('支付 补单 兜底 定时轮询', { project: testProject });
assert(hybridHits.length >= 1, '语义相近意图必须通过向量层或混合链路成功召回');
assert.strictEqual(hybridHits[0].project, testProject);
console.log('   - 召回卡片标题:', hybridHits[0].title);
console.log('   ✅ 词汇鸿沟语义召回断言通过');

// 5. 验证元数据硬过滤在混合检索中绝对生效
console.log('5. 验证项目命名空间与标签硬过滤在混合检索中绝对生效...');
const isolatedHits = searchKnowledge('webhook payment', { project: 'completely-other-project' });
assert(isolatedHits.filter(h => h.project === testProject).length === 0, '跨项目隔离严禁泄漏');

const categoryFiltered = searchKnowledge('webhook payment', { project: testProject, category: 'learnings' });
assert(categoryFiltered.length === 0, '分类限定 learnings 时不应召回 patterns 卡片');

console.log('   ✅ 混合检索元数据过滤断言通过');

console.log('\n🎉 Hybrid Search 混合检索与向量融合引擎测试全部通过！\n');
