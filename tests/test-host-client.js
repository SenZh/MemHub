import assert from 'node:assert';
import http from 'node:http';
import {
  discoverOpenCodeServer,
  buildExtractionPrompt,
  dispatchExtractionPrompt,
  readSessionMessages,
  listCandidateSessions,
  getSessionUpdatedTime
} from '../src/host/opencode-client.js';

console.log('=== [单测: OpenCode 宿主驱动客户端 opencode-client] ===');

let server;
let receivedPaths = [];
let mockSessionsData = [];

function startMockServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      receivedPaths.push(req.url);
      if (req.url.startsWith('/global/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ healthy: true, version: '1.18.16' }));
        return;
      }
      if (req.url === '/session' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(mockSessionsData));
        return;
      }
      if (req.url.startsWith('/session/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[]');
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function stopMockServer() {
  return new Promise((resolve) => {
    receivedPaths = [];
    mockSessionsData = [];
    server.close(() => resolve());
  });
}

// 1. 通过显式 baseUrl 动态发现 mock server
console.log('1. discoverOpenCodeServer 显式 baseUrl 探测命中...');
const port = await startMockServer();
try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const found = await discoverOpenCodeServer({ explicitBaseUrl: baseUrl });
  assert(found === baseUrl, `应命中显式 baseUrl，实际 ${found}`);
  console.log('   ✅ 命中显式 baseUrl');

  // 2. 无显式 baseUrl 时，discover 能通过"进程命令行 + 默认端口 + 监听端口枚举"命中一个健康 server
  console.log('2. discoverOpenCodeServer 无显式 baseUrl 也能自主动态发现健康 server...');
  const found2 = await discoverOpenCodeServer({ explicitBaseUrl: '', timeoutMs: 400, allowBroadScan: false });
  assert(found2 && typeof found2 === 'string' && found2.startsWith('http'), `应动态发现一个 baseUrl，实际 ${found2}`);
  console.log(`   ✅ 动态发现命中: ${found2}`);
} finally {
  await stopMockServer();
}

// 3. 发现失败返回 null
console.log('3. 无可达 opencode server 时返回 null...');
const gone = await discoverOpenCodeServer({ explicitBaseUrl: 'http://127.0.0.1:1', timeoutMs: 300 });
assert(gone === null, '不可达端口应返回 null');
console.log('   ✅ 返回 null');

// 4. buildExtractionPrompt 生成含 session_id 与 memhub_save 指引的指令
console.log('4. buildExtractionPrompt 生成规范沉淀指令...');
const prompt = buildExtractionPrompt({ targetSessionId: 'ses-abc' });
assert(prompt.includes('ses-abc'), '应包含目标 session_id');
assert(prompt.includes('memhub_save'), '应指引宿主调用 memhub_save');
assert(prompt.includes('learnings'), '应包含分类 learnings');
assert(prompt.includes('无需沉淀'), '应包含无需沉淀门禁');
console.log('   ✅ 指令内容完整');

// 5. dispatchExtractionPrompt 默认 dry-run 桩，不真发 POST
console.log('5. dispatchExtractionPrompt 默认 dryRun 桩，不真发 POST...');
const p = await startMockServer();
try {
  const baseUrl = `http://127.0.0.1:${p}`;
  const before = receivedPaths.length;
  const result = await dispatchExtractionPrompt(baseUrl, { sessionId: 'ses-1', dryRun: true });
  assert(result.dryRun === true, 'dryRun 应为 true');
  assert(receivedPaths.length === before, 'dryRun 模式不应向 server 发请求');
  assert(result.url.endsWith('/session/ses-1/prompt_async'), '应生成正确的注入 URL');
  assert(result.posted === undefined, 'dryRun 不应有 posted 字段');
  console.log('   ✅ 桩模式未发送任何请求');
} finally {
  await stopMockServer();
}

