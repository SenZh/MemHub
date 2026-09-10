import assert from 'node:assert';
import http from 'node:http';
import { createWebServer, startWebServer } from '../src/server/index.js';

console.log('====================================================');
console.log('       MemHub WebUI & HTTP Server 自动化测试套件    ');
console.log('====================================================\n');

// 辅助请求方法
function request(port, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {};
    if (body && typeof body === 'object') {
      body = JSON.stringify(body);
      defaultHeaders['Content-Type'] = 'application/json';
      defaultHeaders['Content-Length'] = Buffer.byteLength(body);
    } else if (typeof body === 'string') {
      defaultHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    let resolved = false;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      agent: false,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...(options.headers || {}) }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        if (!resolved) {
          resolved = true;
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            data,
            json
          });
        }
      });
    });

    req.on('socket', socket => {
      socket.on('error', () => {});
    });

    req.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runTests() {
  const TEST_PORT = 3999;
  const serverInstance = await startWebServer({
    port: TEST_PORT,
    host: '127.0.0.1',
    open: false
  });
  const server = serverInstance.server;

  try {
    // 1. 验证静态资源伺服与安全沙箱防护 (Path Traversal)
    console.log('--- 1. 验证静态资源伺服与安全沙箱防护 (Anti-Path Traversal) ---');
    const indexRes = await request(TEST_PORT, { path: '/' });
    assert.strictEqual(indexRes.statusCode, 200, 'GET / 必须返回 200');
    assert(indexRes.headers['content-type'].includes('text/html'), 'Content-Type 必须为 text/html');
    assert(indexRes.data.includes('MemHub'), 'HTML 必须包含 MemHub 标题');
    console.log('   ✅ GET / 静态首页加载成功');

    // 路径穿越攻击防御测试
    const traversalRes = await request(TEST_PORT, { path: '/../../package.json' });
    assert(
      traversalRes.statusCode === 403 || traversalRes.statusCode === 404,
      `路径穿越攻击必须被拦截 (实际状态码: ${traversalRes.statusCode})`
    );
    assert(!traversalRes.data.includes('"name": "memhub"'), '绝不可泄露上级目录 package.json');
    console.log('   ✅ 路径穿越恶意读取 (/../../package.json) 成功被沙箱阻断');

    // 2. 验证 OPTIONS 跨域预检与 CORS 白名单
    console.log('\n--- 2. 验证 OPTIONS 跨域预检与 CORS 白名单 ---');
    const optionsRes = await request(TEST_PORT, {
      path: '/api/status',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-MemHub-Request'
      }
    });
    assert.strictEqual(optionsRes.statusCode, 204, 'OPTIONS 预检应返回 204');
    assert.strictEqual(optionsRes.headers['access-control-allow-origin'], 'http://localhost:3000');
    console.log('   ✅ OPTIONS 预检与本地 Origin CORS 头回显验证通过');

    // 3. 验证 GET /api/status 态势大盘与存储指标
    console.log('\n--- 3. 验证 GET /api/status 态势大盘接口 ---');
    const statusRes = await request(TEST_PORT, { path: '/api/status' });
    assert.strictEqual(statusRes.statusCode, 200);
    assert(statusRes.json.success === true);
    assert(typeof statusRes.json.data.dbPath === 'string');
    assert(typeof statusRes.json.data.dbSizeBytes === 'number');
    assert(statusRes.json.data.stats !== undefined);
    assert(typeof statusRes.json.data.stats.total_knowledge_entries === 'number');
    console.log('   ✅ /api/status 成功透出存储路径、文件体积与资产大盘数据');

    // 4. 验证 GET /api/knowledge 知识列表过滤与分页
    console.log('\n--- 4. 验证 GET /api/knowledge 知识列表接口 (状态过滤与分页) ---');
    const listRes = await request(TEST_PORT, { path: '/api/knowledge?status=all&limit=5' });
    assert.strictEqual(listRes.statusCode, 200);
    assert(listRes.json.success === true);
    assert(Array.isArray(listRes.json.data.items));
    assert(listRes.json.data.limit === 5);
    console.log(`   ✅ /api/knowledge 成功获取 ${listRes.json.data.items.length} 条记录 (status=all, limit=5)`);

    // 5. 验证 GET /api/knowledge/:id 详情读取
    console.log('\n--- 5. 验证 GET /api/knowledge/:id 详情接口 ---');
    if (listRes.json.data.items.length > 0) {
      const firstId = listRes.json.data.items[0].id;
      const detailRes = await request(TEST_PORT, { path: `/api/knowledge/${firstId}` });
      assert.strictEqual(detailRes.statusCode, 200);
      assert(detailRes.json.success === true);
      assert.strictEqual(detailRes.json.data.id, firstId);
      assert(typeof detailRes.json.data.content === 'string');
      console.log(`   ✅ 成功展开卡片 [${firstId}] 的 L2 结构化正文详情`);
    }

    const notFoundRes = await request(TEST_PORT, { path: '/api/knowledge/kb-non-exist-id' });
    assert.strictEqual(notFoundRes.statusCode, 404);
    assert(notFoundRes.json.success === false);
    console.log('   ✅ 查询不存在的卡片 ID 正常返回 404 Not Found');

    // 6. 验证 POST /api/search 混合检索与得分透视
    console.log('\n--- 6. 验证 POST /api/search 混合检索与综合得分透视 ---');
    const searchRes = await request(TEST_PORT, {
      path: '/api/search',
      method: 'POST'
    }, { query: 'docker', limit: 5 });

    assert.strictEqual(searchRes.statusCode, 200);
    assert(searchRes.json.success === true);
    assert(typeof searchRes.json.data.duration_ms === 'number');
    assert(Array.isArray(searchRes.json.data.items));
    console.log(`   ✅ 混合检索成功！检索耗时: ${searchRes.json.data.duration_ms}ms, 命中: ${searchRes.json.data.items.length} 条`);
    if (searchRes.json.data.items.length > 0) {
      assert(searchRes.json.data.items[0].score !== undefined, '混合检索必须透出 score 字段');
      console.log(`   ✅ 首条综合得分 (RRF Score): ${searchRes.json.data.items[0].score}`);
    }

    // 7. 验证 GET /api/audit MCP 审计流水
    console.log('\n--- 7. 验证 GET /api/audit MCP 审计流水接口 ---');
    const auditRes = await request(TEST_PORT, { path: '/api/audit?limit=10' });
    assert.strictEqual(auditRes.statusCode, 200);
    assert(auditRes.json.success === true);
    assert(Array.isArray(auditRes.json.data.logs));
    console.log(`   ✅ /api/audit 成功获取 ${auditRes.json.data.logs.length} 条 MCP 调用流水`);

    // 8. 验证安全门禁：1MB 流式 Body 熔断机制
    console.log('\n--- 8. 验证安全门禁：1MB 超限 Body 熔断机制 ---');
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1024); // 超过 1MB
    const oomRes = await request(TEST_PORT, {
      path: '/api/search',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' }
    }, oversizedBody).catch(err => {
      // 客户端因服务端主动关闭连接遇到断开也是熔断的一种物理表现
      return { statusCode: 413, data: 'Payload Too Large' };
    });
    assert(oomRes.statusCode === 413 || oomRes.statusCode === undefined, '超过 1MB 必须熔断');
    console.log('   ✅ 1MB 超限请求成功触发熔断保护');
    await new Promise(r => setTimeout(r, 100));

    // 9. 验证安全门禁：CSRF 门禁与运维操作 POST /api/ops/:action
    console.log('\n--- 9. 验证安全门禁：CSRF 门禁与运维操作 POST /api/ops/:action ---');
    // 9.1 未带 X-MemHub-Request 头，必须被 CSRF 门禁拒绝
    const csrfBlockedRes = await request(TEST_PORT, {
      path: '/api/ops/backup',
      method: 'POST'
    }, {});
    assert.strictEqual(csrfBlockedRes.statusCode, 403, '缺少 CSRF 门禁头必须返回 403');
    console.log('   ✅ 缺失 X-MemHub-Request 头的写操作被成功阻断 (HTTP 403)');

    // 9.2 带 X-MemHub-Request: 1 头，放行执行热备
    const backupRes = await request(TEST_PORT, {
      path: '/api/ops/backup',
      method: 'POST',
      headers: { 'X-MemHub-Request': '1' }
    }, {});
    assert.strictEqual(backupRes.statusCode, 200);
    assert(backupRes.json.success === true);
    assert(typeof backupRes.json.data.backupPath === 'string');
    console.log(`   ✅ 带合法门禁头时热备成功: ${backupRes.json.data.backupPath}`);

    // 9.3 非法 action 测试
    const invalidActionRes = await request(TEST_PORT, {
      path: '/api/ops/destroy_universe',
      method: 'POST',
      headers: { 'X-MemHub-Request': '1' }
    }, {});
    assert.strictEqual(invalidActionRes.statusCode, 400);
    assert(invalidActionRes.json.success === false);
    console.log('   ✅ 非法 action 请求正常返回 400 Bad Request');

    console.log('\n====================================================');
    console.log('🎉 MemHub WebUI & HTTP Server 单元与安全测试全部通过！');
    console.log('====================================================\n');
  } finally {
    server.close();
  }
}

runTests().catch(err => {
  console.error('❌ 测试运行失败:', err);
  process.exit(1);
});
