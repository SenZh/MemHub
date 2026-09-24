/**
 * 正向端到端真机验证：fork → 注入 prompt → 等待完成 → 应判 success。
 * 验证 F16 修复没有破坏「正常抽取能正确判完成」。
 */
import { forkSession, dispatchSessionPrompt, waitForSessionIdle, deleteSession, clearApiVersionCache } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const srcId = process.argv[3] || 'ses_f2edf2da9ffebHultAagCwrjXv';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;

clearApiVersionCache();
line(`\n===== 正向端到端真机验证 =====\n源会话: ${srcId}\n`);

const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
const fid = fork?.id;
const boundary = fork?.fork?.boundary?.messageID || null;
line(`fork=${fid}  boundary=${boundary}`);
if (!fid) process.exit(0);

line('\n注入一个只需极短回复的 prompt ...');
const t0 = Date.now();
await dispatchSessionPrompt(baseUrl, fid, '请只回复两个字：收到', { timeoutMs: 20000 });
line('已注入，开始等待（带 baseline）...');

const w = await waitForSessionIdle(baseUrl, fid, {
  pollIntervalMs: 2000,
  maxWaitMs: 90000,
  baselineMessageId: boundary,
  onWait: (st, ms) => line(`  [wait] status=${st} waited=${Math.round(ms / 1000)}s`)
});
const dt = Date.now() - t0;
line(`\n等待结果: completed=${w.completed} status=${w.status} outcome=${w.outcome} 耗时=${Math.round(dt / 1000)}s`);
line(`=> ${w.completed && w.status === 'success' ? '✅ 正向路径正常：新增 idle 被正确识别为完成' : '⚠️ 未判成功（status=' + w.status + '），需检查'}`);

await deleteSession(baseUrl, fid);
line(`\n已清理 ${fid}`);
line('===== 验证结束 =====\n');
