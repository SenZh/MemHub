/**
 * 争议点真机裁决：order 与 cursor 能否组合？
 * 评审 A 依据 OpenAPI spec「Do not combine with order」判 P0-C；
 * 本轮直接打真机，看服务端真实行为，裁决该假设成立与否。
 */
const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;

async function raw(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: hdr });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body, raw: text };
}

line(`\n===== order × cursor 组合真机裁决 @ ${baseUrl} =====\n`);

const list = await raw('/api/session?limit=1');
const sid = list.body?.data?.[0]?.id;
line(`测试会话: ${sid}`);
line(`（该会话已知约 67 条消息 / 5 页）\n`);

// 用例 1：order=asc 单独
line('【用例1】order=asc（3条）');
{
  const r = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=3&order=asc`);
  const msgs = r.body?.data || [];
  line(`  status=${r.status} types=${JSON.stringify(msgs.map(m => m.type))}`);
  line(`  created=${JSON.stringify(msgs.map(m => m.time?.created))}`);
}

// 用例 2：cursor 单独（不带 order）
line('\n【用例2】cursor 单独（先取一页拿 next，再翻页）');
let nextCursor = null;
{
  const p1 = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=5`);
  line(`  第1页 status=${p1.status} n=${p1.body?.data?.length} 首条created=${p1.body?.data?.[0]?.time?.created}`);
  nextCursor = p1.body?.cursor?.next;
  line(`  cursor.next 非空=${!!nextCursor}`);
  const p2 = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=5&cursor=${encodeURIComponent(nextCursor)}`);
  line(`  第2页 status=${p2.status} n=${p2.body?.data?.length}`);
  line(`  第2页 created=${JSON.stringify((p2.body?.data||[]).map(m=>m.time?.created))}`);
  line(`  => 翻页方向：与第1页相比 ${(p2.body?.data||[]).every(m => m.time?.created < (p1.body?.data?.[0]?.time?.created)) ? '继续更旧 ✅' : '异常'}`);
}

// 用例 3：order=asc + cursor 组合（争议核心）
line('\n【用例3】order=asc + cursor 组合（P0-C 争议核心）');
{
  const p1 = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=5&order=asc`);
  line(`  第1页(asc) status=${p1.status} n=${p1.body?.data?.length}`);
  line(`  第1页 types=${JSON.stringify((p1.body?.data||[]).map(m=>m.type))}`);
  const cur = p1.body?.cursor?.next;
  line(`  cursor.next 非空=${!!cur}`);
  if (cur) {
    const p2 = await raw(`/api/session/${encodeURIComponent(sid)}/message?limit=5&order=asc&cursor=${encodeURIComponent(cur)}`);
    line(`  第2页(asc+cursor) status=${p2.status}`);
    if (p2.status === 200) {
      const a = p1.body?.data || [], b = p2.body?.data || [];
      line(`  第2页 n=${b.length} types=${JSON.stringify(b.map(m=>m.type))}`);
      line(`  第1页末条created=${a[a.length-1]?.time?.created}  第2页首条created=${b[0]?.time?.created}`);
      line(`  => 组合是否可用：${p2.status===200 ? '✅ 服务端接受 order+cursor' : '❌ 被拒'}`);
      line(`  => 翻页语义：${b[0]?.time?.created > a[a.length-1]?.time?.created ? '递增（更旧→新，与asc一致）✅' : '未递增，需进一步查'}`);
    } else {
      line(`  错误体: ${JSON.stringify(p2.body).slice(0,300)}`);
      line(`  => ❌ 组合被拒（P0-C 成立）`);
    }
  }
}

// 用例 4：翻页时页面锚定的是「cursor 里的锚点序」还是「order 指定序」
line('\n【用例4】定论：翻页全程用 cursor 不带 order，能否取全且序正确');
{
  let cursor = null, pages = 0, all = [];
  do {
    const q = `limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await raw(`/api/session/${encodeURIComponent(sid)}/message?${q}`);
    const arr = r.body?.data || [];
    all = all.concat(arr);
    pages++; cursor = r.body?.cursor?.next || null;
    if (pages > 20) break;
  } while (cursor);
  line(`  共 ${pages} 页，累计 ${all.length} 条`);
  const times = all.map(m => m.time?.created).filter(Boolean);
  const allDesc = times.every((t, i) => i === 0 || times[i-1] >= t);
  const allAsc = times.every((t, i) => i === 0 || times[i-1] <= t);
  line(`  整体顺序：${allDesc ? 'desc（新→旧）' : allAsc ? 'asc（旧→新）' : '乱序'}`);
  line(`  首条=${times[0]}  末条=${times[times.length-1]}`);
  line(`  => 关键裁决：若整体 desc，则翻页后需 reverse() 才能让 arr[last]=最新；若 asc 则 arr[last] 天然最新`);
}

line('\n===== 裁决结束 =====\n');
