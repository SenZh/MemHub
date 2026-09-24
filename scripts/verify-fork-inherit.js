/**
 * 深挖真机：fork 副本的消息可见性与 boundary 结构。
 * 目的：确认「fork 继承历史消息」的程度，为「只认增量」的修复提供事实依据。
 */
import { forkSession, readSessionMessages, deleteSession, getSessionStatus, OPENCODE_API_VERSION } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function raw(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: hdr });
  const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch { body = text.slice(0, 150); }
  return { status: res.status, body };
}

line(`\n===== fork 副本消息可见性深挖 @ ${baseUrl} =====\n`);

// 选一个消息多的已验证源会话（取列表里 time.updated 最旧的，通常是长会话）
const list = await raw('/api/session?limit=30');
const alive = (list.body?.data || []).filter(s => s.id && !s.fork);
line(`候选源会话 ${alive.length} 个，逐一试 fork 并观测副本消息数：\n`);

for (const src of alive.slice(0, 4)) {
  // 先看源会话消息数
  const srcMsgs = await readSessionMessages(baseUrl, src.id);
  const srcRaw = await raw(`/api/session/${encodeURIComponent(src.id)}/message?limit=300`);
  const srcArr = srcRaw.body?.data || [];
  const srcIdle = srcArr.filter(m => m.type === 'idle');

  const fork = await forkSession(baseUrl, src.id, { timeoutMs: 20000 });
  const fid = fork?.id;
  line(`源 ${src.id.slice(0, 20)}... 源消息=${srcArr.length} 源idle=${srcIdle.length} title=${JSON.stringify(src.title)}`);
  line(`  fork=${fid}  返回体.fork=${JSON.stringify(fork?.fork)}`);

  if (fid) {
    // 立即观测 + 等 3s 再观测
    for (const wait of [0, 3000, 6000]) {
      if (wait) await sleep(wait === 6000 ? 3000 : 3000);
      const fr = await raw(`/api/session/${encodeURIComponent(fid)}/message?limit=300`);
      const farr = fr.body?.data || [];
      const fidle = farr.filter(m => m.type === 'idle');
      line(`    t≈${wait}s: fork消息=${farr.length} fork idle=${fidle.length} 末条=${farr[farr.length-1]?.type || '-'}`);
    }
    await deleteSession(baseUrl, fid);
    line(`  已清理 ${fid}\n`);
  }
}

line('===== 深挖结束 =====\n');
