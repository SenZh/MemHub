import assert from 'node:assert';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

console.log('=== [单测: CLI 命令体系与 bin 映射契约] ===');

// 1. 验证 package.json 的 bin 字段映射规范
console.log('1. 验证 package.json 的 bin 映射严格合规...');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
assert.strictEqual(pkg.name, 'memhub');
assert(pkg.bin, '缺少 bin 字段');

// 契约校验：
// 必须存在 memhub, mem-hub, memory-hub, exo
assert(pkg.bin['memhub'], '缺少 memhub 映射');
assert(pkg.bin['mem-hub'], '缺少 mem-hub 映射');
assert(pkg.bin['memory-hub'], '缺少 memory-hub 映射');
assert(pkg.bin['exo'], '缺少 exo 映射');

// 严禁存在通用冲突的 hub 命令！
assert.strictEqual(pkg.bin['hub'], undefined, '错误：严禁在 bin 中暴露通用的 hub 命令！');
console.log('   ✅ bin 字段映射契约完全合规 (已彻底移除 hub)');

// 2. 验证 CLI 执行与退出码
console.log('2. 验证 CLI 命令行运行与帮助输出...');
const cliOut = execSync('node src/cli.js', { encoding: 'utf-8' });
assert(cliOut.includes('MemHub'));
assert(cliOut.includes('memhub scan') || cliOut.includes('用法'));
console.log('   ✅ CLI 输出与退出码测试通过');

console.log('\n🎉 CLI 规范自动化测试全部通过！\n');
