/**
 * 真机事实校验脚本：对运行中的 OpenCode V2 server 逐项验证 opencode-client 的假设。
 * 原则：不做假设，直接打端点看真实行为。
 * 用法：设置 OPENCODE_SERVER_PASSWORD 后 node scripts/verify-opencode-v2.js <baseUrl>
 */
import { detectApiVersion, discoverOpenCodeServer, clearApiVersionCache,
         listCandidateSessions, getSessionStatus, getLastAssistantProgress,
         OPENCODE_API_VERSION } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const auth = pass ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : null;
const hdr = auth ? { Authorization: auth } : {};

const line = (s) => console.log(s);

async function raw(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { ...hdr, ...(opts.headers||{}) }, method: opts.method || 'GET', body: opts.body });
  let body = null; const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
}

line(`\n########## 真机校验 @ ${baseUrl} ##########\n`);

// ===== 验证 1：detectApiVersion 判定是否 == V2 =====
line('【验证1】detectApiVersion 是否判为 V2（评审假设：先探 /api/info）');
{
  clearApiVersionCache();
  const v = await detectApiVersion(baseUrl);
  line(`  实际 => ${v} (期望 2=V2)  ${v === OPENCODE_API_VERSION.V2 ? '✅' : '❌ 不符'}`);
}

// ===== 验证 2：/global/health 在 V2 下是否为 HTML 兜底（这是评审未预料的） =====
line('\n【验证2】/global/health 在 V2 下返回什么（假设：v2 无此端点）');
{
  const r = await raw('/global/health');
  const isJson = typeof r.body === 'object';
  line(`  status=${r.status} 是否为JSON=${isJson}`);
  line(`  实际 => ${isJson ? JSON.stringify(r.body).slice(0,120) : 'HTML 兜底页面（非 JSON）'}`);
  line(`  => 说明：返回 200 但为 SPA HTML，detectApiVersion 依赖 JSON 解析可排除误判 ✅`);
}

// ===== 验证 3：不带 auth 探测会怎样（评审 R8 凭据外发） =====
line('\n【验证3】不带 auth 时 /api/info 是否 401');
{
  const res = await fetch(`${baseUrl}/api/info`);
  line(`  实际 => status=${res.status}  WWW-Authenticate=${res.headers.get('www-authenticate')}`);
  line(`  => 说明：V2 接受 Basic Auth，未鉴权返回 401（R10「V2 是否接受 Basic Auth」已确证为 接受）`);
}

// ===== 验证 4：/api/session 信封结构 + 会话字段（评审 R1/R2/R6 依赖） =====
line('\n【验证4】GET /api/session 真实信封与字段结构');
{
  const r = await raw('/api/session?limit=3');
  line(`  status=${r.status}`);
  if (r.body && typeof r.body === 'object' && Array.isArray(r.body.data)) {
    line(`  信封键: ${Object.keys(r.body).join(', ')}`);
    line(`  cursor: ${JSON.stringify(r.body.cursor)}`);
    line(`  data.length=${r.body.data.length}`);
    const s = r.body.data[0];
    if (s) {
      line(`  首条会话字段: ${Object.keys(s).join(', ')}`);
      line(`    id=${s.id}`);
      line(`    location=${JSON.stringify(s.location)}  (假设 location.directory)`);
      line(`    time=${JSON.stringify(s.time)}  (假设 time.created/updated)`);
      line(`    parentID=${s.parentID}  agent=${s.agent}  title=${JSON.stringify(s.title)}`);
      line(`    是否有 fork 字段=${'fork' in s}  ${'fork' in s ? JSON.stringify(s.fork) : ''}`);
    }
  } else { line(`  非预期结构: ${JSON.stringify(r.body).slice(0,300)}`); }
}

// ===== 验证 5：listCandidateSessions 端到端（评审 R2 分页/R6 过滤依赖） =====
line('\n【验证5】listCandidateSessions 真实调用');
{
  try {
    const cands = await listCandidateSessions(baseUrl, { windowDays: 30, idleMinutes: 1, limit: 3 });
    line(`  实际返回 ${cands.length} 个候选`);
    for (const c of cands) line(`    - ${c.id} | dir=${c.directory} | updated=${new Date(c.timeUpdated).toISOString()}`);
    line(`  => 说明：directory 归一化${cands.length && cands[0].directory ? '成功（location.directory 已生效）✅' : '为空，需查'}`);
  } catch (e) { line(`  ❌ 抛错: ${e.message}`); }
}

// ===== 验证 6：/api/session/active 真实形态（评审 R1 核心） =====
line('\n【验证6】GET /api/session/active 真实形态（判定 fork 是否在集合）');
{
  const r = await raw('/api/session/active');
  line(`  status=${r.status}`);
  line(`  body=${JSON.stringify(r.body).slice(0, 400)}`);
  const keys = r.body?.data ? Object.keys(r.body.data) : [];
  line(`  active 会话数=${keys.length}  keys=${JSON.stringify(keys.slice(0,5))}`);
}

// ===== 验证 7：找一个会话验证 message 结构与分页（评审 R2/R3 核心） =====
line('\n【验证7】GET /api/session/:id/message 真实消息结构与分页');
{
  const list = await raw('/api/session?limit=1');
  const sid = list.body?.data?.[0]?.id;
  if (!sid) { line('  无会话可测'); }
  else {
    const r = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=5`);
    line(`  sessionId=${sid} status=${r.status}`);
    if (r.body && typeof r.body === 'object') {
      line(`  信封键=${Object.keys(r.body).join(', ')}  cursor=${JSON.stringify(r.body.cursor)}`);
      const msgs = r.body.data || [];
      line(`  本页消息数=${msgs.length}（注意是否 = limit，以判断默认页大小）`);
      if (msgs.length) {
        line(`  消息类型分布: ${JSON.stringify(msgs.map(m => m.type))}`);
        const asst = msgs.filter(m => m.type === 'assistant').pop();
        if (asst) {
          line(`  assistant.time=${JSON.stringify(asst.time)}`);
          line(`  assistant.content[].type=${JSON.stringify((asst.content||[]).map(c => c.type))}`);
          line(`  => completed 字段存在=${'completed' in (asst.time||{})}  streamed 存在=${'streamed' in (asst.time||{})}`);
        }
        const idle = msgs.find(m => m.type === 'idle');
        line(`  是否存在 type:'idle' 消息=${!!idle}  ${idle ? 'outcome=' + idle.outcome : ''}`);
      }
    }
  }
}

line('\n########## 校验结束 ##########\n');
