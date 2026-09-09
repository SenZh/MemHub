import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-test-stats-'));
process.env.MEMHUB_HOME = testDir;

const { recordKnowledge, getStats, closeDatabase } = await import('../src/storage.js');

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

  await t.test('3. 验证 CLI 命令 stats 输出与 --json 模式', () => {
    const cliPath = path.resolve('src/cli.js');
    
    // 测试默认文本输出
    const textOutput = execFileSync(process.execPath, [cliPath, 'stats'], {
      env: { ...process.env, MEMHUB_HOME: testDir },
      encoding: 'utf-8'
    });
    assert.match(textOutput, /MemHub 研发态势与知识资产大盘/);
    assert.match(textOutput, /按 Project 项目维度汇总分布/);
    assert.match(textOutput, /project-alpha/);
    assert.match(textOutput, /project-beta/);

    // 测试 --json 输出
    const jsonOutput = execFileSync(process.execPath, [cliPath, 'stats', '--json'], {
      env: { ...process.env, MEMHUB_HOME: testDir },
      encoding: 'utf-8'
    });
    const parsed = JSON.parse(jsonOutput);
    assert.equal(parsed.total_knowledge_entries, 3);
    assert.equal(parsed.projects.length, 2);
    assert.equal(parsed.projects[0].project, 'project-alpha');
  });

  t.after(() => {
    try {
      closeDatabase();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });
});
