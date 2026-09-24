/**
 * 独立验证 P0-1 修复：观测 fork 副本「消息集稳定」过程，检查稳定前是否已有 idle。
 * 目的：证伪「短等待（1.5s）快照」是否会漏掉随后插入的继承 idle。
 * 方法：fork 后每 1s 采样一次消息 ID 集与 idle 数，记录 idle 首次出现的时间点。
 */
import { forkSession, snapshotForkBaseline, getLastAssistantProgress, deleteSession, clearApiVersionCache } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const srcId = process.argv[3] || 'ses_f2edf2da9ffebHultAagCwrjXv';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sample(sid) {
  const res = await fetch(`${baseUrl}/api/session/${encodeURIComponent(sid)}/message?limit=100`, { headers: hdr });
  const j = await res.json();
  const arr = j.data || [];
  return { ids: arr.map(m => m.id), idles: arr.filter(m => m.type === 'idle').length, n: arr.length };
}

clearApiVersionCache();
line(`\n===== P0-1 修复独立验证：副本复制过程中的 idle 出现时机 =====\n`);

const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
const fid = fork?.id;
line(`fork=${fid}\n`);

line('逐秒采样（消息集何时稳定？idle 何时出现？）：');
let firstIdleAt = null, stableAt = null, prevKey = null;
const t0 = Date.now();
for (let i = 1; i <= 12; i++) {
  await sleep(1000);
  const s = await sample(fid);
  const key = `${s.n}:${s.ids[0]}`;
  const isStable = prevKey === key;
  if (isStable && !stableAt) stableAt = i;
  if (s.idles > 0 && !firstIdleAt) firstIdleAt = i;
  line(`  t=${i}s 消息=${s.n} idle=${s.idles} 首ID尾=${String(s.ids[0] || '').slice(-6)} ${isStable ? '(与上次相同→稳定)' : ''}`);
  prevKey = key;
  if (stableAt && firstIdleAt) break;
}

line(`\n=> idle 首次出现于 t=${firstIdleAt ?? '未出现'}s，消息集稳定于 t=${stableAt ?? '未稳定'}s`);

// 独立用修复后的 snapshotForkBaseline（内部稳定等待），验证其基线是否覆盖了继承 idle
line('\n用修复后的 snapshotForkBaseline（稳定等待）重测：');
const baseline = await snapshotForkBaseline(baseUrl, fid, { timeoutMs: 8000 });
const prog = await getLastAssistantProgress(baseUrl, fid, undefined, { baselineIds: baseline });
line(`  基线=${baseline.size} 条；基线下判定 completed=${prog.completed} status=${prog.status}`);
line(`  => ${prog.completed === false ? '✅ 稳定等待后基线已覆盖继承 idle，不会误判' : '❌ 仍误判'}`);

await deleteSession(baseUrl, fid);
line(`\n已清理 ${fid}`);
