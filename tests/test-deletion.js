import assert from 'node:assert';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { 
  getDatabase, 
  recordKnowledge, 
  searchKnowledge, 
  getKnowledge,
  deleteKnowledge 
} from '../src/storage.js';
import { startWebServer } from '../src/server/index.js';

console.log('====================================================');
console.log('       MemHub 手动删除记忆与级联清理专项测试套件      ');
console.log('====================================================\n');

// 辅助 HTTP 请求
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
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runTests() {
  const db = getDatabase();

  // --- 1. 验证底层存储层三表原子级联物理删除 ---
  console.log('--- 1. 验证底层存储层三表原子级联物理删除 (deleteKnowledge) ---');
  const recordRes = recordKnowledge({
    title: '[待删除/测试] 临时调试产生的垃圾卡片 -> 验证彻底物理清除',
    category: 'learnings',
    project: 'test-deletion-proj',
    tags: ['garbage-test-tag', 'ephemeral', 'temp-tag'],
    context: '测试用例创建',
    solution: '调用 deleteKnowledge 彻底抹除'
  });
  assert(recordRes.success === true);
  const testId = recordRes.id;
  console.log(`   📝 已创建待删卡片: ${testId}`);

  // 确认三表中均已存在
  const itemInDb = db.prepare('SELECT id FROM knowledge_items WHERE id = ?').get(testId);
  assert(itemInDb !== undefined, '主表必须存在该卡片');

  const ftsInDb = db.prepare('SELECT id FROM knowledge_fts WHERE id = ?').all(testId);
  assert(ftsInDb.length > 0, 'FTS 倒排索引必须存在');

  const vecInDb = db.prepare('SELECT id FROM knowledge_embeddings WHERE id = ?').get(testId);
  assert(vecInDb !== undefined, '向量空间必须存在');
  console.log('   ✅ 物理验证：主表、FTS5 倒排表、384维向量表三表初始数据全部在位');

  // 执行级联删除
  const delRes = deleteKnowledge(testId);
  assert.strictEqual(delRes.success, true);
  assert.strictEqual(delRes.id, testId);
  console.log(`   🗑️ 已调用 deleteKnowledge: ${delRes.message}`);

  // 断言三表均被彻底物理抹除
  const itemAfter = db.prepare('SELECT id FROM knowledge_items WHERE id = ?').get(testId);
  assert.strictEqual(itemAfter, undefined, '主表记录必须被物理删除');

  const ftsAfter = db.prepare('SELECT id FROM knowledge_fts WHERE id = ?').all(testId);
  assert.strictEqual(ftsAfter.length, 0, 'FTS5 倒排索引必须被彻底抹除');

  const vecAfter = db.prepare('SELECT id FROM knowledge_embeddings WHERE id = ?').get(testId);
  assert.strictEqual(vecAfter, undefined, '向量表记录必须被彻底抹除');
  console.log('   ✅ 物理验证：三表中对应记录均已彻底抹除');

  // 验证无幽灵命中
  const searchCheck = searchKnowledge('garbage-test-tag', { limit: 10 });
  assert(!searchCheck.some(r => r.id === testId), '混合检索绝不可出现幽灵召回 (Ghost Hit)');
  console.log('   ✅ 混合检索幽灵召回防线验证通过 (0 Ghost Hits)');

  // 幂等与不存在校验
  const duplicateDel = deleteKnowledge(testId);
  assert.strictEqual(duplicateDel.success, false);
  assert.strictEqual(duplicateDel.notFound, true);
  console.log('   ✅ 重复删除或不存在 ID 返回 notFound 验证通过');

  // --- 2. 验证 HTTP 服务端 DELETE /api/knowledge/:id 路由与 CSRF 防御 ---
  console.log('\n--- 2. 验证 HTTP 服务端 DELETE /api/knowledge/:id 接口 ---');
  const TEST_PORT = 3998;
  const { server } = await startWebServer({ port: TEST_PORT, host: '127.0.0.1', open: false });

  try {
    // 创建一张供 HTTP 删除测试的卡片
    const httpCard = recordKnowledge({
      title: '[HTTP测试/待删除] 用于验证 REST DELETE 接口的卡片',
      category: 'decisions',
      project: 'test-http-proj',
      tags: ['http-del-test'],
      context: 'HTTP DELETE 测试',
      solution: 'DELETE /api/knowledge/:id'
    });
    const httpCardId = httpCard.id;

    // 2.1 未带 CSRF 头，必须被 403 拦截
    const blockedRes = await request(TEST_PORT, {
      path: `/api/knowledge/${httpCardId}`,
      method: 'DELETE'
    });
    assert.strictEqual(blockedRes.statusCode, 403, '无 CSRF 请求头的 DELETE 必须响应 403');
    console.log('   ✅ 缺失 X-MemHub-Request 头的 DELETE 请求成功被 403 阻断');

    // 2.2 带合法 CSRF 头，成功删除响应 200
    const successRes = await request(TEST_PORT, {
      path: `/api/knowledge/${httpCardId}`,
      method: 'DELETE',
      headers: { 'X-MemHub-Request': '1' }
    });
    assert.strictEqual(successRes.statusCode, 200);
    assert.strictEqual(successRes.json.success, true);
    assert.strictEqual(successRes.json.data.id, httpCardId);
    console.log(`   ✅ 带合法门禁头时 DELETE 成功响应 200: ${successRes.json.data.message}`);

    // 2.3 再次删除同一卡片，响应 404
    const notFoundRes = await request(TEST_PORT, {
      path: `/api/knowledge/${httpCardId}`,
      method: 'DELETE',
      headers: { 'X-MemHub-Request': '1' }
    });
    assert.strictEqual(notFoundRes.statusCode, 404);
    assert.strictEqual(notFoundRes.json.success, false);
    console.log('   ✅ 重复删除该卡片返回 404 Not Found');

    // --- 3. 验证兼容运维接口 POST /api/ops/delete ---
    console.log('\n--- 3. 验证兼容运维路由 POST /api/ops/delete ---');
    const opsCard = recordKnowledge({
      title: '[POST兼容测试/待删除] 用于验证 POST /api/ops/delete 的卡片',
      category: 'patterns',
      project: 'test-ops-proj',
      tags: ['ops-del-test'],
      context: 'POST /api/ops/delete 测试',
      solution: '通过 Body { id } 删除'
    });
    const opsCardId = opsCard.id;

    // 3.1 缺少 body.id 响应 400
    const badBodyRes = await request(TEST_PORT, {
      path: '/api/ops/delete',
      method: 'POST',
      headers: { 'X-MemHub-Request': '1' }
    }, {});
    assert.strictEqual(badBodyRes.statusCode, 400);
    console.log('   ✅ 缺少 body.id 请求正常返回 400 Bad Request');

    // 3.2 合法携带 body.id 响应 200
    const opsDelRes = await request(TEST_PORT, {
      path: '/api/ops/delete',
      method: 'POST',
      headers: { 'X-MemHub-Request': '1' }
    }, { id: opsCardId });
    assert.strictEqual(opsDelRes.statusCode, 200);
    assert.strictEqual(opsDelRes.json.success, true);
    assert.strictEqual(opsDelRes.json.data.id, opsCardId);
    console.log(`   ✅ 兼容路由 POST /api/ops/delete 成功删除并响应 200: ${opsDelRes.json.data.title}`);

  } finally {
    server.close();
  }

  // --- 4. 验证 CLI 命令 memhub delete / rm ---
  console.log('\n--- 4. 验证 CLI 命令体系 memhub delete / rm ---');
  const cliCard = recordKnowledge({
    title: '[CLI测试/待删除] 用于验证 CLI memhub delete --yes 的卡片',
    category: 'learnings',
    project: 'test-cli-proj',
    tags: ['cli-del-test'],
    context: 'CLI 删除测试',
    solution: 'node src/cli.js delete <id> --yes'
  });
  const cliCardId = cliCard.id;

  const cliOutput = execSync(`node src/cli.js delete ${cliCardId} --yes`, { encoding: 'utf-8' });
  assert(cliOutput.includes('已成功物理删除'), 'CLI 静默删除输出必须包含成功提示');
  assert(getKnowledge(cliCardId) === null, 'CLI 删除后卡片必须不复存在');
  console.log('   ✅ CLI 命令 `memhub delete <id> --yes` 执行成功');

  console.log('\n====================================================');
  console.log('🎉 MemHub 手动删除记忆与三表级联清理专项测试全部通过！');
  console.log('====================================================\n');
}

runTests().catch(err => {
  console.error('❌ 测试运行异常:', err);
  process.exit(1);
});
