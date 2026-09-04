import assert from 'node:assert';
import fs from 'node:fs';
import { recordKnowledge, searchKnowledge, getKnowledge, listRecent } from '../src/storage.js';
import { scrubSecrets } from '../src/scrubber.js';

console.log('--- 开始测试 1: 敏感信息脱敏管道 ---');
const rawText = '我的 OpenAI key 是 sk-12345678901234567890abcdef 和 postgres://user:secret123@localhost:5432/db';
const scrubbed = scrubSecrets(rawText);
console.log('脱敏后文本:', scrubbed);
assert(!scrubbed.includes('sk-12345678901234567890abcdef'));
assert(!scrubbed.includes('secret123'));
assert(scrubbed.includes('***REDACTED***'));
console.log('测试 1 通过！\n');

console.log('--- 开始测试 2: 知识主动落盘与原子写入 ---');
const recordRes = recordKnowledge({
  title: '[Docker/Alpine] glibc 缺失导致 sharp 模块加载失败报错解决',
  category: 'learnings',
  tags: ['docker', 'alpine', 'glibc', 'sharp', 'nodejs'],
  symptom: '在 node:20-alpine 镜像中运行 sharp 报错: Error relocating symbol not found sk-testkey1234567890123456',
  root_cause: 'Alpine 默认采用 musl libc，而 sharp 编译的二进制文件依赖 glibc 动态链接库',
  solution: '在 Dockerfile 中添加: RUN apk add --no-cache libc6-compat 即可完美解决',
  related_files: ['Dockerfile', 'package.json']
});

console.log('写入结果:', recordRes);
assert(recordRes.success === true);
assert(recordRes.id.startsWith('kb-'));
assert(fs.existsSync(recordRes.file_path));

const fileContent = fs.readFileSync(recordRes.file_path, 'utf-8');
assert(fileContent.includes('## 现象与症状'));
assert(!fileContent.includes('sk-testkey1234567890123456')); // 确认脱敏
console.log('测试 2 通过！\n');

console.log('--- 开始测试 3: 中文 Trigram 全文检索 (BM25) ---');
const searchRes1 = searchKnowledge('Alpine');
console.log('搜索 "Alpine" 结果条数:', searchRes1.length);
assert(searchRes1.length > 0);
assert(searchRes1.some(r => r.id === recordRes.id));

const searchRes2 = searchKnowledge('缺失');
console.log('搜索中文 "缺失" 结果条数:', searchRes2.length);
assert(searchRes2.length > 0);
assert(searchRes2.some(r => r.title.includes('缺失')));
console.log('测试 3 通过！\n');

console.log('--- 开始测试 4: 读取详细卡片与最近列表 ---');
const card = getKnowledge(recordRes.id);
assert(card !== null);
assert(card.title === recordRes.title);
assert(card.content.includes('libc6-compat'));

const recent = listRecent({ limit: 5 });
assert(recent.length > 0);
console.log('测试 4 通过！\n');

console.log('🎉 全部核心存储与检索单元测试 100% 通过！');
