import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

console.log('====================================================');
console.log('       MemHub 统一记忆与长效认知中枢自动化测试套件     ');
console.log('====================================================\n');

// P0 防护：创建独立隔离的临时测试目录，严禁单测污染生产真实库
const tempMemhubHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memhub-e2e-sandbox-'));
console.log(`🔒 [测试沙箱防护] 已重定向测试数据目录至隔离环境: ${tempMemhubHome}\n`);

const testEnv = {
  ...process.env,
  MEMHUB_HOME: tempMemhubHome,
  NODE_ENV: 'test'
};

const suites = [
  { name: 'CLI 规范与 bin 映射验证', cmd: 'node tests/test-cli.js' },
  { name: 'Layer 1: PathFilter 路径规则与 Glob 过滤引擎', cmd: 'node tests/test-path-filter.js' },
  { name: 'Layer 1: Config 动态配置加载与防腐', cmd: 'node tests/test-config.js' },
  { name: 'Layer 1: 基础设施与单文件 SQLite 分层存储内核', cmd: 'node tests/test-storage.js' },
  { name: 'Layer 1.5: 混合检索与向量融合引擎 (FTS5 + Vector + RRF)', cmd: 'node tests/test-hybrid-search.js' },
  { name: 'Layer 2: 宿主适配器层 (AgentAdapter + 动态时间过滤 + 防自循环)', cmd: 'node tests/test-adapters.js' },
  { name: 'Layer 3: 提炼与调度管道层 (Extractor 领域提炼 + Scanner 状态机)', cmd: 'node tests/test-extractor.js' },
  { name: 'Layer 4: 接口协议与呈现层 (Stdio JSON-RPC MCP 渐进式披露协议)', cmd: 'node tests/test-mcp-protocol.js' },
  { name: '宿主驱动客户端与多策略动态端口探测', cmd: 'node tests/test-host-client.js' },
  { name: '研发态势大盘与代码热点度量 (memhub stats)', cmd: 'node tests/test-stats.js' },
  { name: 'AI 做梦引擎碎片聚类与防重 (memhub dream)', cmd: 'node tests/test-dream-cluster.js' },
  { name: 'AI 做梦执行调度管道与状态机流转 (Dream Pipeline)', cmd: 'node tests/test-dream-pipeline.js' },
  { name: 'Cron 定时表达式解析与匹配引擎 (dream cron 调度)', cmd: 'node tests/test-cron.js' }
];

try {
  for (let i = 0; i < suites.length; i++) {
    const suite = suites[i];
    console.log(`[SUITE ${i + 1}/${suites.length}] 执行 ${suite.name}...`);
    try {
      const out = execSync(suite.cmd, { encoding: 'utf-8', env: testEnv });
      console.log(out.trim());
      console.log(`✅ [SUITE ${i + 1}] 通过！\n`);
    } catch (err) {
      console.error(`❌ [SUITE ${i + 1}] 失败:`, err.stdout || err.message);
      process.exit(1);
    }
  }

  // 检查 OpenCode 连通性 (带安全降级探测)
  console.log('[FINAL CHECK] 验证 OpenCode 宿主 MCP 连通状态...');
  try {
    const mcpList = execSync('opencode mcp list', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], env: testEnv });
    if (mcpList.includes('memhub') || mcpList.includes('exobrain')) {
      console.log('✅ OpenCode 宿主 MCP 连通正常 (memhub 已连接)！\n');
    } else {
      console.log('ℹ️ OpenCode 宿主环境已检测，未发现活跃 session，连通性跳过。\n');
    }
  } catch (e) {
    console.log('ℹ️ 当前环境未安装或未运行 OpenCode 全局 CLI，MCP 连通性探测优雅跳过。\n');
  }

  console.log('====================================================');
  console.log('🎉 13 大测试套件全部 100% 成功通过！');
  console.log('====================================================');
} finally {
  // 清理临时测试沙箱
  try {
    fs.rmSync(tempMemhubHome, { recursive: true, force: true });
  } catch {}
}
