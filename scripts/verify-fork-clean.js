/**
 * 干净验证：fork 副本是否继承源会话历史（尤其 idle 消息）。
 * 关键：每次只做一件事，避免脚本自身时序干扰。
 */
import { forkSession, deleteSession, clearApiVersionCache } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function rawMessages(sid, limit = 300) {
  const res = await fetch(`${baseUrl}/api/session/${encodeURIComponent(sid)}/message?limit=${limit}`, { headers: hdr });
  const j = await res.json();
  return j.data || [];
}

clearApiVersionCache();
const srcId = process.argv[3] || 'ses_f2edf2da9ffebHultAagCwrjXv';
line(`\n源会话: ${srcId}`);

const srcMsgs = await rawMessages(srcId);
const srcIdle = srcMsgs.filter(m => m.type === 'idle');
line(`源消息=${srcMsgs.length}  源idle=${srcIdle.length}  源末条type=${srcMsgs[0]?.type}(desc首条)`);

line(`\n执行 fork（静默观测副本消息 20s）...`);
const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
const fid = fork?.id;
line(`fork=${fid}`);
line(`fork.fork.boundary = ${JSON.stringify(fork?.fork?.boundary)}`);

if (!fid) process.exit(0);
let firstSeen = null;
for (let i = 1; i <= 20; i++) {
  await sleep(1000);
  const farr = await rawMessages(fid);
  const fidle = farr.filter(m => m.type === 'idle');
  if (farr.length > 0 && !firstSeen) firstSeen = i;
  line(`  t=${i}s 副本消息=${farr.length} 副本idle=${fidle.length} 副本末条=${farr[0]?.type}(desc首条)`);
  if (farr.length > 0 && i >= 3) break;
}

await deleteSession(baseUrl, fid);
line(`已清理 ${fid}\n结论：fork 副本${firstSeen ? `在 ${firstSeen}s 时出现消息，${firstSeen <= 3 ? '确认继承了历史（含 idle）' : '延迟出现'}` : '20s 内无消息'}`);
