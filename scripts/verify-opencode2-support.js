/**
 * 用户提问「现在支持 opencode2 了吗」的直接证据：
 * 对真机 OpenCode 2.0.15 跑一次接近真实抽取的完整链路。
 */
import { detectApiVersion, clearApiVersionCache, listCandidateSessions, getSessionStatus,
         getLastAssistantProgress, forkSession, snapshotForkBaseline, dispatchSessionPrompt,
         waitForSessionIdle, deleteSession, readSessionMessages, OPENCODE_API_VERSION } from '../src/host/opencode-client.js';

const u = process.argv[2] || 'http://127.0.0.1:64892';
const auth = 'Basic ' + Buffer.from('opencode:' + (process.env.OPENCODE_SERVER_PASSWORD || '')).toString('base64');
const hdr = { Authorization: auth };
const line = console.log;

clearApiVersionCache();
line(`\n===== OpenCode 2 支持性真机验证 @ ${u} =====\n`);

// 1. 版本判定
const v = await detectApiVersion(u);
line(`[1] 版本判定: ${v === OPENCODE_API_VERSION.V2 ? '✅ V2 (OpenCode 2)' : '❌ ' + v}`);

const info = await (await fetch(`${u}/api/info`, { headers: hdr })).json();
line(`    真实版本: ${info.version}`);

// 2. 列候选会话
const cands = await listCandidateSessions(u, { windowDays: 30, idleMinutes: 1, limit: 5 });
line(`[2] 列候选会话: ✅ ${cands.length} 个`);
cands.slice(0, 3).forEach(c => line(`    - ${c.id} | ${c.directory}`));

if (!cands.length) { line('\n无候选会话，端到端无法继续'); process.exit(0); }
const src = cands[0];
line(`\n选用源会话: ${src.id}`);

// 3. 分页读消息
const msgs = await readSessionMessages(u, src.id);
line(`[3] 分页读消息: ✅ ${msgs.length} 条文本消息`);

// 4. 完成判定
const prog = await getLastAssistantProgress(u, src.id);
line(`[4] 完成判定: ✅ completed=${prog.completed} status=${prog.status} outcome=${prog.outcome}`);

// 5. fork + 基线快照
const fork = await forkSession(u, src.id, { timeoutMs: 20000 });
const fid = fork?.id;
line(`[5] fork 副本: ${fid}`);
const t0 = Date.now();
const baseline = await snapshotForkBaseline(u, fid, { timeoutMs: 8000 });
line(`[5b] 基线快照: ${baseline.size} 条 (耗时 ${Math.round((Date.now() - t0) / 1000)}s)`);

// 6. 空副本不应秒判完成
const st = await getSessionStatus(u, fid);
line(`[6] 空副本状态: ${st} (修复后应为 unknown)`);
const emptyProg = await getLastAssistantProgress(u, fid, undefined, { baselineIds: baseline });
line(`[6b] 空副本完成判定: completed=${emptyProg.completed} => ${emptyProg.completed ? '❌ 误判' : '✅ 正确判为未完成'}`);

// 7. 注入 prompt 并等待真实完成
line(`[7] 注入极短 prompt 并等待…`);
await dispatchSessionPrompt(u, fid, '请只回复两个字：收到', { timeoutMs: 20000 });
const w = await waitForSessionIdle(u, fid, { pollIntervalMs: 2000, maxWaitMs: 120000, baselineIds: baseline });
line(`[7b] 抽取结果: completed=${w.completed} status=${w.status} outcome=${w.outcome} 耗时=${Math.round(w.waitedMs / 1000)}s`);
line(`     => ${w.completed && w.status === 'success' ? '✅ 端到端抽取成功完成' : '⚠️ 未判成功'}`);

// 清理
await deleteSession(u, fid);
line(`\n[清理] 已删除 fork 副本 ${fid}`);
line(`\n===== 结论：OpenCode 2 全链路 ${w.completed ? '可用 ✅' : '未通过'} =====\n`);
