import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-test-stats-'));
process.env.MEMHUB_HOME = testDir;

const { recordKnowledge, getStats, closeDatabase } = await import('../src/storage.js');
const { applyDreamConsolidation } = await import('../src/dream/pipeline.js');

test('MemHub Stats 研发态势与按 Project 资产分布大盘', async (t) => {
  await t.test('1. 空数据初始状态断言', () => {
    const stats = getStats({ project: 'test-project' });
    assert.equal(stats.total_knowledge_entries, 0);
    assert.deepEqual(stats.projects, []);
    assert.equal(stats.estimated_saved_tokens, 0);
  });

  await t.test('2. 写入跨 Project 多维度资产并验证项目聚合与分类统计', () => {
    // 写入 project A 排错卡
    recordKnowledge({
      title: '[Auth/JWT] token 过期解析 NPE 异常修复',
      category: 'learnings',
      tags: ['auth', 'jwt'],
      context: 'JWT Token 过期解析时引发空指针',
      solution: '增加非空判断',
      related_files: ['src/auth.js'],
      project: 'project-alpha'
    });

    // 写入 project A 架构决策卡
    recordKnowledge({
      title: '[Auth/Header] Bearer 前缀大小写兼容决策',
      category: 'decisions',
      tags: ['auth', 'header'],
      context: '移动端请求头未大写 Bearer',
      solution: '正则忽略大小写匹配',
      related_files: ['src/auth.js'],
      project: 'project-alpha'
    });

    // 写入 project B 架构决策卡
    recordKnowledge({
      title: '[DB/Pool] 连接池最大连接数与空闲回收策略',
      category: 'decisions',
      tags: ['db', 'pool'],
      context: '高并发下连接泄露',
      solution: '设置超时回收',
      related_files: ['src/db.js'],
      project: 'project-beta'
    });

    // 1) 全局查询验证 (all_projects)
    const globalStats = getStats();
    assert.equal(globalStats.total_knowledge_entries, 3);
    assert.ok(globalStats.estimated_saved_tokens > 0);

    // 验证 projects 分组聚合
    assert.equal(globalStats.projects.length, 2);
    const alpha = globalStats.projects.find(p => p.project === 'project-alpha');
    assert.ok(alpha);
    assert.equal(alpha.total, 2);
    assert.equal(alpha.learnings, 1);
    assert.equal(alpha.decisions, 1);

    const beta = globalStats.projects.find(p => p.project === 'project-beta');
    assert.ok(beta);
    assert.equal(beta.total, 1);
    assert.equal(beta.decisions, 1);

    // 2) 指定 project 过滤查询验证
    const filteredStats = getStats({ project: 'project-alpha' });
    assert.equal(filteredStats.total_knowledge_entries, 2);
    assert.equal(filteredStats.projects.length, 1);
    assert.equal(filteredStats.projects[0].project, 'project-alpha');
  });

  await t.test('2.1 做梦引擎维度统计：升华卡片/封存碎片/台账轮次/候选池', () => {
    // 初始无做梦记录，候选池应含已有的非合成 active 卡片
    const before = getStats({ project: 'project-alpha' });
    assert.equal(before.dreaming.synthesized_l4, 0);
    assert.equal(before.dreaming.consolidated_fragments, 0);
    assert.equal(before.dreaming.dream_rounds, 0);
    assert.equal(before.dreaming.candidate_pool, 2);

    // 模拟做梦熔炼：把 project-alpha 的两张碎片合成一张 L4
    const fragA = recordKnowledge({
      title: '[Auth/JWT] 碎片一',
      category: 'learnings',
      tags: ['auth'],
      context: '碎片一上下文',
      solution: '碎片一修复',
      project: 'project-alpha'
    });
    const fragB = recordKnowledge({
      title: '[Auth/JWT] 碎片二',
      category: 'learnings',
      tags: ['auth'],
      context: '碎片二上下文',
      solution: '碎片二修复',
      project: 'project-alpha'
    });

    applyDreamConsolidation({
      cluster: {
        project: 'project-alpha',
        fingerprint: 'fp-stats-test-001',
        card_ids: [fragA.id, fragB.id]
      },
      synthesizedCard: {
        title: '[Auth/JWT] 统一鉴权规范',
        category: 'patterns',
        tags: ['auth', 'jwt'],
        solution: '统一走鉴权中间件'
      }
    });

    const after = getStats({ project: 'project-alpha' });
    assert.equal(after.dreaming.synthesized_l4, 1);
    assert.equal(after.dreaming.consolidated_fragments, 2);
    assert.equal(after.dreaming.dream_rounds, 1);
    // 原本 2 张候选被熔炼后：被合成卡不计入候选、被熔炼碎片不计入候选、新增碎片计入候选
    assert.equal(after.dreaming.candidate_pool, 2);

    // 全局视角同样可见做梦成效
    const globalAfter = getStats();
    assert.equal(globalAfter.dreaming.synthesized_l4, 1);
    assert.equal(globalAfter.dreaming.consolidated_fragments, 2);
    assert.equal(globalAfter.dreaming.dream_rounds, 1);

    // project-beta 未参与做梦，应看不到熔炼轮次
    const betaStats = getStats({ project: 'project-beta' });
    assert.equal(betaStats.dreaming.dream_rounds, 0);
    assert.equal(betaStats.dreaming.synthesized_l4, 0);
  });

  await t.test('3. 验证 CLI 命令 stats 输出与 --json 模式', () => {
    const cliPath = path.resolve('src/cli.js');
    
    // 测试默认文本输出
    const textOutput = execFileSync(process.execPath, [cliPath, 'stats'], {
      env: { ...process.env, MEMHUB_HOME: testDir },
      encoding: 'utf-8'
    });
    assert.match(textOutput, /MemHub 研发态势与知识资产大盘/);
    assert.match(textOutput, /按 Project 项目维度汇总分布/);
    assert.match(textOutput, /做梦引擎自省与认知熔炼/);
    assert.match(textOutput, /project-alpha/);
    assert.match(textOutput, /project-beta/);

    // 测试 --json 输出
    const jsonOutput = execFileSync(process.execPath, [cliPath, 'stats', '--json'], {
      env: { ...process.env, MEMHUB_HOME: testDir },
      encoding: 'utf-8'
    });
    const parsed = JSON.parse(jsonOutput);
    // 3 张初始卡 + 1 张做梦升华卡 = 4 张 active 资产
    assert.equal(parsed.total_knowledge_entries, 4);
    assert.equal(parsed.projects.length, 2);
    assert.equal(parsed.projects[0].project, 'project-alpha');
    assert.equal(parsed.dreaming.synthesized_l4, 1);
    assert.equal(parsed.dreaming.consolidated_fragments, 2);
    assert.equal(parsed.dreaming.dream_rounds, 1);
  });

  t.after(() => {
    try {
      closeDatabase();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });
});
