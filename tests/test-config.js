import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, MEMHUB_HOME } from '../src/config.js';

console.log('=== [单测: Config 动态配置与防腐加载] ===');

// 1. 默认配置兜底测试
console.log('1. 验证默认配置兜底...');
const cfgDefault = getConfig();
assert(typeof cfgDefault.idleMinutes === 'number');
assert(cfgDefault.idleMinutes > 0);
assert(Array.isArray(cfgDefault.scanRules.watchDirectories));
assert(Array.isArray(cfgDefault.scanRules.include));
assert(Array.isArray(cfgDefault.scanRules.exclude));
console.log('   ✅ 默认配置兜底通过');

// 2. 环境变量覆盖与合法性防腐
console.log('2. 验证环境变量覆盖与非法值纠偏...');
process.env.MEMHUB_IDLE_MINUTES = '45';
const cfgEnv = getConfig();
assert.strictEqual(cfgEnv.idleMinutes, 45);

// 传入非法负数或非数字
process.env.MEMHUB_IDLE_MINUTES = '-20';
const cfgInvalid = getConfig();
assert.strictEqual(cfgInvalid.idleMinutes, 120); // 纠偏回默认

process.env.MEMHUB_IDLE_MINUTES = 'abc';
const cfgNaN = getConfig();
assert.strictEqual(cfgNaN.idleMinutes, 120); // 纠偏回默认

delete process.env.MEMHUB_IDLE_MINUTES;
console.log('   ✅ 环境变量覆盖与防腐通过');

console.log('\n🎉 Config 模块单元测试全部通过！');
