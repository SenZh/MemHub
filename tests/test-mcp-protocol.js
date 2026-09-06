import { spawn } from 'node:child_process';
import assert from 'node:assert';
import path from 'node:path';

const serverScript = path.resolve('src/index.js');
const child = spawn('node', [serverScript], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let buffer = '';
const pendingRequests = new Map();
let reqId = 1;

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop(); // 保留未完整的最后一行

  for (const line of lines) {
    if (line.trim() === '') continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pendingRequests.has(msg.id)) {
        const resolve = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        resolve(msg);
      }
    } catch (e) {
      // 忽略非 json
    }
  }
});

function sendRequest(method, params = {}) {
  return new Promise((resolve) => {
    const id = reqId++;
    pendingRequests.set(id, resolve);
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    }) + '\n';
    child.stdin.write(payload);
  });
}

async function runTest() {
  console.log('--- 1. 发送 MCP 初始化请求 (initialize) ---');
  const initRes = await sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  });
  console.log('初始化响应:', initRes.result?.serverInfo);
  // 严格校验名称为 memhub
  assert.strictEqual(initRes.result?.serverInfo?.name, 'memhub', 'Server Name 必须精确为 memhub');

  console.log('\n--- 2. 发送 tools/list 获取注册工具并扫描工具描述防反弹 ---');
  const listRes = await sendRequest('tools/list');
  const tools = listRes.result?.tools || [];
  console.log('注册工具数量:', tools.length);
  const toolNames = tools.map(t => t.name);
  console.log('工具名列表:', toolNames);
  assert(toolNames.includes('hub_record_knowledge'));
  assert(toolNames.includes('hub_search_knowledge'));
  assert(toolNames.includes('hub_get_knowledge'));
  assert(toolNames.includes('hub_list_recent'));
  assert(toolNames.includes('exo_record_knowledge')); // 向后兼容

  // 严密断言：所有工具描述中不得出现 Memory Hub 残留
  tools.forEach(t => {
    assert(!t.description.includes('Memory Hub'), `工具 [${t.name}] 的描述中存在 Memory Hub 残留！`);
  });
  console.log('   ✅ 工具描述防反弹扫描通过 (无 Memory Hub 残留)');

  console.log('\n--- 3. 调用 hub_record_knowledge 记录知识 ---');
  const recordRes = await sendRequest('tools/call', {
    name: 'hub_record_knowledge',
    arguments: {
      title: '[SpringSecurity6] 升级后 SecurityFilterChain 循环依赖解耦方案',
      category: 'decisions',
      tags: ['spring', 'security', 'java', '循环依赖'],
      symptom: '升级到 Spring Boot 3.2 之后，自定义 UserDetailsService 注入 AuthenticationManager 导致 BeanCurrentlyInCreationException',
      root_cause: 'Spring Security 6 移除了默认的全局 AuthenticationManagerConfigurer，改由 SecurityFilterChain 依赖注入，造成循环链条',
      solution: '采用 @Lazy 注入 AuthenticationManager，或改用 AuthenticationConfiguration.getAuthenticationManager() 获取单例',
      related_files: ['SecurityConfig.java']
    }
  });
  console.log('Record 工具响应:', recordRes.result?.content?.[0]?.text);
  assert(!recordRes.result?.isError);
  const recordData = JSON.parse(recordRes.result?.content?.[0]?.text);
  assert(recordData.success === true);
  const createdId = recordData.id;

  console.log('\n--- 4. 调用 hub_search_knowledge (验证渐进式 L1 检索与 instruction 引导) ---');
  const searchRes = await sendRequest('tools/call', {
    name: 'hub_search_knowledge',
    arguments: {
      query: '循环依赖'
    }
  });
  console.log('Search 工具响应:\n' + searchRes.result?.content?.[0]?.text);
  assert(!searchRes.result?.isError);
  const searchPayload = JSON.parse(searchRes.result?.content?.[0]?.text);
  assert(searchPayload.total_hits > 0);
  assert(searchPayload.instruction.includes('hub_get_knowledge')); // 验证 instruction 引导
  assert(searchPayload.results.some(r => r.id === createdId));

  console.log('\n--- 5. 调用 hub_get_knowledge (第二阶段按需拉取完整 L2/L3 代码详情) ---');
  const getRes = await sendRequest('tools/call', {
    name: 'hub_get_knowledge',
    arguments: {
      ids: [createdId]
    }
  });
  console.log('Get 工具响应卡片前 200 字:\n' + getRes.result?.content?.[0]?.text.slice(0, 200) + '...');
  assert(!getRes.result?.isError);
  assert(getRes.result?.content?.[0]?.text.includes('AuthenticationConfiguration'));

  console.log('\n--- 6. 调用 hub_list_recent ---');
  const recentRes = await sendRequest('tools/call', {
    name: 'hub_list_recent',
    arguments: { limit: 3 }
  });
  console.log('List 工具响应:\n' + recentRes.result?.content?.[0]?.text);
  assert(!recentRes.result?.isError);

  console.log('\n🎉 端到端 JSON-RPC stdio MCP 协议集成测试全部通过！');
  child.kill();
  process.exit(0);
}

runTest().catch((err) => {
  console.error('测试失败:', err);
  child.kill();
  process.exit(1);
});
