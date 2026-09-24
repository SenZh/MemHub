/**
 * battle 前置事实裁决：验证评审 C 的 5c（列表元素是否有 fork 字段）
 * 与评审 C 的 8a（现有 v2 测试与新设计的冲突）。
 * 只做事实取证，不做设计判断。
 */
const baseUrl = process.argv[2] || 'http://127.0.0.1:49612';
const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const hdr = pass ? { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') } : {};
const line = console.log;

async function raw(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { ...hdr, ...(opts.headers || {}) }, method: opts.method || 'GET', body: opts.body });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
}

line(`\n===== battle 前置事实裁决 @ ${baseUrl} =====\n`);

// ---- 事实 X：既有的 fork 副本，其列表元素是否带 fork 字段？----
line('【事实X】评审C 5c：列表元素是否携带 Session.Info.fork');
line('  步骤：先 fork 一个会话（制造真实 fork 副本），再拉列表看该元素字段');
{
  const list0 = await raw('/api/session?limit=5');
  const source = list0.body?.data?.find(s => s.id && !s.fork);
  line(`  源会话: ${source?.id} title=${JSON.stringify(source?.title)}`);

  const forkRes = await raw(`/api/session/${encodeURIComponent(source.id)}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  line(`  fork 接口 status=${forkRes.status}`);
  const forkId = forkRes.body?.id || forkRes.body?.data?.id;
  line(`  fork 返回: id=${forkId} title=${JSON.stringify(forkRes.body?.title)} 有fork字段=${'fork' in (forkRes.body||{})}`);

  if (forkId) {
    // 关键：拉列表，看列表元素是否带 fork
    const list1 = await raw('/api/session?limit=20');
    const elems = list1.body?.data || [];
    const found = elems.find(s => s.id === forkId);
    line(`  列表中找到该 fork: ${!!found}`);
    if (found) {
      line(`  列表元素字段: ${Object.keys(found).join(', ')}`);
      line(`  ★ 列表元素是否有 fork 字段: ${'fork' in found}  ${found.fork ? JSON.stringify(found.fork) : '(无)'}`);
    } else {
      line(`  ⚠️ 列表前20未包含该 fork（需翻页/或 fork 未落库）`);
      const one = await raw(`/api/session/${encodeURIComponent(forkId)}`);
      line(`  单查该会话 status=${one.status} 字段=${one.body ? Object.keys(one.body).join(', ') : '-'}`);
      line(`  单查是否有 fork 字段: ${one.body && ('fork' in one.body)}`);
    }
    // 清理
    await raw(`/api/session/${encodeURIComponent(forkId)}`, { method: 'DELETE' });
    line(`  已清理 fork`);
  }
}

// ---- 事实 Y：现有 v2 测试断言与真机行为对照 ----
line('\n【事实Y】评审C 8a：现有 test-host-client-v2.js:152 / :198-199 断言的语义');
line('  说明：该测试用 mock，非真机。此处只记录其断言内容供 battle 引用：');
line('    :152 断言 getSessionStatus(不在active集合) === "idle"');
line('    :198-199 断言 waitForSessionIdle 得到 completed:true / finalStatus:"idle"');
line(`  真机事实（F-10/F-11）：fork 不在 active → getSessionStatus=idle → waitForSessionIdle 秒判完成`);
line(`  => 现有 v2 测试的 mock 恰好【忠实复刻】了真机的错误行为（这是问题，不是测试不忠）`);

line('\n===== 裁决结束 =====\n');
