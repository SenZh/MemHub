import assert from 'node:assert';
import { PathFilter } from '../src/path-filter.js';

console.log('=== [单测: PathFilter 路径规则与 Glob 过滤引擎] ===');

// TC-PF-01: Exclude 黑名单拦截
console.log('1. 验证 Exclude 黑名单拦截...');
const filter1 = new PathFilter({
  exclude: ['**/tmp/**', '**/node_modules/**']
});
assert.strictEqual(filter1.isMatch('D:/workspace/tmp/my-proj'), false);
assert.strictEqual(filter1.isMatch('D:/workspace/tmp'), false); // 目录本身
assert.strictEqual(filter1.isMatch('D:/workspace/node_modules/pkg'), false);
assert.strictEqual(filter1.isMatch('D:/workspace/normal-proj'), true);
console.log('   ✅ TC-PF-01 通过');

// TC-PF-02: Windows 反斜杠与大小写归一
console.log('2. 验证 Windows 反斜杠与大小写归一...');
const filter2 = new PathFilter({
  exclude: ['**/my-secret-project/**']
});
assert.strictEqual(filter2.isMatch('D:\\Workspace\\MY-SECRET-PROJECT'), false);
assert.strictEqual(filter2.isMatch('D:\\Workspace\\MY-SECRET-PROJECT\\sub'), false);
assert.strictEqual(filter2.isMatch('D:\\Workspace\\OtherProject'), true);
console.log('   ✅ TC-PF-02 通过');

// TC-PF-03: Include 白名单正常放行与拦截
console.log('3. 验证 Include 白名单...');
const filter3 = new PathFilter({
  include: ['**/target-proj/**']
});
assert.strictEqual(filter3.isMatch('D:/workspace/target-proj'), true); // 目录本身
assert.strictEqual(filter3.isMatch('D:/workspace/target-proj/src'), true);
assert.strictEqual(filter3.isMatch('D:/workspace/other-proj'), false);
console.log('   ✅ TC-PF-03 通过');

// TC-PF-04: Exclude 严格优先于 Include
console.log('4. 验证 Exclude 优先于 Include...');
const filter4 = new PathFilter({
  include: ['**/target-proj/**'],
  exclude: ['**/target-proj/private/**']
});
assert.strictEqual(filter4.isMatch('D:/workspace/target-proj/src'), true);
assert.strictEqual(filter4.isMatch('D:/workspace/target-proj/private/keys'), false); // 排除
console.log('   ✅ TC-PF-04 通过');

// TC-PF-05: 正则特殊字符安全转义 (防注入与语法崩溃，扩充括号测试)
console.log('5. 验证特殊正则符号与复杂路径 (., +, (), [])...');
const filter5 = new PathFilter({
  include: ['**/v0.2.1-beta+test/**'],
  exclude: ['**/build(test)/**', '**/archive[2026]/**']
});
assert.strictEqual(filter5.isMatch('D:/workspace/v0.2.1-beta+test'), true);
assert.strictEqual(filter5.isMatch('D:/workspace/v0.2.1-beta+test/src'), true);
assert.strictEqual(filter5.isMatch('D:/workspace/v0x2x1-betatest'), false); // 验证 . 没有被当成任意字符通配
assert.strictEqual(filter5.isMatch('D:/workspace/build(test)/dist'), false); // 验证括号安全转义
assert.strictEqual(filter5.isMatch('D:/workspace/archive[2026]/old'), false); // 验证方括号安全转义
console.log('   ✅ TC-PF-05 通过');

// TC-PF-06: 根目录监听 watchDirectories 限制
console.log('6. 验证 watchDirectories 根目录限制...');
const filter6 = new PathFilter({
  watchDirectories: ['D:/workspace/allowed-root']
});
assert.strictEqual(filter6.isMatch('D:/workspace/allowed-root/proj1'), true);
assert.strictEqual(filter6.isMatch('D:/workspace/other-root/proj2'), false);
assert.strictEqual(filter6.isMatch('C:/workspace/allowed-root/proj3'), false); // 盘符不同
console.log('   ✅ TC-PF-06 通过');

// TC-PF-07: 边界防御 (null / undefined / 空字符)
console.log('7. 验证空值与非法参数防御...');
const filterNull = new PathFilter(null);
assert.strictEqual(filterNull.isMatch(null), false);
assert.strictEqual(filterNull.isMatch(undefined), false);
assert.strictEqual(filterNull.isMatch(''), false);
assert.strictEqual(filterNull.isMatch('D:/workspace/any'), true); // 默认无规则放行
console.log('   ✅ TC-PF-07 通过');

// 边界测试：前缀模糊保护 (防止 tmp 误杀 tmp-data)
console.log('8. 验证前缀保护 (tmp 不误伤 tmp-data)...');
const filter8 = new PathFilter({
  exclude: ['**/tmp']
});
assert.strictEqual(filter8.isMatch('D:/workspace/tmp'), false);
assert.strictEqual(filter8.isMatch('D:/workspace/tmp-data'), true); // 严防误杀
console.log('   ✅ 边界防误杀通过');

console.log('\n🎉 PathFilter 单元测试全部通过 (8/8)！');
