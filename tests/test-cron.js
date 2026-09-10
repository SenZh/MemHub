import assert from 'node:assert';
import { compileCron, cronMatches } from '../src/cron.js';
import { findCronHitBetween } from '../src/daemon.js';

console.log('=== [单测: Cron 表达式解析与匹配引擎 src/cron.js] ===');

console.log('1. 基本 "* * * * *" 全匹配...');
{
  const c = compileCron('* * * * *');
  assert.equal(c.match(new Date(2026, 8, 10, 3, 30)), true, '任意时刻都应命中');
  assert.equal(c.match(new Date(2026, 8, 10, 0, 0)), true);
  console.log('   ✅ 全通配命中');
}

console.log('2. 每天凌晨 3:00 精确命中（dream 默认表达式）...');
{
  const c = compileCron('0 3 * * *');
  assert.equal(c.match(new Date(2026, 8, 10, 3, 0)), true, '3:00 应命中');
  assert.equal(c.match(new Date(2026, 8, 10, 3, 1)), false, '3:01 不应命中');
  assert.equal(c.match(new Date(2026, 8, 10, 2, 0)), false, '2:00 不应命中');
  assert.equal(c.match(new Date(2026, 8, 10, 4, 0)), false, '4:00 不应命中');
  console.log('   ✅ 3:00 精确命中，其余分钟不命中');
}

console.log('3. 步长 "*\/30 2-4 * * *" 每 30 分钟（窗口内）...');
{
  const c = compileCron('*/30 2-4 * * *');
  assert.equal(c.match(new Date(2026, 8, 10, 2, 0)), true);
  assert.equal(c.match(new Date(2026, 8, 10, 2, 30)), true);
  assert.equal(c.match(new Date(2026, 8, 10, 4, 30)), true);
  assert.equal(c.match(new Date(2026, 8, 10, 2, 15)), false, '2:15 不命中');
  assert.equal(c.match(new Date(2026, 8, 10, 5, 0)), false, '5:00 超出小时范围');
  console.log('   ✅ 步长 + 小时区间正确');
}

console.log('4. 列表与区间 "0 9,18 * * 1-5"（工作日 9/18 点）...');
{
  const c = compileCron('0 9,18 * * 1-5');
  // 2026-09-10 是周四
  assert.equal(c.match(new Date(2026, 8, 10, 9, 0)), true, '周四 9:00 命中');
  assert.equal(c.match(new Date(2026, 8, 10, 18, 0)), true, '周四 18:00 命中');
  assert.equal(c.match(new Date(2026, 8, 10, 10, 0)), false, '周四 10:00 不命中');
  // 2026-09-13 是周日
  assert.equal(c.match(new Date(2026, 8, 13, 9, 0)), false, '周日不命中');
  console.log('   ✅ 列表小时 + 工作日区间正确');
}

console.log('5. 月约束 "0 3 1 * *"（每月 1 号）...');
{
  const c = compileCron('0 3 1 * *');
  assert.equal(c.match(new Date(2026, 8, 1, 3, 0)), true, '9/1 命中');
  assert.equal(c.match(new Date(2026, 8, 2, 3, 0)), false, '9/2 不命中');
  console.log('   ✅ 月内日期约束正确');
}

console.log('6. 日与周同时受限时取 OR 语义...');
{
  const c = compileCron('0 3 15 * 0');
  // 2026-09-15 是周二（命中日）
  assert.equal(c.match(new Date(2026, 8, 15, 3, 0)), true, '15 号命中');
  // 2026-09-13 是周日（命中周）
  assert.equal(c.match(new Date(2026, 8, 13, 3, 0)), true, '周日命中');
  // 2026-09-16 周三且非 15 号
  assert.equal(c.match(new Date(2026, 8, 16, 3, 0)), false, '都不命中');
  console.log('   ✅ 日/周 OR 语义正确');
}

console.log('7. 非法表达式应抛出明确异常...');
{
  assert.throws(() => compileCron('0 3 * *'), /必须为 5 段/, '段数不足应报错');
  assert.throws(() => compileCron('60 3 * * *'), /越界/, '分值越界应报错');
  assert.throws(() => compileCron('0 24 * * *'), /越界/, '时值越界应报错');
  assert.throws(() => compileCron('0 3 * * abc'), /非法/, '非数值应报错');
  assert.throws(() => compileCron(''), /不能为空/, '空串应报错');
  console.log('   ✅ 非法输入全部被拦截');
}

console.log('8. cronMatches 快捷函数...');
{
  assert.equal(cronMatches('0 3 * * *', new Date(2026, 8, 10, 3, 0)), true);
  assert.equal(cronMatches('0 3 * * *', new Date(2026, 8, 10, 3, 5)), false);
  console.log('   ✅ 快捷匹配正确');
}

console.log('9. findCronHitBetween 跨轮询相位命中（daemon 调度核心）...');
{
  const m = compileCron('0 3 * * *');
  // 模拟 02:26 -> 03:26 的一轮 60 分钟 tick，应跨过 03:00
  const from = new Date(2026, 8, 10, 2, 26, 0).getTime();
  const to = new Date(2026, 8, 10, 3, 26, 0).getTime();
  const hit = findCronHitBetween(m, from, to);
  assert(hit instanceof Date, '应跨区间命中 03:00');
  assert.equal(hit.getHours(), 3);
  assert.equal(hit.getMinutes(), 0);

  // 区间不含命中点（00:26 -> 01:26）应返回 null
  const miss = findCronHitBetween(m, new Date(2026, 8, 10, 0, 26, 0).getTime(), new Date(2026, 8, 10, 1, 26, 0).getTime());
  assert.equal(miss, null, '不含命中点的区间不应误报');

  // 对照：旧的"当前分钟精确匹配"在相位 :26 下永不命中
  let oldHit = false;
  let t = new Date(2026, 8, 10, 0, 26, 0);
  for (let i = 0; i < 24; i++) {
    t = new Date(t.getTime() + 60 * 60000);
    if (m.match(t)) { oldHit = true; break; }
  }
  assert.equal(oldHit, false, '相位 :26 下旧精确匹配逻辑确实永不命中（缺陷复现）');
  console.log('   ✅ 区间命中检测修复了相位错位，旧逻辑确实永不命中');
}

console.log('\n🎉 Cron 引擎 9 项断言全部通过！');
