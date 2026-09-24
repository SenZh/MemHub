/**
 * F16 修复真机复验：fork 空副本 + 传入 baseline，验证不再秒短路。
 */
import { forkSession, getSessionStatus, getLastAssistantProgress, waitForSessionIdle, deleteSession, clearApiVersionCache } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const srcId = process.argv[3] || 'ses_f2edf2da9ffebHultAagCwrjXv';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;

async function raw(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: hdr });
  const text = await res.text(); let body = null; try { body = JSON.parse(text); } catch { body = text.slice(0, 150); }
  return { status: res.status, body };
}

clearApiVersionCache();
line(`\n===== F16 修复真机复验 =====\n源会话: ${srcId}\n`);

// 源会话信息
const srcRaw = await raw(`/api/session/${encodeURIComponent(srcId)}/message?limit=100`);
const srcArr = srcRaw.body?.data || [];
line(`源消息(首100)=${srcArr.length}  源idle=${srcArr.filter(m => m.type === 'idle').length}  （源有历史 idle=succeeded）`);

// fork
const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
const fid = fork?.id;
const boundary = fork?.fork?.boundary?.messageID || null;
line(`fork=${fid}\nboundary=${boundary}  type=${fork?.fork?.boundary?.type}`);

if (!fid) process.exit(0);

// 不带 baseline（复刻修复前行为）
line('\n[对照 A] 不带 baseline（修复前行为）:');
const noBase = await getLastAssistantProgress(baseUrl, fid);
line(`  completed=${noBase.completed} status=${noBase.status} outcome=${noBase.outcome}  => ${noBase.completed ? '❌ 被继承 idle 误判完成' : '✅ 未误判'}`);

// 带 baseline（修复后行为）
line('\n[复验 B] 带 baseline（修复后行为）:');
const withBase = await getLastAssistantProgress(baseUrl, fid, undefined, { baselineMessageId: boundary });
line(`  completed=${withBase.completed} status=${withBase.status} outcome=${withBase.outcome}  => ${withBase.completed ? '❌ 仍误判' : '✅ 正确隔离继承 idle'}`);

// 端到端 waitForSessionIdle（等 6 秒，不应秒判完成）
line('\n[复验 C] waitForSessionIdle(空fork, baseline) 端到端:');
const t0 = Date.now();
const w = await waitForSessionIdle(baseUrl, fid, { pollIntervalMs: 1000, maxWaitMs: 6000, baselineMessageId: boundary });
const dt = Date.now() - t0;
line(`  completed=${w.completed} status=${w.status} 耗时=${dt}ms`);
line(`  => ${w.completed === false && dt >= 5000 ? '✅ 不再秒短路（F16 修复真机生效）' : '❌ 仍秒短路'}`);

await deleteSession(baseUrl, fid);
line(`\n已清理 ${fid}`);
line('===== 复验结束 =====\n');