// 6. 真发模式：dispatch 实际向 mock server POST
console.log('6. dispatchExtractionPrompt 真发模式向 server POST...');
const p2 = await startMockServer();
try {
  const baseUrl = `http://127.0.0.1:${p2}`;
  const result = await dispatchExtractionPrompt(baseUrl, { sessionId: 'ses-2', dryRun: false });
  assert(result.posted === true, '真发模式应成功 POST');
  assert(receivedPaths.some(u => u === '/session/ses-2/prompt_async'), '应命中 prompt_async 端点');
  console.log('   ✅ 真发模式成功');
} finally {
  await stopMockServer();
}

// 7. listCandidateSessions 时间窗口、静默阈值与防重过滤测试
console.log('7. listCandidateSessions 候选会话筛选与过滤门禁...');
const p3 = await startMockServer();
try {
  const baseUrl = `http://127.0.0.1:${p3}`;
  const now = Date.now();
  mockSessionsData = [
    // 1: 活跃中（才更新 10 分钟） -> 静默不足 120 分钟 -> 排除
    { id: 'ses-active', title: 'active', time: { updated: now - 10 * 60000 } },
    // 2: 合格冷态（更新于 3 小时前，在 7 天内） -> 应当入选
    { id: 'ses-cold-valid', title: 'cold-valid', time: { updated: now - 3 * 3600000 } },
    // 3: 超过 7 天（比如 10 天前） -> 窗口超期 -> 排除
    { id: 'ses-expired', title: 'expired', time: { updated: now - 10 * 86400000 } },
    // 4: 正在运行态 running -> 排除
    { id: 'ses-running', title: 'running', status: 'running', time: { updated: now - 3 * 3600000 } },
    // 5: 已经在排除列表中的（已处理过） -> 排除
    { id: 'ses-processed', title: 'processed', time: { updated: now - 4 * 3600000 } }
  ];

  const candidates = await listCandidateSessions(baseUrl, {
    windowDays: 7,
    idleMinutes: 120,
    excludeIds: new Set(['ses-processed']),
    limit: 5
  });

  assert(candidates.length === 1, `应只有 ses-cold-valid 1 个会话入选，实际有 ${candidates.length} 个`);
  assert(candidates[0].id === 'ses-cold-valid');
  console.log('   ✅ 7天窗口 + 120分钟静默 + running过滤 + 已抽取防重 全部精准通过');
} finally {
  await stopMockServer();
}

// 8. listCandidateSessions scanRules 路径过滤（include 与 exclude 黑名单拦截）
console.log('8. listCandidateSessions scanRules 路径 include/exclude 拦截测试...');
const p4 = await startMockServer();
try {
  const baseUrl = `http://127.0.0.1:${p4}`;
  const now = Date.now();
  mockSessionsData = [
    // 合格路径
    { id: 'ses-allowed', directory: 'D:/workspace/important-project/sub', time: { updated: now - 3 * 3600000 } },
    // 命中 exclude 黑名单（tmp 目录）
    { id: 'ses-excluded-tmp', directory: 'D:/workspace/tmp/test', time: { updated: now - 3 * 3600000 } },
    // 命中 exclude 黑名单（node_modules）
    { id: 'ses-excluded-node', directory: 'D:/workspace/node_modules/pkg', time: { updated: now - 3 * 3600000 } },
    // 未命中 include 白名单
    { id: 'ses-other-unmatched', directory: 'D:/workspace/other-repo', time: { updated: now - 3 * 3600000 } }
  ];

  const filteredCandidates = await listCandidateSessions(baseUrl, {
    windowDays: 7,
    idleMinutes: 120,
    scanRules: {
      include: ['**/important-project/**'],
      exclude: ['**/tmp/**', '**/node_modules/**']
    }
  });

  assert(filteredCandidates.length === 1, `应只有 ses-allowed 1 个会话入选，实际有 ${filteredCandidates.length} 个`);
  assert(filteredCandidates[0].id === 'ses-allowed');
  console.log('   ✅ include 白名单放行与 exclude 黑名单拦截全部精准通过');
} finally {
  await stopMockServer();
}

console.log('\n🎉 OpenCode 宿主驱动客户端 8 项断言全部通过！');
