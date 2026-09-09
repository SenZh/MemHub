import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-test-pipe-'));
process.env.MEMHUB_HOME = testDir;

const { recordKnowledge, getKnowledge, getDatabase, closeDatabase } = await import('../src/storage.js');
const { buildDreamPrompt } = await import('../src/dream/prompt.js');
const { 
  applyDreamConsolidation, 
  consolidateSourceFragments,
  recordDreamHistory,
  runDreamPipeline 
} = await import('../src/dream/pipeline.js');

test('MemHub 做梦提炼执行管道与状态机流转 (Dream Pipeline)', async (t) => {
  let fragmentId1 = null;
  let fragmentId2 = null;

  await t.test('1. 准备测试碎片卡片 (Active 状态)', () => {
    const res1 = recordKnowledge({
      title: '[Auth/JWT] token 过期解析 NPE 异常修复',
      category: 'learnings',
      tags: ['auth', 'jwt', 'security'],
      context: '移动端 JWT 解析偶发 NPE',
      solution: '增加全局 claims 非空检查代码',
      related_files: ['src/auth/jwt.js'],
      project: 'dream-pipe-proj'
    });
    fragmentId1 = res1.id;

    const res2 = recordKnowledge({
      title: '[Auth/Header] Bearer 前缀大小写兼容处理',
      category: 'learnings',
      tags: ['auth', 'header', 'security'],
      context: '部分网关透传为小写 bearer',
      solution: '使用正则忽略大小写剥离前缀',
      related_files: ['src/auth/filter.js'],
      project: 'dream-pipe-proj'
    });
    fragmentId2 = res2.id;

    assert.ok(fragmentId1);
    assert.ok(fragmentId2);
  });

  await t.test('2. 验证做梦提示词构建规范 (Prompt Template)', () => {
    const cluster = {
      project: 'dream-pipe-proj',
      fingerprint: 'fp-12345678',
      card_ids: [fragmentId1, fragmentId2],
      items: [
        { id: fragmentId1, title: '卡片1', category: 'learnings', tags: ['auth'], solution_core: '解法1' },
        { id: fragmentId2, title: '卡片2', category: 'learnings', tags: ['auth'], solution_core: '解法2' }
      ]
    };

    const prompt = buildDreamPrompt(cluster);
    assert.match(prompt, /离线睡眠反思与记忆做梦熔炼任务/);
    assert.match(prompt, /深层因果共性抽象/);
    assert.match(prompt, /架构冲突自省/);
    assert.match(prompt, /memhub_save/);
    assert.match(prompt, /supersedes/);
  });

  await t.test('3. 执行做梦熔炼落盘 (applyDreamConsolidation) 与状态机封存', () => {
    const cluster = {
      project: 'dream-pipe-proj',
      fingerprint: 'fp-auth-dream-cluster',
      card_ids: [fragmentId1, fragmentId2]
    };

    const synthesizedCard = {
      title: '[Auth/统一规范] 移动端凭证解析与网关请求头安全过滤终极指南',
      category: 'patterns',
      tags: ['auth', 'jwt', 'header', 'security'],
      context: '由做梦引擎自动反思多张碎片熔炼而来',
      solution: '1. 统一提取 Bearer 前缀并校验 claims；2. 注入全局安全拦截器。',
      guardrails: ['严禁信任未经校验的 Authorization 头']
    };

    const result = applyDreamConsolidation({ cluster, synthesizedCard });
    assert.equal(result.success, true);
    assert.ok(result.synthesized_id);
    assert.equal(result.consolidated_fragments_count, 2);

    // 验证新生成的 L4 升华卡片
    const l4Card = getKnowledge(result.synthesized_id);
    assert.ok(l4Card);
    assert.equal(l4Card.is_synthesized, 1);
    assert.match(l4Card.supersedes, new RegExp(fragmentId1));
    assert.match(l4Card.supersedes, new RegExp(fragmentId2));

    // 验证原始两张碎片的状态机是否已成功流转为 consolidated
    const db = getDatabase();
    const frag1 = db.prepare('SELECT status, consolidated_into FROM knowledge_items WHERE id = ?').get(fragmentId1);
    const frag2 = db.prepare('SELECT status, consolidated_into FROM knowledge_items WHERE id = ?').get(fragmentId2);

    assert.equal(frag1.status, 'consolidated');
    assert.equal(frag1.consolidated_into, result.synthesized_id);
    assert.equal(frag2.status, 'consolidated');
    assert.equal(frag2.consolidated_into, result.synthesized_id);

    // 验证做梦审计日志表 (knowledge_dream_history)
    const history = db.prepare('SELECT * FROM knowledge_dream_history WHERE cluster_fingerprint = ?').get('fp-auth-dream-cluster');
    assert.ok(history);
    assert.equal(history.outcome, 'CONSOLIDATED');
    assert.equal(history.synthesized_id, result.synthesized_id);
  });

  await t.test('4. 验证 runDreamPipeline 模式与空转保护', async () => {
    // 此时碎片已被 consolidated 封存，候选池应无满足条件的碎片
    const summary = await runDreamPipeline({ project: 'dream-pipe-proj', dryRun: true });
    assert.equal(summary.clusters_found, 0);
  });

  t.after(() => {
    try {
      closeDatabase();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });
});
