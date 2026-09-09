import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-test-dream-'));
process.env.MEMHUB_HOME = testDir;

const { recordKnowledge, closeDatabase } = await import('../src/storage.js');
const { 
  computeTagJaccard, 
  computeFileOverlap, 
  computeClusterFingerprint,
  getDreamCandidateItems, 
  clusterCandidateItems 
} = await import('../src/dream/clustering.js');

test('MemHub AI 做梦引擎 (Dreaming Phase 1: 碎片聚类与防重状态机)', async (t) => {
  await t.test('1. Tag Jaccard 集合交集测试', () => {
    const score1 = computeTagJaccard(['auth', 'jwt', 'security'], ['jwt', 'auth']);
    assert.ok(score1 >= 0.65);

    const score2 = computeTagJaccard(['docker', 'alpine'], ['mysql', 'innodb']);
    assert.equal(score2, 0);
  });

  await t.test('2. File Overlap 路径重叠度测试', () => {
    const scoreExact = computeFileOverlap(['src/auth/jwt.js'], ['src/auth/jwt.js', 'src/db.js']);
    assert.equal(scoreExact, 1.0);

    const scoreDir = computeFileOverlap(['src/auth/jwt.js'], ['src/auth/login.js']);
    assert.equal(scoreDir, 0.5); // 同目录得分

    const scoreNone = computeFileOverlap(['src/auth/jwt.js'], ['tests/e2e.js']);
    assert.equal(scoreNone, 0);
  });

  await t.test('3. 指纹哈希幂等性与排序无关性测试', () => {
    const fp1 = computeClusterFingerprint(['kb-001', 'kb-002', 'kb-003']);
    const fp2 = computeClusterFingerprint(['kb-003', 'kb-001', 'kb-002']);
    assert.equal(fp1, fp2);
  });

  await t.test('4. 端到端入库与连通子图做梦主题簇初筛', () => {
    // 写入 3 张高度相关的 Auth 碎片卡
    recordKnowledge({
      title: '[Auth/Token] JWT Token 过期导致空指针异常',
      category: 'learnings',
      tags: ['auth', 'jwt', 'token'],
      context: 'JWT 过期时未捕获 ExpiredJwtException',
      solution: '增加全局异常拦截',
      related_files: ['src/auth/jwt.js'],
      project: 'dream-project'
    });

    recordKnowledge({
      title: '[Auth/Filter] Authorization 请求头 Bearer 大小写未对齐',
      category: 'learnings',
      tags: ['auth', 'header', 'token'],
      context: '移动端请求头未统一规范',
      solution: '增加忽略大小写匹配',
      related_files: ['src/auth/filter.js'],
      project: 'dream-project'
    });

    // 写入一张无关的 DB 碎片卡
    recordKnowledge({
      title: '[Database/Pool] 连接池超时回收策略设置',
      category: 'decisions',
      tags: ['db', 'pool'],
      context: '高并发连接耗尽',
      solution: '设置超时时间 30s',
      related_files: ['src/db/pool.js'],
      project: 'dream-project'
    });

    const candidates = getDreamCandidateItems({ project: 'dream-project' });
    assert.equal(candidates.length, 3);

    // 验证聚类 (阈值 0.35)
    const clusters = clusterCandidateItems(candidates, { minAffinity: 0.35 });
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].project, 'dream-project');
    assert.equal(clusters[0].items.length, 2);
    // 聚出的应为两张 Auth 卡，排除了无关的 DB 卡
    const titles = clusters[0].items.map(it => it.title);
    assert.ok(titles.some(t => t.includes('JWT Token')));
    assert.ok(titles.some(t => t.includes('Authorization')));
  });

  await t.test('5. CLI 命令 memhub dream --dry-run 与 --json 模式', () => {
    const cliPath = path.resolve('src/cli.js');
    
    // 文本模式
    const textOut = execFileSync(process.execPath, [cliPath, 'dream', '--affinity', '0.35', '--project', 'dream-project', '--dry-run'], {
      env: { ...process.env, MEMHUB_HOME: testDir },
      encoding: 'utf-8'
    });
    assert.match(textOut, /MemHub AI 做梦自省引擎/);
    assert.match(textOut, /可熔炼簇/);
    assert.match(textOut, /DRY-RUN 模式/);

    // JSON 模式
    const jsonOut = execFileSync(process.execPath, [cliPath, 'dream', '--affinity', '0.35', '--project', 'dream-project', '--json'], {
      env: { ...process.env, MEMHUB_HOME: testDir },
      encoding: 'utf-8'
    });
    const parsed = JSON.parse(jsonOut);
    assert.equal(parsed.total_clusters, 1);
    assert.equal(parsed.clusters[0].items.length, 2);
  });

  t.after(() => {
    try {
      closeDatabase();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });
});
