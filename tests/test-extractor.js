import assert from 'node:assert';
import { KnowledgeExtractor } from '../src/pipeline/extractor.js';

console.log('=== [层级单测: Pipeline 知识提炼领域层] ===');

// 1. 测试短会话/无价值会话过滤
console.log('1. 验证短文本/闲聊自动过滤...');
const emptyRes = KnowledgeExtractor.extract({ id: 's1', title: '你好' }, ['hello']);
assert(emptyRes === null);
console.log('   ✅ 空会话过滤断言通过');

// 2. 测试典型排错特征提炼
console.log('2. 验证排错场景启发式提炼...');
const mockSession = {
  id: 'ses-test-1',
  title: 'workbuddy 插件模型列表排查',
  projectPath: 'D:/workspace/test'
};
const mockTexts = [
  'workbuddy 插件模型列表怎么来的？',
  '调查发现 workbuddy.so 无法 push 到 git 仓库。',
  '因为 .gitignore 第 8 行忽略了 plugins/cpa-workbuddy/**/*.so，必须用 git add -f 提交。'
];

const extracted = KnowledgeExtractor.extract(mockSession, mockTexts);
assert(extracted !== null);
assert(extracted.category === 'learnings');
assert(extracted.title.includes('[Go/Workbuddy]'));
assert(extracted.tags.includes('git-add-f'));
assert(extracted.session_id === 'ses-test-1');
console.log('   - 提炼出的标题:', extracted.title);
console.log('   - 提炼出的标签:', extracted.tags);
console.log('   ✅ 领域提炼层断言通过');

console.log('🎉 Pipeline 知识提炼领域层单元测试 100% 通过！\n');
