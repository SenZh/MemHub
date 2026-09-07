import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
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
assert(path.basename(backupPath).startsWith('memhub_backup_'), '备份文件名前缀必须以 memhub_backup_ 开头！');

const exportRes = exportToMarkdown();
console.log('Markdown 导出结果:', exportRes);
assert(exportRes.totalExported > 0);

// 测试研发统计
const stats = getStats();
console.log('资产统计结果:', stats);
assert(stats.total_knowledge_entries > 0);
console.log('测试 5 通过！\n');

console.log('--- 开始测试 6: 三大分类专属要素与 Workspace / Tags 多维过滤 ---');
// 1. 写入 decisions 架构决策
const decisionRes = recordKnowledge({
  title: '[支付中台/账户] 充值赠送阶梯与余额账本分离的架构决策与防套现红线',
  category: 'decisions',
  project: 'pay-center',
  tags: ['finance', 'wallet', 'ledger'],
  context: '设计用户充值赠送业务时，需解决赠送金额与真实本金提现冲突',
  root_cause: '单字段混合存储导致退款无法溯源',
  solution: '采用双账本/双子钱包设计：主余额与赠送余额分离',
  impact: '涉及 WalletService 与 SettlementJob',
  alternatives: ['单表双字段方案（行锁竞争无法支撑）'],
  guardrails: ['严禁直写 DAO，必须走统一账本入口']
});
assert(decisionRes.success === true);

// 2. 写入 patterns 最佳实践
const patternRes = recordKnowledge({
  title: '[数据导出/MyBatis] 大数据量分页流式查询与内存安全输出模板',
  category: 'patterns',
  project: 'global', // 全局通用资产
  tags: ['streaming', 'mybatis-cursor', 'memory-safe'],
  context: '单次导出超 10 万行，避免将整个大集合载入内存',
  solution: '利用 MyBatis Cursor 与 try-with-resources 流式分块输出',
  prerequisites: 'JDK 17+, MyBatis 3.5+',
  boundaries: '超高并发小分页查询禁止使用，避免连接开销'
});
assert(patternRes.success === true);

// 3. 验证 Workspace 项目隔离与 global 穿透
const paySearch = searchKnowledge('账本', { project: 'pay-center' });
assert(paySearch.some(r => r.id === decisionRes.id), '必须召回当前项目私有资产');

const crossSearch = searchKnowledge('账本', { project: 'other-project' });
assert(!crossSearch.some(r => r.id === decisionRes.id), '无关项目不得召回其他项目私有资产');

const globalSearch = searchKnowledge('流式', { project: 'pay-center' });
assert(globalSearch.some(r => r.id === patternRes.id), '任何工作区必须自动穿透命中 global 资产');

// 4. 验证 Tags 多标签交集过滤 (AND)
const tagHit = searchKnowledge('查询', { tags: ['streaming', 'mybatis-cursor'] });
assert(tagHit.some(r => r.id === patternRes.id), '命中全部指定标签');

const tagMiss = searchKnowledge('查询', { tags: ['streaming', 'not-exist-tag'] });
assert(!tagMiss.some(r => r.id === patternRes.id), '未命中全部标签时必须过滤');

// 5. 验证各分类专属 Markdown 详情渲染
const decisionCard = getKnowledge(decisionRes.id);
assert(decisionCard.content.includes('## 📌 业务与技术痛点背景'));
assert(decisionCard.content.includes('## ⛔ 不可触碰的架构红线'));
assert(decisionCard.content.includes('严禁直写 DAO'));

const patternCard = getKnowledge(patternRes.id);
assert(patternCard.content.includes('## 🎯 业务应用场景与解决痛点'));
assert(patternCard.content.includes('## 📦 前置依赖与运行环境'));
assert(patternCard.content.includes('## ⚠️ 适用边界与反模式'));

// 6. 验证扩展数组要素脱敏 (P1 防漏防泄露)
const secretCardRes = recordKnowledge({
  title: '[安全/测试] 包含敏感凭证的误区与红线测试',
  category: 'learnings',
  context: '测试敏感脱敏',
  solution: '安全方案',
  ineffective_attempts: ['curl -H "Authorization: Bearer sk-12345678901234567890abcdef" https://api.com'],
  guardrails: ['禁止提交密码 postgres://user:secret123@localhost:5432/db']
});
const secretCard = getKnowledge(secretCardRes.id);
assert(!secretCard.content.includes('sk-12345678901234567890abcdef'), '数组要素内敏感 key 必须被脱敏！');
assert(!secretCard.content.includes('secret123'), '数组要素内数据库密码必须被脱敏！');
assert(secretCard.content.includes('***REDACTED***'));

// 7. 验证 listRecent 对齐工作区穿透与标签交集 (P1 修复验证)
const recentPay = listRecent({ project: 'pay-center' });
assert(recentPay.some(r => r.id === decisionRes.id), 'listRecent 必须召回当前项目资产');
assert(recentPay.some(r => r.id === patternRes.id), 'listRecent 必须穿透 global 通用资产');

const recentTag = listRecent({ tags: ['streaming', 'mybatis-cursor'] });
assert(recentTag.some(r => r.id === patternRes.id), 'listRecent 必须支持多标签交集过滤');
const recentTagMiss = listRecent({ tags: ['streaming', 'not-exist'] });
assert(!recentTagMiss.some(r => r.id === patternRes.id), '未完全匹配标签时必须排除');

console.log('测试 6 通过！\n');

console.log('🎉 全部核心存储、分层检索与归档备份单元测试 100% 通过！');
