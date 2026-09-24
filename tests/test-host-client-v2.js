import assert from 'node:assert';
import http from 'node:http';
import {
  discoverOpenCodeServer,
  detectApiVersion,
  clearApiVersionCache,
  dispatchExtractionPrompt,
  readSessionMessages,
  listCandidateSessions,
  getSessionUpdatedTime,
  getSessionDirectory,
  isSubagentSession,
  forkSession,
  snapshotForkBaseline,
  getSessionStatus,
  getLastAssistantProgress,
  waitForSessionIdle,
  deleteSession,
  createSession,
  dispatchSessionPrompt,
  OPENCODE_API_VERSION
} from '../src/host/opencode-client.js';

console.log('=== [单测: OpenCode V2 双版本适配 opencode-client-v2] ===');

let server;
let received = []; // { method, url, body }
let mockSessions = [];
let mockActive = {};
let mockMessages = [];
let mockMessagePages = null; // 多页模式：{ [cursorKey]: { data, next } }
let mockLimitCap = 0;        // 模拟服务端 limit 上限（>0 时超限返回 400，复刻真机 F17）
let forkCounter = 0;

function startV2Mock() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
        const json = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        const pathOnly = req.url.split('?')[0];
        const query = new URLSearchParams(req.url.split('?')[1] || '');

        // V2 版本探测端点：/api/info（ServerInfo）
        if (pathOnly === '/api/info') return json({ version: '2.0.3', pid: 1234, urls: ['http://127.0.0.1'], paths: { tmp: '/tmp' } });
        // V1 端点故意不存在，确保不会被误判为 v1
        if (pathOnly.startsWith('/global/health')) { res.writeHead(404); return res.end('{}'); }

        // active 会话集合
        if (pathOnly === '/api/session/active') return json({ data: mockActive });

        // 会话列表（信封 { data, cursor }）
        if (pathOnly === '/api/session' && req.method === 'GET') {
          return json({ data: mockSessions, cursor: { previous: null, next: null } });
        }
        // 创建会话（信封，location.directory）
        if (pathOnly === '/api/session' && req.method === 'POST') {
          return json({ data: { id: 'ses-created-1', title: req.body?.title, location: { directory: req.body?.location?.directory }, time: { created: Date.now(), updated: Date.now() } } });
        }
        // fork（body.before）
        const forkMatch = pathOnly.match(/^\/api\/session\/([^/]+)\/fork$/);
        if (forkMatch && req.method === 'POST') {
          forkCounter++;
          return json({ data: { id: `ses-fork-${forkCounter}`, location: { directory: 'D:/ws/proj' }, title: `原会话 (fork #${forkCounter})`, time: { created: 1, updated: 2 } } });
        }
        // 消息（支持多页模式 + 顺序/分页断言）
        const msgMatch = pathOnly.match(/^\/api\/session\/([^/]+)\/message$/);
        if (msgMatch && req.method === 'GET') {
          // mockLimitCap：模拟服务端 limit 上限，超过即 400（复刻真机 F17）
          if (mockLimitCap && Number(query.get('limit')) > mockLimitCap) {
            res.writeHead(400, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ _tag: 'InvalidRequestError', message: 'limit too large' }));
          }
          if (mockMessagePages) {
            const cursor = query.get('cursor');
            const key = cursor || '__first__';
            const page = mockMessagePages[key] || { data: [], next: null };
            return json({ data: page.data, cursor: { previous: null, next: page.next } });
          }
          return json({ data: mockMessages, cursor: { previous: null, next: null } });
        }
        // prompt（扁平 { text }）
        const promptMatch = pathOnly.match(/^\/api\/session\/([^/]+)\/prompt$/);
        if (promptMatch && req.method === 'POST') return json({ data: { id: 'msg_1', sessionID: promptMatch[1], type: 'user', payload: { text: req.body?.text }, delivery: 'queue', time: { created: Date.now() } } });
        // 删除
        const delMatch = pathOnly.match(/^\/api\/session\/([^/]+)$/);
        if (delMatch && req.method === 'DELETE') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }

        res.writeHead(404); res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}
