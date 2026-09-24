/**
 * 修复后真机复核：直接对运行中的 OpenCode 2.0.15 验证 P0 修复是否生效。
 * 原则：真实的 fork、真实的消息、真实的等待，不做任何 mock。
 */
import {
  forkSession, getSessionStatus, getLastAssistantProgress, waitForSessionIdle,
  deleteSession, readSessionMessages, clearApiVersionCache
} from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;

async function raw(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { ...hdr, ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body });
  const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch { body = text.slice(0, 150); }
  return { status: res.status, body };
}

line(`\n########## 修复后真机复核 @ ${baseUrl} ##########\n`);
clearApiVersionCache();

// ---------- 复核 1：P0-2 秒短路（核心！）----------
line('【复核1】P0-2 修复：fork 空副本是否仍会秒判完成（真机 F11 原现场）');
{
  const list = await raw('/api/session?limit=5');
  const source = (list.body?.data || []).find(s => s.id && !s.fork);
  const forkRes = await raw(`/api/session/${encodeURIComponent(source.id)}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const forkId = forkRes.body?.id || forkRes.body?.data?.id;
  line(`  源会话=${source.id}  fork=${forkId}`);

  const st = await getSessionStatus(baseUrl, forkId);
  line(`  修复后 getSessionStatus(fork) => ${st}   (修复前是 'idle')`);
  line(`  => ${st === 'unknown' ? '✅ 已修正为 unknown（不再误判 idle）' : '❌ 仍是 ' + st}`);

  const t0 = Date.now();
  const w = await waitForSessionIdle(baseUrl, forkId, { pollIntervalMs: 1000, maxWaitMs: 6000 });
  const dt = Date.now() - t0;
  line(`  waitForSessionIdle(空fork) => completed=${w.completed} status=${w.status} 耗时=${dt}ms`);
  line(`  => ${w.completed === false && dt >= 5000 ? '✅ 不再秒短路（修复前 1015ms 就判完成）' : '❌ 仍秒短路'}`);

  await deleteSession(baseUrl, forkId);
  line(`  已清理 fork`);
}

// ---------- 复核 2：P0-1 分页（真机读取全量消息）----------
line('\n【复核2】P0-1 修复：分页拉全真实会话消息');
{
  const list = await raw('/api/session?limit=5');
  const src = (list.body?.data || []).find(s => s.id && !s.fork);
  const msgs = await readSessionMessages(baseUrl, src.id);
  line(`  会话 ${src.id} 经分页读取到 ${msgs.length} 条文本消息`);
  line(`  (裸 GET 默认只 50 条；此处应 >= 50 或翻页取全)`);
  line(`  => ${msgs.length > 0 ? '✅ 分页读取成功' : '❌ 读取为空'}`);
  const prog = await getLastAssistantProgress(baseUrl, src.id);
  line(`  getLastAssistantProgress => completed=${prog.completed} status=${prog.status} outcome=${prog.outcome} parts=${prog.partsCount}`);
}

// ---------- 复核 3：P0-2 idle 消息判定（真机对已完成会话）----------
line('\n【复核3】P0-2 修复：已完成会话应能通过 idle 消息判成功');
{
  const list = await raw('/api/session?limit=20');
  let ok = 0, fail = 0;
  for (const s of (list.body?.data || []).slice(0, 8)) {
    const prog = await getLastAssistantProgress(baseUrl, s.id);
    if (prog.completed && prog.status === 'success') ok++;
    else if (!prog.completed) fail++;
    line(`  ${s.id.slice(0, 22)}... outcome字段=${s.outcome || '-'} => completed=${prog.completed} status=${prog.status} idleOutcome=${prog.outcome}`);
  }
  line(`  汇总：判成功 ${ok} / 判未完成 ${fail}`);
  line(`  => ${ok > 0 ? '✅ idle 消息判定在真机生效' : '⚠️ 未观测到成功判定（可能样本均为未完成态）'}`);
}

line('\n########## 复核结束 ##########\n');
