/**
 * F16 修复（ID 快照方案）真机完整验证：
 *   A. 反向：fork 空副本 + 快照基线 -> 不得秒短路
 *   B. 正向：fork + 快照 + 注入 prompt -> 新增 idle 应被识别为完成
 */
import { forkSession, snapshotForkBaseline, dispatchSessionPrompt, waitForSessionIdle, getLastAssistantProgress, deleteSession, clearApiVersionCache } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const srcId = process.argv[3] || 'ses_f2edf2da9ffebHultAagCwrjXv';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const line = console.log;

clearApiVersionCache();
line(`\n########## F16 修复真机完整验证 ##########\n源会话: ${srcId}\n`);

// ---------- A. 反向：空副本 ----------
line('【A】反向：fork 空副本 + 快照基线（不应秒判完成）');
{
  const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
  const fid = fork?.id;
  const baseline = await snapshotForkBaseline(baseUrl, fid, { timeoutMs: 8000, settleMs: 1500 });
  line(`  fork=${fid}  基线快照=${baseline.size} 条`);

  const noBase = await getLastAssistantProgress(baseUrl, fid);
  line(`  [对照] 无基线: completed=${noBase.completed}  => ${noBase.completed ? '❌ 被继承 idle 误判' : '未误判'}`);
  const withBase = await getLastAssistantProgress(baseUrl, fid, undefined, { baselineIds: baseline });
  line(`  [修复] 有基线: completed=${withBase.completed} status=${withBase.status}  => ${withBase.completed ? '❌ 仍误判' : '✅ 正确隔离'}`);

  const t0 = Date.now();
  const w = await waitForSessionIdle(baseUrl, fid, { pollIntervalMs: 1000, maxWaitMs: 5000, baselineIds: baseline });
  const dt = Date.now() - t0;
  line(`  [端到端] completed=${w.completed} status=${w.status} 耗时=${dt}ms  => ${w.completed === false ? '✅ 不秒短路' : '❌ 秒短路'}`);
  await deleteSession(baseUrl, fid);
  line(`  已清理\n`);
}

// ---------- B. 正向：注入 prompt ----------
line('【B】正向：fork + 快照 + 注入 prompt（新增 idle 应判完成）');
{
  const fork = await forkSession(baseUrl, srcId, { timeoutMs: 20000 });
  const fid = fork?.id;
  const baseline = await snapshotForkBaseline(baseUrl, fid, { timeoutMs: 8000, settleMs: 1500 });
  line(`  fork=${fid}  基线快照=${baseline.size} 条`);

  line('  注入极短 prompt...');
  const t0 = Date.now();
  await dispatchSessionPrompt(baseUrl, fid, '请只回复两个字：收到', { timeoutMs: 20000 });
  const w = await waitForSessionIdle(baseUrl, fid, {
    pollIntervalMs: 2000, maxWaitMs: 120000, baselineIds: baseline,
    onWait: (st, ms) => line(`    [wait] status=${st} waited=${Math.round(ms / 1000)}s`)
  });
  const dt = Date.now() - t0;
  line(`  [结果] completed=${w.completed} status=${w.status} outcome=${w.outcome} 耗时=${Math.round(dt / 1000)}s`);
  line(`  => ${w.completed && w.status === 'success' ? '✅ 正向路径正常：新增 idle 被正确识别为完成' : '⚠️ 未判成功（status=' + w.status + '）'}`);
  await deleteSession(baseUrl, fid);
  line(`  已清理`);
}

line('\n########## 验证结束 ##########\n');
