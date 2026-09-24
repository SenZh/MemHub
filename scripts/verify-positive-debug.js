/**
 * 排查正向路径未判成功：观测 fork 副本在注入后的真实消息演化。
 */
import { forkSession, dispatchSessionPrompt, deleteSession, clearApiVersionCache } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const srcId = process.argv[3] || 'ses_f2edf2da9ffebHultAagCwrjXv';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function msgs(sid) {
  const res = await fetch(`${baseUrl}/api/session/${encodeURIComponent(sid)}/message?limit=100`, { headers: hdr });
  const j = await res.json();
  return j.data || [];
}

clearApiVersionCache();
const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
const fid = fork?.id;
const boundary = fork?.fork?.boundary?.messageID || null;
line(`fork=${fid}\nboundary=${boundary}\n`);

// 先看 fork 副本初始（继承的）消息
await sleep(2000);
let arr = await msgs(fid);
const types = {}; for (const m of arr) types[m.type] = (types[m.type] || 0) + 1;
const bi = arr.findIndex(m => m.id === boundary);
line(`注入前: 消息=${arr.length} 类型=${JSON.stringify(types)} boundary索引=${bi}(desc序)`);
line(`  boundary 之前的消息数(desc上位)=${bi}  之后的=${bi >= 0 ? arr.length - bi - 1 : '?'}`);

line('\n注入 prompt...');
await dispatchSessionPrompt(baseUrl, fid, '请只回复两个字：收到', { timeoutMs: 20000 });

for (let i = 1; i <= 15; i++) {
  await sleep(4000);
  arr = await msgs(fid);
  const t2 = {}; for (const m of arr) t2[m.type] = (t2[m.type] || 0) + 1;
  const bi2 = arr.findIndex(m => m.id === boundary);
  const newMsgs = bi2 >= 0 ? arr.slice(0, bi2) : arr; // desc：boundary 之上是新增
  const newIdle = newMsgs.filter(m => m.type === 'idle');
  const newAsst = newMsgs.filter(m => m.type === 'assistant');
  const lastNew = newMsgs[0];
  line(`t=${i * 4}s 总消息=${arr.length} 新增=${newMsgs.length} 新增idle=${newIdle.length} 新增assistant=${newAsst.length} 最新新增type=${lastNew?.type || '-'} hdr=${JSON.stringify(lastNew?.time)}`);
  if (newIdle.length) { line('  ★ 已出现新增 idle，终止观测'); break; }
}

await deleteSession(baseUrl, fid);
line(`\n已清理 ${fid}`);
