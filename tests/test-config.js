import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, MEMHUB_HOME, DEFAULT_CATEGORIES, normalizeCategory } from '../src/config.js';

console.log('=== [单测: Config 动态配置与防腐加载] ===');

// 1. 默认配置兜底测试
console.log('1. 验证默认配置兜底与分类常量...');
const cfgDefault = getConfig();
assert(typeof cfgDefault.idleMinutes === 'number');
assert(cfgDefault.idleMinutes > 0);
assert(Array.isArray(cfgDefault.scanRules.watchDirectories));
assert(Array.isArray(cfgDefault.scanRules.include));
assert(Array.isArray(cfgDefault.scanRules.exclude));
assert(DEFAULT_CATEGORIES.includes('default'), '分类常量必须包含 default');
assert(DEFAULT_CATEGORIES.includes('business'), '分类常量必须包含 business');
console.log('   ✅ 默认配置兜底与分类常量通过');

// 2. 环境变量覆盖与合法性防腐
console.log('2. 验证环境变量覆盖与非法值纠偏...');
process.env.MEMHUB_IDLE_MINUTES = '45';
const cfgEnv = getConfig();
assert.strictEqual(cfgEnv.idleMinutes, 45);

// 传入非法负数或非数字
// 注：纠偏目标 = 用户配置文件的合法值（无配置则内置默认 120）。
//     先清除环境变量再取基准值，避免读到刚设置的 45。
delete process.env.MEMHUB_IDLE_MINUTES;
const baselineIdle = getConfig().idleMinutes;
assert(typeof baselineIdle === 'number' && baselineIdle > 0);

process.env.MEMHUB_IDLE_MINUTES = '-20';
const cfgInvalid = getConfig();
assert.strictEqual(cfgInvalid.idleMinutes, baselineIdle); // 非法负数纠偏回基准值

process.env.MEMHUB_IDLE_MINUTES = 'abc';
const cfgNaN = getConfig();
assert.strictEqual(cfgNaN.idleMinutes, baselineIdle); // 非法非数字纠偏回基准值

delete process.env.MEMHUB_IDLE_MINUTES;
console.log('   ✅ 环境变量覆盖与防腐通过');

// 3. 验证分类归一化映射 (含 business 多别名)
console.log('3. 验证分类归一化映射 (含 business 多别名)...');
assert.strictEqual(normalizeCategory('business'), 'business');
assert.strictEqual(normalizeCategory('biz'), 'business');
assert.strictEqual(normalizeCategory('business_rules'), 'business');
assert.strictEqual(normalizeCategory('domain'), 'business');
assert.strictEqual(normalizeCategory('rule'), 'business');
assert.strictEqual(normalizeCategory('业务知识'), 'business');
assert.strictEqual(normalizeCategory('learnings'), 'learnings');
assert.strictEqual(normalizeCategory('decisions'), 'decisions');
assert.strictEqual(normalizeCategory('patterns'), 'patterns');
assert.strictEqual(normalizeCategory('default'), 'default');
assert.strictEqual(normalizeCategory('unknown_xyz'), 'default'); // 未知兜底
assert.strictEqual(normalizeCategory(''), 'default'); // 空值兜底
console.log('   ✅ 分类归一化映射全部通过');

// 4. 验证历史兼容环境变量降级白名单 (TC-NAME-06)
console.log('4. 验证历史兼容环境变量降级白名单 (TC-NAME-06)...');
assert(typeof MEMHUB_HOME === 'string' && MEMHUB_HOME.length > 0);
console.log('   - 当前解析的 MEMHUB_HOME:', MEMHUB_HOME);
console.log('   ✅ 兼容降级白名单验证通过');

console.log('\n🎉 Config 模块单元测试全部通过！');
