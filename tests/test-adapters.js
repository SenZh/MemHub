import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { OpenCodeAdapter } from '../src/adapters/opencode.js';
import { CursorAdapter } from '../src/adapters/cursor.js';
import { registry } from '../src/adapters/index.js';
import { AgentAdapter } from '../src/adapters/base.js';

console.log('=== [层级单测: Adapters 适配器层与真实防卫测试] ===');

// 1. 验证抽象基类
console.log('1. 验证 AgentAdapter 抽象基类禁止直接实例化...');
assert.throws(() => {
  new AgentAdapter('test');
}, /不能直接实例化抽象类/);
console.log('   ✅ 抽象基类断言通过');

// 2. 使用临时 SQLite 数据库构建独立测试夹具 (彻底摆脱对本地物理数据的依赖)
console.log('2. 构建独立测试夹具，严格验证【时间阈值过滤】与【自循环防卫】...');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-test-adpt-'));
const testDbPath = path.join(tmpDir, 'opencode.db');
const testDb = new DatabaseSync(testDbPath);

testDb.exec(`
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    title TEXT,
    directory TEXT,
    parent_id TEXT,
    time_created INTEGER,
    time_updated INTEGER,
    model TEXT
  );
  CREATE TABLE part (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    time_created INTEGER,
    data TEXT
  );
`);

const now = Date.now();
const tenMinsAgo = now - 10 * 60 * 1000;    // 10分钟前 (热会话)
const fortyMinsAgo = now - 45 * 60 * 1000;  // 45分钟前 (冷会话)
const threeHoursAgo = now - 180 * 60 * 1000;// 3小时前 (陈旧会话)
const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000; // 10天前 (超出7天窗口)

// 插入测试数据
const insertStmt = testDb.prepare(`
  INSERT INTO session (id, title, directory, parent_id, time_created, time_updated, model)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

insertStmt.run('ses-hot', '热会话正在调试', 'D:/workspace/proj-a', null, tenMinsAgo, tenMinsAgo, '{}');
insertStmt.run('ses-cold', '冷会话已完成', 'D:/workspace/proj-a', null, fortyMinsAgo, fortyMinsAgo, '{}');
insertStmt.run('ses-self-loop', '[MemHub] 自动萃取生成的会话', 'D:/workspace/proj-a', null, threeHoursAgo, threeHoursAgo, '{}');
insertStmt.run('ses-self-loop-old', '[MemoryHub] 历史萃取会话', 'D:/workspace/proj-a', null, threeHoursAgo, threeHoursAgo, '{}');
insertStmt.run('ses-child', '派生子任务会话', 'D:/workspace/proj-a', 'ses-cold', threeHoursAgo, threeHoursAgo, '{}');
insertStmt.run('ses-excluded-path', '正常冷会话但目录被排除', 'D:/workspace/tmp/scratchpad', null, threeHoursAgo, threeHoursAgo, '{}');
// 10 天前更新的会话：静默期满足，但若启用 windowDays=7 上界则不应被召回
insertStmt.run('ses-stale-10d', '10天前更新的陈旧会话', 'D:/workspace/proj-a', null, tenDaysAgo, tenDaysAgo, '{}');

const testAdapter = new OpenCodeAdapter(testDbPath);
assert(testAdapter.isAvailable() === true);

// 真实测试 A：验证 idleMinutes: 30 动态过滤 (禁止 force: true)
console.log('   - 验证动态 idleMinutes: 30 过滤 (不传 force)...');
const scannedCold = testAdapter.scanCandidateSessions({
  idleMinutes: 30,
  limit: 10
});
const coldIds = scannedCold.map(s => s.id);
console.log('     扫描出的候选会话:', coldIds);

// 断言：
// 1. 10分钟前的 ses-hot 必须被 100% 拦截 (未达到 30 分钟静默期)
assert(!coldIds.includes('ses-hot'), '热会话未被过滤！');
// 2. 45分钟前的 ses-cold 必须被正常召回
assert(coldIds.includes('ses-cold'), '冷会话未被召回！');
// 3. [MemHub] 与 [MemoryHub] 必须被 SQL 层 100% 拦截 (防自循环)
assert(!coldIds.includes('ses-self-loop'), '[MemHub] 自循环会话未被排除！');
assert(!coldIds.includes('ses-self-loop-old'), '[MemoryHub] 自循环会话未被排除！');
// 4. parent_id 非空的子任务必须被排除
assert(!coldIds.includes('ses-child'), '子任务会话未被排除！');
console.log('   ✅ 时间阈值与自循环防卫全部真实通过！');

// 真实测试 B：验证动态 scanRules 目录排除
console.log('   - 验证 scanRules 路径排除过滤...');
const scannedExclude = testAdapter.scanCandidateSessions({
  idleMinutes: 30,
  scanRules: {
    exclude: ['**/tmp/**']
  },
  force: true
});
const excludeIds = scannedExclude.map(s => s.id);
assert(!excludeIds.includes('ses-excluded-path'), 'exclude 路径规则未能拦截目标目录！');
console.log('   ✅ scanRules 路径排除过滤真实通过！');

// 真实测试 C：验证 daemon 的 windowDays 窗口上界（只扫最近 N 天更新的会话）
console.log('   - 验证 windowDays: 7 上界过滤 (仅 daemon 传入) ...');
const scannedWindow = testAdapter.scanCandidateSessions({
  idleMinutes: 30,
  windowDays: 7,
  limit: 10
});
const windowIds = scannedWindow.map(s => s.id);
console.log('     加 windowDays 后的候选:', windowIds);
assert(!windowIds.includes('ses-stale-10d'), '10天前的陈旧会话未被 7 天窗口拦截！');
assert(windowIds.includes('ses-cold'), '7 天内且静默完成的会话应被召回！');
assert(!windowIds.includes('ses-hot'), '热会话(未到静默期)仍应被拦截！');
console.log('   ✅ windowDays 上界过滤真实通过！');

// 真实测试 D：不传 windowDays（手动 scan 场景）应召回 10 天前会话（force 全扫语义仍存在）
console.log('   - 验证不传 windowDays 时手动 scan 不受 7 天窗口约束 ...');
const scannedNoWindow = testAdapter.scanCandidateSessions({
  idleMinutes: 30,
  force: true,
  limit: 10
});
const noWindowIds = scannedNoWindow.map(s => s.id);
assert(noWindowIds.includes('ses-stale-10d'), '手动 force 全扫应能召回 10 天前会话！');
console.log('   ✅ 手动 scan 不被 7 天窗口约束真实通过！');

// 清理测试临时夹具
testAdapter.close();
testDb.close();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (e) {}

// 3. 验证 CursorAdapter
console.log('3. 验证 CursorAdapter 接口实现...');
const cursor = new CursorAdapter();
assert(typeof cursor.isAvailable() === 'boolean');
assert(Array.isArray(cursor.scanCandidateSessions()));
console.log('   ✅ CursorAdapter 测试通过');

// 4. 验证 AdapterRegistry
console.log('4. 验证 AdapterRegistry 多态路由...');
assert(registry.get('opencode') instanceof OpenCodeAdapter);
assert(registry.get('cursor') instanceof CursorAdapter);

const activeContext = registry.resolveActiveContext(process.cwd());
assert(typeof activeContext.sessionId === 'string');
assert(typeof activeContext.sourceAgent === 'string');
console.log('   ✅ AdapterRegistry 测试通过');

console.log('\n🎉 Adapters 适配器层所有深度单元测试 100% 通过！\n');
