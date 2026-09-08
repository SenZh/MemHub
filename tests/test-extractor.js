import assert from 'node:assert';
import { KnowledgeExtractor } from '../src/pipeline/extractor.js';

console.log('=== [层级单测: Pipeline 知识提炼领域层] ===');

// 1. 测试短会话/无价值会话过滤
console.log('1. 验证短文本/闲聊自动过滤...');
const emptyRes = KnowledgeExtractor.extract({ id: 's1', title: '你好' }, ['hello']);
assert(emptyRes === null);
console.log('   ✅ 空会话过滤断言通过');

// 2. 测试 Truth Verification Gate (物理终态证据门禁)
console.log('2. 验证 Truth Verification Gate 证据门禁...');
const failSession = { id: 'ses-fail', title: '排查连接超时', projectPath: 'D:/ws/test' };
const failTexts = [
  '一直报 connection timeout，试了重启',
  '还是超时，先不搞了明天再说吧'
];
// 无终态成功证据 -> 严禁提取，必须返回 null
const blockedRes = KnowledgeExtractor.extract(failSession, failTexts);
assert(blockedRes === null, '未见成功证据的会话必须被门禁拦截！');
assert(KnowledgeExtractor.verifyTruthGate(failTexts) === false);
assert(KnowledgeExtractor.verifyTruthGate(['npm test', 'all tests passed']) === true);
console.log('   ✅ 物理终态成功证据门禁检验通过');

// 3. 验证无 LLM 介入时坚决不捏造离线假卡
console.log('3. 验证无 LLM 时坚决不捏造硬编码假卡 (杜绝垃圾数据污染)...');
const mockSession = {
  id: 'ses-test-1',
  title: 'workbuddy 插件模型列表排查',
  projectPath: 'D:/workspace/test'
};
const mockTexts = [
  '调查发现 .gitignore 导致文件无法 push。',
  '使用 git add -f 之后成功推送，测试通过！'
];
const offlineExtract = KnowledgeExtractor.extract(mockSession, mockTexts);
assert(offlineExtract === null, '离线未接入 LLM 时严禁凭空伪造卡片内容！');
const offlineAll = KnowledgeExtractor.extractAll(mockSession, mockTexts);
assert(Array.isArray(offlineAll) && offlineAll.length === 0, '离线 extractAll 必须返回空列表');
console.log('   ✅ 离线硬编码假卡彻底废除断言通过');

// 4. 验证 parseLLMExtraction 解析宿主 LLM 返回的高质量结构化卡片
console.log('4. 验证 parseLLMExtraction 解析宿主 LLM 多卡输出...');
const llmJsonOutput = `
基于会话分析，提炼出以下两项具有长期复用价值的暗知识：
\`\`\`json
[
  {
    "category": "learnings",
    "title": "[Docker/Alpine] glibc缺失致canvas加载崩溃 -> 改用debian-slim或加libc6-compat",
    "tags": ["docker", "alpine", "glibc", "canvas"],
    "context": "在 Alpine 基础镜像部署带图形渲染的服务",
    "symptom": "Error: Loading dynamic library failed: glibc not found",
    "root_cause": "Alpine 默认使用 musl libc 而非 glibc",
    "solution": "在 Dockerfile 中安装 libc6-compat 或将基础镜像切换为 node:20-bookworm-slim",
    "topic_fingerprint": "docker-alpine-glibc"
  },
  {
    "category": "decisions",
    "title": "[架构决策/存储] 决定将 Redis 迁移至独立 Docker 容器的取舍",
    "tags": ["redis", "architecture", "docker"],
    "context": "解耦单体服务，保障缓存可用性",
    "solution": "拆分 docker-compose 并配置健康检查",
    "topic_fingerprint": "docker-redis-split"
  }
]
\`\`\`
已完成分析。
`;

const parsedCards = KnowledgeExtractor.parseLLMExtraction(llmJsonOutput, { id: 'ses-llm-1', projectPath: 'D:/proj' });
assert(Array.isArray(parsedCards) && parsedCards.length === 2, '应成功解析出 2 张高质量卡片');
assert(parsedCards[0].category === 'learnings');
assert(parsedCards[0].topic_fingerprint === 'docker-alpine-glibc');
assert(parsedCards[0].session_id === 'ses-llm-1');
assert(parsedCards[1].category === 'decisions');
console.log('   - 成功解析卡片分类:', parsedCards.map(c => c.category));
console.log('   ✅ parseLLMExtraction 多卡解析断言通过');

// 5. 验证无价值会话回复被严格拦截
console.log('5. 验证无价值会话直接拦截（无需沉淀回复返回空列表）...');
assert(KnowledgeExtractor.parseLLMExtraction('无需沉淀，本会话仅为文件查询。').length === 0);
assert(KnowledgeExtractor.parseLLMExtraction('无高价值暗知识，代码仅做格式化。').length === 0);
assert(KnowledgeExtractor.parseLLMExtraction('').length === 0);
console.log('   ✅ 无价值内容过滤断言通过');

console.log('🎉 Pipeline 知识提炼领域层单元测试 100% 通过！\n');
