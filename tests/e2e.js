import { execSync } from 'node:child_process';
import assert from 'node:assert';

console.log('====================================================');
console.log('       ExoBrain 四层解耦架构自动化测试套件         ');
console.log('====================================================\n');

const suites = [
  { name: 'Layer 1: 基础设施与核心存储层 (SQLite FTS5 + Markdown + Scrubber)', cmd: 'node tests/test-storage.js' },
  { name: 'Layer 2: 宿主适配器层 (AgentAdapter 抽象基类 + OpenCode/Cursor 实现)', cmd: 'node tests/test-adapters.js' },
  { name: 'Layer 3: 提炼与调度管道层 (Extractor 领域提炼 + 状态机)', cmd: 'node tests/test-extractor.js' },
  { name: 'Layer 4: 接口协议与呈现层 (Stdio JSON-RPC MCP 协议)', cmd: 'node tests/test-mcp-protocol.js' }
];

for (let i = 0; i < suites.length; i++) {
  const suite = suites[i];
  console.log(`[SUITE ${i + 1}/${suites.length}] 执行 ${suite.name}...`);
  try {
    const out = execSync(suite.cmd, { encoding: 'utf-8' });
    console.log(out.trim());
    console.log(`✅ [SUITE ${i + 1}] 通过！\n`);
  } catch (err) {
    console.error(`❌ [SUITE ${i + 1}] 失败:`, err.stdout || err.message);
    process.exit(1);
  }
}

// 检查 OpenCode 连通性
console.log('[FINAL CHECK] 验证 OpenCode 宿主 MCP 连通状态...');
const mcpList = execSync('opencode mcp list', { encoding: 'utf-8' });
assert(mcpList.includes('exobrain') && mcpList.includes('connected'));
console.log('✅ OpenCode 宿主热连通正常！\n');

console.log('====================================================');
console.log('🎉 4 层架构各层独立单元测试 + 端到端测试 100% 全部通过！');
console.log('====================================================');
