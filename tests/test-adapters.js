import assert from 'node:assert';
import { AgentAdapter } from '../src/adapters/base.js';
import { OpenCodeAdapter } from '../src/adapters/opencode.js';
import { CursorAdapter } from '../src/adapters/cursor.js';
import { registry } from '../src/adapters/index.js';

console.log('=== [层级单测: Adapters 适配器层] ===');

// 1. 抽象基类约束测试
console.log('1. 验证 AgentAdapter 抽象基类禁止直接实例化...');
assert.throws(() => new AgentAdapter('test'), /不能直接实例化抽象类/);
console.log('   ✅ 抽象基类断言通过');

// 2. OpenCodeAdapter 实现测试
console.log('2. 验证 OpenCodeAdapter 接口实现...');
const openCodeAdapter = new OpenCodeAdapter();
assert(openCodeAdapter.name === 'opencode');
console.log('   - OpenCode 本地可用性:', openCodeAdapter.isAvailable());
if (openCodeAdapter.isAvailable()) {
  const sessions = openCodeAdapter.scanCandidateSessions({ limit: 2 });
  console.log('   - 扫描到候选 Session 条数:', sessions.length);
  assert(Array.isArray(sessions));
  if (sessions.length > 0) {
    const s = sessions[0];
    assert(s.id && s.title && s.projectPath);
    const context = openCodeAdapter.readSessionContext(s.id);
    console.log(`   - 成功读取会话 [${s.id}] 文本块数:`, context.length);
    assert(Array.isArray(context));
  }
}
console.log('   ✅ OpenCodeAdapter 测试通过');

// 3. CursorAdapter 实现测试
console.log('3. 验证 CursorAdapter 接口实现...');
const cursorAdapter = new CursorAdapter();
assert(cursorAdapter.name === 'cursor');
console.log('   - Cursor 本地存储目录可用性:', cursorAdapter.isAvailable());
console.log('   ✅ CursorAdapter 测试通过');

// 4. Registry 注册中心测试
console.log('4. 验证 AdapterRegistry 多态路由...');
assert(registry.get('opencode') instanceof OpenCodeAdapter);
assert(registry.get('cursor') instanceof CursorAdapter);
const active = registry.resolveActiveContext(process.cwd());
console.log('   - 动态推导当前工作区活跃 Session:', active);
assert(active.sessionId && active.sourceAgent);
console.log('   ✅ AdapterRegistry 测试通过');

console.log('🎉 Adapters 适配器层单元测试 100% 通过！\n');
