/**
 * 方案验证：用「fork 后消息 ID 快照」作基线，只认新增消息。
 * 先确认：fork 副本消息集是否会稳定（复制完成后不再变）。
 */
import { forkSession, dispatchSessionPrompt, deleteSession, clearApiVersionCache } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const srcId = process.argv[3] || 'ses_f2edf2da9ffebHultAagCwrjXv';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ids(sid) {
  const res = await fetch(`${baseUrl}/api/session/${encodeURIComponent(sid)}/message?limit=100`, { headers: hdr });
  const j = await res.json();
  return (j.data || []).map(m => m.id);
}

clearApiVersionCache();
const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
const fid = fork?.id;
line(`fork=${fid}\n`);

// 观测副本消息集是否稳定
line('观测副本消息 ID 集稳定性（每次间隔 3s）：');
let prev = null, stableAt = -1;
for (let i = 1; i <= 8; i++) {
  await sleep(3000);
  const cur = await ids(fid);
  const same = prev && cur.length === prev.length && cur[0] === prev[0] && cur[cur.length - 1] === prev[prev.length - 1];
  line(`  t=${i * 3}s 消息数=${cur.length} 首=${cur[0]?.slice(-8)} 末=${cur[cur.length - 1]?.slice(-8)} ${same ? '(与上次相同)' : '(变化)'}`);
  if (same && stableAt < 0) stableAt = i * 3;
  prev = cur;
}
line(`=> 消息集在 t≈${stableAt > 0 ? stableAt : '未观测到'}s 后趋于稳定\n`);

if (!fid) process.exit(0);

// 用快照作基线
const baselineIds = new Set(prev || []);
line(`基线快照：${baselineIds.size} 条消息 ID\n`);

line('注入 prompt...');
await dispatchSessionPrompt(baseUrl, fid, '请只回复两个字：收到', { timeoutMs: 20000 });

for (let i = 1; i <= 12; i++) {
  await sleep(4000);
  const res = await fetch(`${baseUrl}/api/session/${encodeURIComponent(fid)}/message?limit=100`, { headers: hdr });
  const j = await res.json();
  const arr = j.data || [];
  const newOnes = arr.filter(m => !baselineIds.has(m.id));
  const newIdle = newOnes.filter(m => m.type === 'idle');
  line(`t=${i * 4}s 总=${arr.length} 新增=${newOnes.length} 新增type=${JSON.stringify(newOnes.map(m => m.type))}`);
  if (newIdle.length) { line('  ★ 新增 idle 出现，方案可行'); break; }
}

await deleteSession(baseUrl, fid);
line(`\n已清理 ${fid}`);
