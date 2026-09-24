/** 深挖校验：分页默认序、页大小、idle 消息、fork 行为 */
import { listCandidateSessions } from '../src/host/opencode-client.js';

const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;

async function raw(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { ...hdr, ...(opts.headers||{}) }, method: opts.method||'GET', body: opts.body });
  const text = await res.text(); let body=null; try{body=JSON.parse(text);}catch{body=text.slice(0,150);}
  return { status: res.status, body };
}

line(`\n===== 深挖校验 @ ${baseUrl} =====\n`);

const list = await raw('/api/session?limit=1');
const sid = list.body.data[0].id;

// A. 消息默认序与页大小：不带 order/limit
line('【A】消息接口：不带 order/limit 的真实默认行为');
{
  const r = await raw(`/api/session/${encodeURIComponent(sid)}/message`);
  const msgs = r.body.data || [];
  line(`  默认返回条数=${msgs.length}  cursor.next 非空=${!!r.body.cursor?.next}`);
  const times = msgs.map(m => m.time?.created).filter(Boolean);
  if (times.length >= 2) {
    const desc = times.every((t,i) => i===0 || times[i-1] >= t);
    const asc = times.every((t,i) => i===0 || times[i-1] <= t);
    line(`  首条 created=${times[0]}  末条 created=${times[times.length-1]}`);
    line(`  => 顺序：${desc ? 'desc（新→旧，最新在前）' : asc ? 'asc（旧→新）' : '未知'}`);
    line(`  => 关键：${desc ? '代码取 arr[arr.length-1] 拿到的是【最旧】消息 ❌ R2 风险成立' : '取 arr[arr.length-1] 是最新 ✅'}`);
  }
}

// B. 显式 order=asc/desc 对比
line('\n【B】显式 order 对比');
for (const order of ['asc','desc']) {
  const r = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=3&order=${order}`);
  const msgs = r.body.data || [];
  line(`  order=${order}: types=${JSON.stringify(msgs.map(m=>m.type))} created=${JSON.stringify(msgs.map(m=>m.time?.created))}`);
}

// C. 分页是否真能翻完（cursor.next）
line('\n【C】cursor 翻页能力');
{
  let cursor = null, pages = 0, total = 0;
  do {
    const q = `limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await raw(`/api/session/${encodeURIComponent(sid)}/message?${q}`);
    const n = (r.body.data||[]).length; total += n; pages++;
    cursor = r.body.cursor?.next || null;
    if (pages > 20) { line('  超过20页，中止'); break; }
  } while (cursor);
  line(`  翻页共 ${pages} 页, 累计 ${total} 条消息`);
  line(`  => 说明：${pages>1 ? '分页 real，必须翻页才能拿全 ✅ R2 成立' : '单页即全部，R2 影响有限'}`);
}

// D. idle 消息是否存在（R11 核心）
line('\n【D】是否存在 type:idle 消息（R11 完成信号）');
{
  const r = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=100`);
  const msgs = r.body.data || [];
  const byType = {};
  for (const m of msgs) byType[m.type] = (byType[m.type]||0)+1;
  line(`  类型分布: ${JSON.stringify(byType)}`);
  line(`  => idle 消息${byType.idle ? '存在 ✅ 可用作完成信号' : '不存在 ❌ R11 方案不可行，需另找完成信号'}`);
}

// E. 多会话抽样看 idle & assistant 完成标记
line('\n【E】多会话抽样：assistant 完成标记与 idle');
{
  const all = await raw('/api/sessions?limit=8');
  const list2 = await raw('/api/session?limit=8');
  for (const s of (list2.body.data||[]).slice(0,6)) {
    const r = await raw(`/api/session/${encodeURIComponent(s.id)}/message?limit=50`);
    const msgs = r.body.data||[];
    const types = {};
    for (const m of msgs) types[m.type]=(types[m.type]||0)+1;
    const hasIdle = !!types.idle;
    const asstWithCompleted = msgs.filter(m=>m.type==='assistant' && m.time?.completed).length;
    line(`  ${s.id.slice(0,20)}... outcome=${s.outcome||'-'} types=${JSON.stringify(types)} idle=${hasIdle}`);
  }
}

line('\n===== 深挖结束 =====\n');