function stopMock() {
  return new Promise((resolve) => {
    received = []; mockSessions = []; mockActive = {}; mockMessages = [];
    mockMessagePages = null; mockLimitCap = 0; forkCounter = 0;
    server.close(() => resolve());
  });
}

// 1. 版本探测：/api/info 通即判 v2，且带缓存
console.log('1. detectApiVersion 端点探测判为 V2 并缓存...');
const port = await startV2Mock();
const baseUrl = `http://127.0.0.1:${port}`;
try {
  const v = await detectApiVersion(baseUrl);
  assert.equal(v, OPENCODE_API_VERSION.V2, `应判为 V2，实际 ${v}`);
  const infoHits = received.filter(r => r.url === '/api/info').length;
  assert.equal(infoHits, 1, '首次探测应只打 1 次 /api/info');
  await detectApiVersion(baseUrl);
  assert.equal(received.filter(r => r.url === '/api/info').length, 1, '第二次探测应命中缓存，不再发请求');
  console.log('   ✅ 判定 V2 且按 baseUrl 缓存生效');

  // 2. discoverOpenCodeServer 在 v2 下也能命中
  console.log('2. discoverOpenCodeServer 显式 baseUrl 在 V2 下命中...');
  const found = await discoverOpenCodeServer({ explicitBaseUrl: baseUrl });
  assert.equal(found, baseUrl, '应命中 V2 显式 baseUrl');

  // 3. 会话列表解包信封 + location.directory 归一化
  console.log('3. listCandidateSessions 解包 { data } 信封并归一化 location.directory...');
  const now = Date.now();
  mockSessions = [
    { id: 'ses-cold', title: '冷态合格', location: { directory: 'D:/ws/proj-a' }, time: { created: now - 4 * 3600000, updated: now - 3 * 3600000 } },
    { id: 'ses-hot', title: '太新', location: { directory: 'D:/ws/proj-b' }, time: { created: now, updated: now - 10 * 60000 } },
    { id: 'ses-sub', parentID: 'ses-cold', title: '子任务', location: { directory: 'D:/ws/proj-a' }, time: { created: 1, updated: now - 3 * 3600000 } }
  ];
  const cands = await listCandidateSessions(baseUrl, { windowDays: 7, idleMinutes: 120 });
  assert.equal(cands.length, 1, `应只 1 个合格会话，实际 ${cands.length}`);
  assert.equal(cands[0].id, 'ses-cold');
  assert.equal(cands[0].directory, 'D:/ws/proj-a', 'directory 应从 location.directory 归一化取出');
  assert.equal(getSessionUpdatedTime({ time: { updated: 555 } }), 555);
  assert.equal(getSessionDirectory({ location: { directory: 'X:/y' } }), 'X:/y');
  console.log('   ✅ 信封解包 + location 归一化 + 时间窗口/静默/subagent 门禁全通过');

  // 4. 消息读取：v2 typed message 结构
  console.log('4. readSessionMessages 解析 V2 判别联合消息...');
  mockMessages = [
    { id: 'msg_u1', type: 'user', text: '帮我复盘这次改造', time: { created: 1 } },
    { id: 'msg_a1', type: 'assistant', agent: 'build', model: { id: 'm', providerID: 'p' }, content: [
      { type: 'reasoning', text: '先想一下' },
      { type: 'text', text: '结论：已完成记忆沉淀' },
      { type: 'tool', name: 'memhub_save', state: { status: 'completed', input: {}, content: [] }, time: { created: 2 } }
    ], time: { created: 2, completed: 3 } }
  ];
  const msgs = await readSessionMessages(baseUrl, 'ses-cold');
  assert.equal(msgs.length, 2, `应解析出 2 条文本消息，实际 ${msgs.length}`);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].text, '帮我复盘这次改造');
  assert.equal(msgs[1].role, 'assistant');
  assert(msgs[1].text.includes('结论：已完成记忆沉淀') && msgs[1].text.includes('先想一下'), 'assistant 应合并 text 与 reasoning');
  // V2 消息请求必须带 limit（分页），且不得出现 order（真机 F13：order 与 cursor 互斥）
  const msgReqs = received.filter(r => /\/message(\?|$)/.test(r.url));
  assert(msgReqs.length > 0, '应命中消息端点');
  assert(msgReqs.every(r => r.url.includes('limit=')), 'V2 消息请求应显式带 limit');
  assert(msgReqs.every(r => !r.url.includes('order=')), 'V2 消息请求不得带 order（与 cursor 互斥）');
  console.log('   ✅ V2 typed message 正确归一化，且分页参数合规（带 limit、不带 order）');

  // 5. getLastAssistantProgress：仅 completed 判完成，streamed 不再 OR（R3 修复）
  console.log('5. getLastAssistantProgress 移除 streamed OR，仅认 completed...');
  mockMessages = [
    { id: 'msg_a1', type: 'assistant', content: [{ type: 'text', text: 'x' }], time: { created: 1, streamed: 2 } }
  ];
  const progStreamed = await getLastAssistantProgress(baseUrl, 'ses-cold');
  assert.equal(progStreamed.hasReply, true);
  assert.equal(progStreamed.completed, false, '仅有 streamed 无 completed 应判未完成（R3）');

  mockMessages = [{ id: 'msg_a2', type: 'assistant', content: [], time: { created: 9 } }];
  const prog2 = await getLastAssistantProgress(baseUrl, 'ses-cold');
  assert.equal(prog2.completed, false, '无 completed 应判未完成');
  console.log('   ✅ 仅 streamed / 无 completed 均判未完成（streamed OR 已移除）');

  // 6. getSessionStatus 用 /api/session/active：在集合中即 running，否则 unknown（R1 修复）
  console.log('6. getSessionStatus：不在 active 集合返回 unknown（不再误判 idle）...');
  mockActive = { 'ses-run': { type: 'running' } };
  assert.equal(await getSessionStatus(baseUrl, 'ses-run'), 'running');
  assert.equal(await getSessionStatus(baseUrl, 'ses-idle'), 'unknown', '不在 active 集合必须返回 unknown，不可判 idle（R1）');
  assert(received.some(r => r.url === '/api/session/active'), '应命中 active 端点');
  console.log('   ✅ V2 active 集合语义修正：不在集合 = unknown');

  // 7. forkSession：body 使用 before，返回信封解包
  console.log('7. forkSession 使用 V2 before 边界字段并解包...');
  const fork = await forkSession(baseUrl, 'ses-origin', { messageID: 'msg_abc' });
  assert.equal(fork.id, 'ses-fork-1');
  assert.equal(fork.directory, 'D:/ws/proj', 'fork 目录应从 location 归一化');
  const forkReq = received.find(r => /\/fork$/.test(r.url));
  assert(forkReq && forkReq.body && forkReq.body.before === 'msg_abc', 'V2 fork 应使用 before 字段');
  assert(!forkReq.body.messageID, 'V2 fork 不应出现 v1 的 messageID 字段');
  console.log('   ✅ V2 fork 参数映射正确');

  // 8. createSession：location.directory 嵌套
  console.log('8. createSession 使用 V2 location.directory 嵌套结构...');
  const created = await createSession(baseUrl, { title: '做梦会话', directory: 'D:/ws/dream' });
  assert.equal(created.id, 'ses-created-1');
  const createReq = received.find(r => r.method === 'POST' && r.url === '/api/session');
  assert(createReq.body.location && createReq.body.location.directory === 'D:/ws/dream', 'V2 应使用 location.directory');
  assert(!createReq.body.directory, 'V2 不应出现顶层 directory');
  console.log('   ✅ V2 创建会话结构正确');

  // 9. dispatchSessionPrompt / dispatchExtractionPrompt：扁平 { text }
  console.log('9. prompt 系列使用 V2 扁平 { text } 请求体...');
  await dispatchSessionPrompt(baseUrl, 'ses-x', '做梦提示词');
  const pReq = received.find(r => /\/prompt$/.test(r.url) && r.body && r.body.text === '做梦提示词');
  assert(pReq, 'V2 prompt 请求体应为 { text }');
  assert(!pReq.body.parts, 'V2 不应出现 v1 的 parts 字段');

  const real = await dispatchExtractionPrompt(baseUrl, { sessionId: 'ses-y', dryRun: false });
  assert.equal(real.posted, true, 'V2 真发应成功');
  assert(real.url.endsWith('/api/session/ses-y/prompt'), 'V2 注入 URL 应指向 /api/session/:id/prompt');
  // dryRun 时不得发任何请求
  const beforeCount = received.length;
  const dry = await dispatchExtractionPrompt(baseUrl, { sessionId: 'ses-z', dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(received.length, beforeCount, 'V2 dryRun 不应发任何网络请求');
  assert(dry.url.endsWith('/api/session/ses-z/prompt'), 'V2 dryRun 的 URL 也应指向 V2 端点（缓存版本）');
  console.log('   ✅ V2 prompt 请求体与 URL 正确，dryRun 保持零请求');

  // 10. deleteSession 走 /api/session/:id
  console.log('10. deleteSession 走 V2 端点...');
  const ok = await deleteSession(baseUrl, 'ses-fork-1');
  assert.equal(ok, true);
  assert(received.some(r => r.method === 'DELETE' && r.url === '/api/session/ses-fork-1'), '应命中 V2 删除端点');

  // 11. isSubagentSession 在 v2 会话对象上仍拦截 fork 副本（含权威 fork 字段）
  console.log('11. isSubagentSession 拦截 V2 fork 副本（权威字段 + 标题正则）...');
  assert.equal(isSubagentSession({ id: 'ses-f', title: '实现功能 (fork #1)', location: { directory: 'D:/x' } }), true);
  assert.equal(isSubagentSession({ id: 'ses-fk', title: '任意标题', fork: { sessionID: 'ses-src', boundary: {} } }), true, 'session.fork.sessionID 存在应拦截（权威标记）');
  assert.equal(isSubagentSession({ id: 'ses-m', title: '主会话', location: { directory: 'D:/x' } }), false);
  // agent 黑名单化：未知 agent（如 plan）不应被误杀
  assert.equal(isSubagentSession({ id: 'ses-plan', agent: 'plan', title: '规划会话' }), false, 'plan 等新主模式不应被误杀（黑名单化）');
  assert.equal(isSubagentSession({ id: 'ses-rev', agent: 'review', title: '审查' }), true, '已知子代理 review 应拦截');
  console.log('   ✅ fork 权威字段 + agent 黑名单拦截，未知模式不误杀');

  // ============ 新增回归用例：R1 / R2 / R3 / R11（T1~T4） ============

  // T1-a. 秒短路回归：fork 空副本（不在 active、无消息）不得被判完成（复刻真机 F10/F11）
  console.log('12. [T1-a] fork 空副本不得秒判完成（复刻真机 F11）...');
  mockActive = { 'ses-src': { type: 'running' } }; // fork 不在集合
  mockMessages = [];
  const t1start = Date.now();
  const shortCircuit = await waitForSessionIdle(baseUrl, 'ses-fork-empty', { pollIntervalMs: 100, maxWaitMs: 700 });
  const t1dt = Date.now() - t1start;
  assert.equal(shortCircuit.completed, false, `空 fork 不得判完成，实际 completed=${shortCircuit.completed}`);
  assert(shortCircuit.waitedMs >= 600, `应等到超时，实际仅 ${shortCircuit.waitedMs}ms（秒短路未修复）`);
  assert.equal(shortCircuit.status, 'timeout', `应标记 timeout，实际 ${shortCircuit.status}`);
  console.log(`   ✅ 空 fork 未秒判完成（耗时 ${t1dt}ms，status=${shortCircuit.status}）`);

  // T1-b. 正向对照：fork 收到 idle 消息后必须判完成
  console.log('13. [T1-b] fork 收到 idle 消息后必须判完成（正向对照）...');
  mockActive = {}; // 始终不在 active，证明完成判定与 active 无关
  mockMessages = [
    { id: 'msg_i', type: 'idle', outcome: 'succeeded', time: { created: 4 } },
    { id: 'msg_a', type: 'assistant', content: [{ type: 'text', text: '已完成沉淀' }], time: { created: 2, completed: 3 } },
    { id: 'msg_u', type: 'user', text: '复盘' }
  ];
  const done = await waitForSessionIdle(baseUrl, 'ses-fork-done', { pollIntervalMs: 100, maxWaitMs: 3000 });
  assert.equal(done.completed, true, `idle 消息存在应判完成，实际 ${done.status}`);
  assert.equal(done.status, 'success');
  assert.equal(done.outcome, 'succeeded');
  console.log('   ✅ idle 消息（outcome=succeeded）触发完成，且与 active 无关');

  // T3. idle + failed 不得判成功（R11-2）
  console.log('14. [T3] idle + outcome=failed 必须结束但不得判成功...');
  mockActive = {};
  mockMessages = [
    { id: 'msg_i', type: 'idle', outcome: 'failed', time: { created: 4 } },
    { id: 'msg_a', type: 'assistant', content: [{ type: 'text', text: '中断了' }], time: { created: 2, completed: 3 } }
  ];
  const failed = await waitForSessionIdle(baseUrl, 'ses-fork-failed', { pollIntervalMs: 100, maxWaitMs: 3000 });
  assert.equal(failed.completed, false, 'outcome=failed 不得判成功');
  assert.equal(failed.status, 'failed', `应标记 failed，实际 ${failed.status}`);
  assert.equal(failed.outcome, 'failed');
  console.log('   ✅ outcome=failed 立即结束且 status=failed，不被当成功');

  // T4. 分页：关键消息落在第 2/3 页，必须翻页才能拿全（复刻真机 F6 多页）
  console.log('15. [T4] 消息分页：关键数据落在后续页必须翻页取全...');
  mockMessagePages = {
    '__first__': {
      data: [
        { id: 'm1', type: 'user', text: 'q1', time: { created: 100 } },
        { id: 'm2', type: 'user', text: 'q2', time: { created: 200 } }
      ], next: 'c1'
    },
    'c1': {
      data: [
        { id: 'm3', type: 'user', text: 'q3', time: { created: 300 } },
        { id: 'm4', type: 'assistant', content: [{ type: 'text', text: '关键回复在第二页' }], time: { created: 400 } }
      ], next: 'c2'
    },
    'c2': {
      data: [
        { id: 'm5', type: 'idle', outcome: 'succeeded', time: { created: 500 } }
      ], next: null
    }
  };
  const allMsgs = await readSessionMessages(baseUrl, 'ses-paged');
  assert.equal(allMsgs.length, 4, `翻页后应合并 4 条文本消息（q1/q2/q3/关键回复），实际 ${allMsgs.length}`);
  assert(allMsgs.some(m => m.text.includes('关键回复在第二页')), '第二页的关键消息必须被取到');
  const pageReqs = received.filter(r => /ses-paged\/message/.test(r.url));
  assert(pageReqs.length === 3, `应翻 3 页，实际 ${pageReqs.length} 次请求`);
  assert(pageReqs[1].url.includes('cursor=c1'), '第 2 页应带 cursor=c1');
  assert(pageReqs[2].url.includes('cursor=c2'), '第 3 页应带 cursor=c2');
  assert(pageReqs.every(r => !r.url.includes('order=')), '翻页全程不得带 order（真机 F13 互斥）');
  // 完成判定也必须能穿透分页看到末页的 idle
  const pagedProg = await getLastAssistantProgress(baseUrl, 'ses-paged');
  assert.equal(pagedProg.completed, true, '末页 idle 消息应被翻页取到并判完成');
  assert.equal(pagedProg.outcome, 'succeeded');
  mockMessagePages = null;
  console.log('   ✅ 多页翻页取全，关键数据与 idle 均未漏，且全程不带 order');

  // T2. V1 裸数组回归（同进程内验证 V1 分支不被 V2 分页逻辑破坏）
  console.log('16. [T2] V1 裸数组契约：V1 消息路径不被 V2 分页破坏...');
  {
    const v1port = await new Promise((resolve) => {
      const s = http.createServer((req, res) => {
        const p = req.url.split('?')[0];
        if (p.startsWith('/global/health')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ healthy: true, version: '1.18.16' }));
        }
        if (p === '/session/status') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end('{}');
        }
        const m = p.match(/^\/session\/([^/]+)\/message$/);
        if (m) {
          res.writeHead(200, { 'content-type': 'application/json' });
          // V1 返回裸数组（无 envelopes / 无 cursor）
          return res.end(JSON.stringify([
            { info: { role: 'user' }, parts: [{ type: 'text', text: '问题' }] },
            { info: { role: 'assistant', time: { created: 1, completed: 2 } }, parts: [{ type: 'text', text: '回答' }] }
          ]));
        }
        res.writeHead(404); res.end('{}');
      });
      s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
    });
    try {
      const v1url = `http://127.0.0.1:${v1port.port}`;
      const v1 = await detectApiVersion(v1url);
      assert.equal(v1, OPENCODE_API_VERSION.V1, '应判为 V1');
      const v1msgs = await readSessionMessages(v1url, 'ses-v1');
      assert.equal(v1msgs.length, 2, `V1 裸数组应解析 2 条，实际 ${v1msgs.length}`);
      const v1prog = await getLastAssistantProgress(v1url, 'ses-v1');
      assert.equal(v1prog.completed, true, 'V1 assistant time.completed 应判完成');
      console.log('   ✅ V1 裸数组路径独立分支正常，未被 V2 分页逻辑破坏');
    } finally {
      await new Promise(r => v1port.server.close(r));
    }
  }

  // T5. F16 回归：fork 副本继承历史 idle 时，不得把继承的 idle 误当完成
  console.log('17. [T5] fork 副本继承历史 idle 时，baselineIds 必须隔离继承消息（复刻真机 F16）...');
  {
    // 复刻真机：fork 副本带着源会话全部历史（含历史 idle+succeeded），
    // 历史之后才是本次新增的消息。baselineIds = 继承历史的 ID 快照集合。
    // 【重要】V2 真实返回为 desc（新→旧），mock 必须按 desc 顺序构造以保真。
    mockMessagePages = null;
    const inheritedIds = ['msg_h1', 'msg_h2', 'msg_h_idle'];
    mockMessages = [
      // ↓ 继承自源会话的历史（含一条 idle+succeeded）
      { id: 'msg_h_idle', type: 'idle', outcome: 'succeeded', time: { created: 13 } },
      { id: 'msg_h2', type: 'assistant', content: [{ type: 'text', text: '历史回答' }], time: { created: 11, completed: 12 } },
      { id: 'msg_h1', type: 'user', text: '历史问题', time: { created: 10 } }
    ];
    // 无 baselineIds：会误命中继承的 idle（复刻修复前行为，证明风险真实存在）
    const withoutBaseline = await getLastAssistantProgress(baseUrl, 'ses-fork-inherit');
    assert.equal(withoutBaseline.completed, true, '（对照）不传 baselineIds 时会被继承 idle 误判完成——风险确实存在');

    // 有 baselineIds：继承消息全被隔离 -> 未完成
    const withBaseline = await getLastAssistantProgress(baseUrl, 'ses-fork-inherit', undefined, { baselineIds: inheritedIds });
    assert.equal(withBaseline.completed, false, '基线之外无完成消息，不得判完成（F16 修复）');
    assert.equal(withBaseline.status, 'incomplete');

    // 有 baselineIds 且之后新增了 idle -> 应判完成（新增消息带新 ID，且总数可能不变——真机副本只保留最近 N 条）
    mockMessages = [
      { id: 'msg_new_idle', type: 'idle', outcome: 'succeeded', time: { created: 17 } },
      { id: 'msg_new_a', type: 'assistant', content: [{ type: 'text', text: '新增抽取结果' }], time: { created: 15, completed: 16 } },
      { id: 'msg_h_idle', type: 'idle', outcome: 'succeeded', time: { created: 13 } },
      { id: 'msg_h2', type: 'assistant', content: [{ type: 'text', text: '历史回答' }], time: { created: 11, completed: 12 } }
    ];
    const afterNew = await getLastAssistantProgress(baseUrl, 'ses-fork-inherit', undefined, { baselineIds: inheritedIds });
    assert.equal(afterNew.completed, true, '基线之外新增 idle 应判完成');
    assert.equal(afterNew.outcome, 'succeeded');

    // 关键：副本始终只保留最近 N 条（旧消息被挤出），但差集法仍应正确识别新增
    mockMessages = [
      { id: 'msg_new_idle', type: 'idle', outcome: 'succeeded', time: { created: 17 } },
      { id: 'msg_new_a', type: 'assistant', content: [{ type: 'text', text: '新增抽取结果' }], time: { created: 15, completed: 16 } }
      // 注意：msg_h1/h2/h_idle 已被挤出（模拟真机副本只留最近 N 条）
    ];
    const squeezed = await getLastAssistantProgress(baseUrl, 'ses-fork-inherit', undefined, { baselineIds: inheritedIds });
    assert.equal(squeezed.completed, true, '历史被挤出后新增 idle 仍应判完成');

    // waitForSessionIdle 端到端：继承 idle 但无新增 -> 不得秒判完成
    mockActive = {};
    mockMessages = [
      { id: 'msg_h_idle', type: 'idle', outcome: 'succeeded', time: { created: 13 } },
      { id: 'msg_h1', type: 'user', text: '历史问题', time: { created: 10 } }
    ];
    const waited = await waitForSessionIdle(baseUrl, 'ses-fork-inherit', {
      pollIntervalMs: 100, maxWaitMs: 700, baselineIds: inheritedIds
    });
    assert.equal(waited.completed, false, '继承 idle 不得让 waitForSessionIdle 秒判完成（F16 端到端）');
    assert.equal(waited.status, 'timeout');
    console.log('   ✅ baselineIds 正确隔离继承的历史 idle，新增 idle 仍能判完成（F16 修复验证）');
  }

  // T6. F17 回归：服务端 limit 上限极低（甚至=1）时，必须能循环降级读到消息
  console.log('18. [T6] limit 超上限 400 时循环降级读取（复刻真机 F17）...');
  {
    mockMessagePages = null;
    mockMessages = [
      { id: 'msg_a', type: 'assistant', content: [{ type: 'text', text: 'r1' }], time: { created: 1, completed: 2 } },
      { id: 'msg_i', type: 'idle', outcome: 'succeeded', time: { created: 3 } },
      { id: 'msg_u', type: 'user', text: 'q1', time: { created: 0 } }
    ];
    // 场景 1：上限 50（比默认 100 低）→ 应降级一次后成功
    mockLimitCap = 50;
    const msgs1 = await readSessionMessages(baseUrl, 'ses-cap50');
    assert.equal(msgs1.length, 2, `上限 50 时应降级读到 2 条文本消息，实际 ${msgs1.length}`);
    const prog1 = await getLastAssistantProgress(baseUrl, 'ses-cap50');
    assert.equal(prog1.completed, true, '上限 50 时仍应正确判定完成');

    // 场景 2（极端）：上限 1 —— 必须能一路降级到 1 仍读到数据
    mockLimitCap = 1;
    const msgs2 = await readSessionMessages(baseUrl, 'ses-cap1');
    assert.equal(msgs2.length, 2, `上限 1 时也必须降级读到 2 条，实际 ${msgs2.length}`);
    const prog2 = await getLastAssistantProgress(baseUrl, 'ses-cap1');
    assert.equal(prog2.completed, true, '上限 1 时仍应正确判定完成（循环降级生效）');

    mockLimitCap = 0;
    console.log('   ✅ limit 超上限时循环降级至可读，含上限=1 的极端场景');
  }

  // T7. F16-c 加固：复制长停顿时，snapshotForkBaseline 不得提前返回残缺快照
  console.log('19. [T7] 复制长停顿时 baseline 不得提前返回（复刻复审 defer 模型）...');
  {
    // 独立 mock：前 4s 只暴露 1 条历史消息 h1；4s 后暴露 h1+h2（h2 是 inherited idle+succeeded）
    let phase = 1;
    const lateServer = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      if (p === '/api/info') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ version: '2.0.3', pid: 1, urls: [], paths: { tmp: '/tmp' } })); }
      if (p.startsWith('/global/health')) { res.writeHead(404); return res.end('{}'); }
      if (/\/message$/.test(p)) {
        const data = phase === 1
          ? [{ id: 'h1', type: 'user', text: '历史1', time: { created: 1 } }]
          : [
            { id: 'h2', type: 'idle', outcome: 'succeeded', time: { created: 3 } },
            { id: 'h1', type: 'user', text: '历史1', time: { created: 1 } }
          ];
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data, cursor: { previous: null, next: null } }));
      }
      res.writeHead(404); res.end('{}');
    });
    const latePort = await new Promise(r => lateServer.listen(0, '127.0.0.1', () => r(lateServer.address().port)));
    const lateUrl = `http://127.0.0.1:${latePort}`;
    try {
      // 4s 后切换到 phase 2（模拟复制停顿后插入 h2）
      setTimeout(() => { phase = 2; }, 4000);
      const baseline = await snapshotForkBaseline(lateUrl, 'ses-late', { timeoutMs: 3000, maxWaitMs: 20000, pollIntervalMs: 1500, minSettleMs: 6000 });
      assert(baseline.has('h2'), '长停顿后插入的 h2 必须被纳入基线（不得提前返回残缺快照）');
      assert(baseline.has('h1'), 'h1 应在基线中');
      // 基线下判定：h2 是历史 idle，已隔离 -> 不得判完成
      const prog = await getLastAssistantProgress(lateUrl, 'ses-late', undefined, { baselineIds: baseline });
      assert.equal(prog.completed, false, '被隔离的继承 idle 不得判完成');
      console.log('   ✅ 复制长停顿场景下基线未提前返回，继承 idle 被正确隔离');
    } finally {
      await new Promise(r => lateServer.close(r));
    }
  }

  // T8. P1-2 回归：轮询期间出现 HTTP 异常（如 401）时，须透出 lastError（不得静默吞错）
  console.log('20. [T8] 轮询异常须透出 lastError（杜绝静默吞错）...');
  {
    // 独立 mock：所有消息端点返回 401（模拟未授权）
    const auth401 = http.createServer((req, res) => {
      const p = req.url.split('?')[0];
      if (p === '/api/info') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ version: '2.0.3', pid: 1, urls: [], paths: { tmp: '/tmp' } })); }
      if (p.startsWith('/global/health')) { res.writeHead(404); return res.end('{}'); }
      if (p === '/api/session/active') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: {} })); }
      // 消息端点：401
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });
    const a401port = await new Promise(r => auth401.listen(0, '127.0.0.1', () => r(auth401.address().port)));
    const a401url = `http://127.0.0.1:${a401port}`;
    try {
      const w = await waitForSessionIdle(a401url, 'ses-401', { pollIntervalMs: 100, maxWaitMs: 500 });
      assert.equal(w.completed, false, '401 时不得判完成');
      assert.equal(w.status, 'timeout');
      assert(w.lastError && w.lastError.includes('401'), `应透出含 401 的 lastError，实际 ${w.lastError}`);
      console.log(`   ✅ 异常被观测到并透出: ${w.lastError}`);
    } finally {
      await new Promise(r => auth401.close(r));
    }
  }

  console.log('\n🎉 OpenCode V2 适配（含 R1/R2/R3/R11/F16/F17 + P1 加固）全部断言通过！');
} finally {
  clearApiVersionCache();
  await stopMock();
}
