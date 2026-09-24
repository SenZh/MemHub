/**
 * fork 真机实测：验证 (1) fork 后 title 是否含 (fork #N)；(2) fork 是否进 /api/session/active；
 * (3) fork 返回体结构；(4) prompt 注入后 session 的状态流转。
 * 用完即删 fork 副本，不留残留。
 */
import { forkSession, createSession, getSessionStatus, deleteSession, dispatchSessionPrompt,
         listCandidateSessions, getLastAssistantProgress, waitForSessionIdle } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function raw(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: hdr });
  const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch { body = text.slice(0,150); }
  return { status: res.status, body };
}

line(`\n===== fork 真机实测 @ ${baseUrl} =====\n`);

// 取一个有历史的会话做 fork 源
const list = await raw('/api/session?limit=10');
const source = (list.body.data || []).find(s => s.id);
if (!source) { line('无源会话，中止'); process.exit(0); }
line(`源会话: ${source.id}  title=${JSON.stringify(source.title)}  dir=${source.location?.directory}`);

// ---- 测试 1：fork ----
line('\n【测试1】forkSession 返回体结构 + title 是否改写');
const fork = await forkSession(baseUrl, source.id, { timeoutMs: 20000 });
line(`  fork 返回: id=${fork.id}  title=${JSON.stringify(fork.title)}  dir=${fork.directory}`);
line(`  是否含 (fork #N) 后缀 => ${/\(fork #\d+\)$/i.test(String(fork.title)) ? '✅ 含' : '❌ 不含！R6 风险成立'}`);
line(`  fork 返回体顶层字段: ${Object.keys(fork).join(', ')}`);
line(`  是否有 fork 字段: ${'fork' in fork}  ${fork.fork ? JSON.stringify(fork.fork) : ''}`);

// ---- 测试 2：fork 是否在 active ----
line('\n【测试2】fork 副本是否进入 /api/session/active');
{
  const act = await raw('/api/session/active');
  const keys = act.body?.data ? Object.keys(act.body.data) : [];
  line(`  active 集合: ${JSON.stringify(keys)}`);
  line(`  fork 是否在集合中 => ${keys.includes(fork.id) ? '✅ 在（running）' : '❌ 不在（判定为 idle）'}`);
  const st = await getSessionStatus(baseUrl, fork.id);
  line(`  getSessionStatus(fork) => ${st}`);
  const stSrc = await getSessionStatus(baseUrl, source.id);
  line(`  getSessionStatus(源会话) => ${stSrc}`);
}

// ---- 测试 3：waitForSessionIdle 对刚 fork 的会话会不会秒判完成 ----
line('\n【测试3】waitForSessionIdle 对刚 fork 的空会话（关键：是否秒短路）');
{
  const t0 = Date.now();
  const w = await waitForSessionIdle(baseUrl, fork.id, { pollIntervalMs: 1000, maxWaitMs: 8000, onWait: (s, ms) => line(`    [wait] status=${s} waited=${ms}ms`) });
  const dt = Date.now() - t0;
  line(`  结果: completed=${w.completed} finalStatus=${w.finalStatus} 耗时=${dt}ms`);
  line(`  => ${dt < 3000 && w.completed ? '❌ 秒短路！R1 确证成立（刚 fork 就被判完成）' : '未秒短路'}`);
}

// ---- 测试 4：注入 prompt 后状态流转 + idle 消息出现 ----
line('\n【测试4】注入 prompt 后：status 流转 + 是否出现 idle 消息 + completed 时序');
{
  await dispatchSessionPrompt(baseUrl, fork.id, '请只回复两个字：收到', { timeoutMs: 20000 });
  line('  已注入 prompt，开始观测...');
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const act = await raw('/api/session/active');
    const inActive = !!(act.body?.data?.[fork.id]);
    const msgs = await raw(`/api/session/${encodeURIComponent(fork.id)}/message?limit=50`);
    const arr = msgs.body?.data || [];
    const asst = arr.filter(m => m.type === 'assistant');
    const idle = arr.filter(m => m.type === 'idle');
    const last = asst[asst.length - 1];
    const types = arr.map(m => m.type).join(',');
    line(`  t=${(i+1)*1.5}s inActive=${inActive} types=[${types}] idle=${idle.length} lastAsst.time=${JSON.stringify(last?.time || null)}`);
    if (idle.length > 0 && last?.time?.completed) { line('  => 已出现 idle + completed，终止观测'); break; }
  }
}

// ---- 清理 ----
line('\n【清理】删除 fork 副本');
const del = await deleteSession(baseUrl, fork.id);
line(`  deleteSession => ${del ? '✅ 已删除' : '❌ 失败'}`);
{
  const after = await raw('/api/session?limit=10');
  const still = (after.body.data || []).some(s => s.id === fork.id);
  line(`  删除后仍存在? => ${still ? '❌ 仍存在' : '✅ 已消失'}`);
}

line('\n===== 实测结束 =====\n');
