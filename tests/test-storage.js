import assert from 'node:assert';
import fs from 'node:fs';
import { 
  recordKnowledge, 
  searchKnowledge, 
  getKnowledge, 
  getKnowledgeBatch, 
  listRecent,
  backupDatabase,
  exportToMarkdown,
  getStats,
  findDuplicateByTitle
} from '../src/storage.js';
import { scrubSecrets } from '../src/scrubber.js';

console.log('--- 开始测试 1: 敏感信息脱敏管道 ---');
const rawText = '我的 OpenAI key 是 sk-12345678901234567890abcdef 和 postgres://user:secret123@localhost:5432/db';
const scrubbed = scrubSecrets(rawText);
console.log('脱敏后文本:', scrubbed);
assert(!scrubbed.includes('sk-12345678901234567890abcdef'));
assert(!scrubbed.includes('secret123'));
assert(scrubbed.includes('***REDACTED***'));
console.log('测试 1 通过！\n');

console.log('--- 开始测试 2: 知识主动落盘入单文件 SQLite (物理字段分层) ---');
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

// 验证前置查重拦截
console.log('--- 验证前置查重与幂等防线 ---');
const duplicateRes = recordKnowledge({
  title: '[Docker/Alpine] glibc 缺失导致 sharp 模块加载失败报错解决',
  category: 'learnings',
  tags: ['docker'],
  symptom: '重复测试',
  root_cause: '重复测试',
  solution: '重复测试'
});
console.log('重复写入响应:', duplicateRes);
assert(duplicateRes.duplicate === true);
assert(duplicateRes.id === recordRes.id);
console.log('查重防线验证通过！\n');

console.log('--- 开始测试 3: 渐进式 L1 摘要检索 (FTS5 Trigram) ---');
const searchRes1 = searchKnowledge('Alpine');
console.log('搜索 "Alpine" 结果条数:', searchRes1.length);
assert(searchRes1.length > 0);
assert(searchRes1.some(r => r.id === recordRes.id));
assert(typeof searchRes1[0].summary === 'string'); // 包含 L1 摘要

const searchRes2 = searchKnowledge('缺失');
console.log('搜索中文 "缺失" 结果条数:', searchRes2.length);
assert(searchRes2.length > 0);
assert(searchRes2.some(r => r.title.includes('缺失')));
console.log('测试 3 通过！\n');

console.log('--- 开始测试 4: 渐进式 L2/L3 详情展开与批量读取 ---');
const card = getKnowledge(recordRes.id);
assert(card !== null);
assert(card.title === recordRes.title);
assert(card.code_payload.includes('libc6-compat'));
assert(!card.content.includes('sk-testkey1234567890123456')); // 确认脱敏生效

// 批量读取测试
const batchCards = getKnowledgeBatch([recordRes.id]);
assert(batchCards.length === 1);
assert(batchCards[0].id === recordRes.id);

const recent = listRecent({ limit: 5 });
assert(recent.length > 0);
console.log('测试 4 通过！\n');

console.log('--- 开始测试 5: VACUUM INTO 无损原子热备份与 Markdown 导出 ---');
const backupPath = backupDatabase();
console.log('热备份镜像生成于:', backupPath);
assert(fs.existsSync(backupPath));

const exportRes = exportToMarkdown();
console.log('Markdown 导出结果:', exportRes);
assert(exportRes.totalExported > 0);

// 测试研发统计
const stats = getStats();
console.log('资产统计结果:', stats);
assert(stats.total_knowledge_entries > 0);
console.log('测试 5 通过！\n');

console.log('🎉 全部核心存储、分层检索与归档备份单元测试 100% 通过！');
