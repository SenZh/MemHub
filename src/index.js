#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { 
  recordKnowledge, 
  searchKnowledge, 
  getKnowledge, 
  getKnowledgeBatch, 
  listRecent,
  backupDatabase,
  getStats,
  logMcpAccess
} from './storage.js';

const server = new Server(
  {
    name: 'memhub',
    version: '0.1.2'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// 1. 注册可用工具列表 (ListTools) - 核心为 memhub_* 标准命令，并向后兼容 hub_* 与 exo_*
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const memhubSaveTool = {
    name: 'memhub_save',
    description: '【主动长效记忆沉淀】当攻克了排错避坑(learnings)、做出关键架构决策(decisions)、或沉淀出最佳实践模板(patterns)时调用。必须包含业务操作背景(context)与验证通过的解决方案(solution)。支持前置查重与版本替换。严禁记录未经验证的猜测。',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '【L1索引标题】格式严格遵守: [技术栈/模块] 核心场景/症状 -> 最终结论/正解 (25-45字，必须含具体实体名，如: [Docker/Alpine] glibc缺失致canvas加载崩溃 -> 改用debian-slim或加libc6-compat)'
        },
        category: {
          type: 'string',
          description: '【必须】三大核心分类之一: 排错避坑(learnings), 架构决策(decisions), 业务知识(business)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '【必须】客观技术实体关键词列表(自动小写)，如: ["redis", "redisson", "docker"]'
        },
        content: {
          type: 'string',
          description: '【必须】纯 Markdown 自由技术正文。严禁八股文！连贯阐述业务背景、核心证据/堆栈、验证通过的真实完整代码片段与防踩坑底线'
        },
        solution: {
          type: 'string',
          description: '【兼容别名】同 content，经过验证的完整正解代码或正文内容'
        },
        context: {
          type: 'string',
          description: '【可选】业务背景与触发痛点'
        },
        project: {
          type: 'string',
          description: '所属工作区/项目名。默认自动推导当前工作区；若属于全公司跨项目通用的经验，显式填 "global"'
        },
        related_files: {
          type: 'array',
          items: { type: 'string' },
          description: '涉及的核心代码或配置文件相对路径列表'
        },
        session_id: {
          type: 'string',
          description: '当前会话的 Session ID（若上下文可知）'
        },
        supersedes: {
          type: 'string',
          description: '可选：若本次沉淀是对某张历史卡片的演进或推翻，填入被替代的旧卡片 ID (如 kb-xxxx)'
        }
      },
      required: ['title', 'category', 'tags']
    }
  };

  const memhubSearchTool = {
    name: 'memhub_search',
    description: '【两阶段渐进式检索 - 阶段一 | 必须前置触发】在工程暗知识库中检索历史排错根因、架构决策红线与业务隐性规则。\n' +
      '【何时必须调用】\n' +
      '1. 遇到报错堆栈、构建失败、测试挂掉时（先查既有排错因果链，严禁盲目猜测修改代码）；\n' +
      '2. 准备修改鉴权、事务、锁、并发、多租户等核心架构前（核对历史 ADR 决策与架构红线）；\n' +
      '3. 处理支付、充值、订单状态流转等复杂业务逻辑前（检索隐性业务潜规则）；\n' +
      '4. 面临技术方案二选一或重构代码前。\n' +
      '【怎么读】仅返回轻量强指纹摘要(~30-50 Tokens)，绝不撑爆上下文。比对命中后，必须立即调用 memhub_get 拉取正文详情。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或问题描述（支持报错堆栈、异常类名、技术实体名、业务功能词）'
        },
        project: {
          type: 'string',
          description: '可选：工作区/项目名（如 "bindCenter"）。自动包含该项目专属资产 + 全局通用资产(global)，物理隔离无关项目'
        },
        workspace: {
          type: 'string',
          description: '可选：同 project 参数，工作区别名'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：技术实体标签数组（如 ["redis", "redisson"]），做多标签 AND 精确交集收窄'
        },
        category: {
          type: 'string',
          enum: ['learnings', 'decisions', 'patterns', 'business'],
          description: '可选：限定分类（learnings=排错, decisions=架构决策, patterns=代码模板, business=业务潜规则）'
        },
        limit: {
          type: 'number',
          description: '返回结果数量上限，默认 5'
        }
      },
      required: ['query']
    }
  };

  const memhubGetTool = {
    name: 'memhub_get',
    description: '【两阶段渐进式检索 - 阶段二 | 详情与代码展开】当 memhub_search 返回的摘要与当前场景/报错吻合时调用。\n' +
      '【能做什么】拉取完整结构化长效知识，包括：深层技术根因分析、踩坑误区清单、架构红线硬约束、以及经过自测验证的标准代码/配置片段。支持传入单一 id 或 ids 数组批量拉取。',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: '要拉取详情的记忆卡片 ID 列表 (例如 ["kb-c3ffcbe1", "kb-7d6f60b8"])'
        },
        id: {
          type: 'string',
          description: '单个卡片 ID（兼容旧单值参数）'
        }
      }
    }
  };

  const memhubRecentTool = {
    name: 'memhub_recent',
    description: '【查看最近记忆轨迹】列出最近沉淀的长效记忆索引（支持按 project 和 tags 过滤），用于开局建立项目上下文或了解最近演进。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回条数，默认 10'
        },
        project: {
          type: 'string',
          description: '可选：限定所属项目名（自动穿透 global 资产）'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：按标签过滤'
        }
      }
    }
  };

  return {
    tools: [
      memhubSaveTool,
      memhubSearchTool,
      memhubGetTool,
      memhubRecentTool,
      // 向后兼容 hub_* 别名
      { ...memhubSaveTool, name: 'hub_record_knowledge', description: '【兼容别名】请优先使用 memhub_save。' },
      { ...memhubSearchTool, name: 'hub_search_knowledge', description: '【兼容别名】请优先使用 memhub_search。' },
      { ...memhubGetTool, name: 'hub_get_knowledge', description: '【兼容别名】请优先使用 memhub_get。' },
      { ...memhubRecentTool, name: 'hub_list_recent', description: '【兼容别名】请优先使用 memhub_recent。' },
      // 向后兼容 exo_* 别名
      { ...memhubSaveTool, name: 'exo_record_knowledge', description: '【向后兼容别名】请优先使用 memhub_save。' },
      { ...memhubSearchTool, name: 'exo_search_knowledge', description: '【向后兼容别名】请优先使用 memhub_search。' },
      { ...memhubGetTool, name: 'exo_get_knowledge', description: '【向后兼容别名】请优先使用 memhub_get。' },
      { ...memhubRecentTool, name: 'exo_list_recent', description: '【向后兼容别名】请优先使用 memhub_recent。' }
    ]
  };
});

// 2. 处理工具调用请求 (CallTool) - 带审计日志切面
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startMs = Date.now();
  let status = 'SUCCESS';
  let errorMessage = null;
  let hitsCount = 0;
  let querySummary = null;

  try {
    switch (name) {
      case 'memhub_save':
      case 'hub_record_knowledge':
      case 'exo_record_knowledge': {
        querySummary = args?.title || null;
        try {
          const result = recordKnowledge(args);
          hitsCount = result?.success ? 1 : 0;
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (error) {
          status = 'ERROR';
          errorMessage = error.message;
          return {
            isError: true,
            content: [{ type: 'text', text: `沉淀知识失败: ${error.message}` }]
          };
        }
      }

      case 'memhub_search':
      case 'hub_search_knowledge':
      case 'exo_search_knowledge': {
        querySummary = args?.query || null;
        try {
          const results = searchKnowledge(args.query, {
            category: args.category,
            project: args.project || args.workspace,
            tags: args.tags,
            limit: args.limit || 5
          });

          hitsCount = results ? results.length : 0;

          if (!results || results.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    total_hits: 0,
                    message: `未检索到与 "${args.query}" 相关的历史暗知识或架构决策。`,
                    results: []
                  }, null, 2)
                }
              ]
            };
          }

          // 渐进式披露 L1 核心返回，附带明确的 instruction 引导
          const payload = {
            total_hits: results.length,
            instruction: `已检索到 ${results.length} 条相关记忆索引。请比对是否与当前问题或报错场景吻合。\n` +
              `• 若吻合：请立即调用 memhub_get(ids=[...]) 获取该方案的完整技术根因、正解代码与避坑指南，依循历史最佳实践编写代码；\n` +
              `• 若均不吻合：说明暂无相关历史沉淀，请继续常规排查或编码。`,
            results: results.map(r => ({
              id: r.id,
              title: r.title,
              category: r.category,
              project: r.project,
              tags: r.tags,
              summary: r.summary,
              related_files: r.related_files
            }))
          };

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(payload, null, 2)
              }
            ]
          };
        } catch (error) {
          status = 'ERROR';
          errorMessage = error.message;
          return {
            isError: true,
            content: [{ type: 'text', text: `检索知识失败: ${error.message}` }]
          };
        }
      }

      case 'memhub_get':
      case 'hub_get_knowledge':
      case 'exo_get_knowledge': {
        try {
          // 支持单个 id 或 ids 数组
          let targetIds = [];
          if (Array.isArray(args.ids)) {
            targetIds = args.ids;
          } else if (args.id) {
            targetIds = [args.id];
          }

          querySummary = targetIds.join(', ');

          if (targetIds.length === 0) {
            throw new Error('缺少必填参数 id 或 ids 列表');
          }

          const details = getKnowledgeBatch(targetIds);
          hitsCount = details ? details.length : 0;

          if (details.length === 0) {
            return {
              isError: true,
              content: [{ type: 'text', text: `未找到 ID 为 [${targetIds.join(', ')}] 的知识卡片。` }]
            };
          }

          // 若只查单条，直接返回单条 Markdown；若多条，组合返回
          const combinedText = details.map(d => d.content).join('\n\n---\n\n');

          return {
            content: [
              {
                type: 'text',
                text: combinedText
              }
            ]
          };
        } catch (error) {
          status = 'ERROR';
          errorMessage = error.message;
          return {
            isError: true,
            content: [{ type: 'text', text: `读取知识详情失败: ${error.message}` }]
          };
        }
      }

      case 'memhub_recent':
      case 'hub_list_recent':
      case 'exo_list_recent': {
        querySummary = `limit=${args.limit || 10}`;
        try {
          const results = listRecent({
            limit: args.limit || 10,
            project: args.project
          });
          hitsCount = results ? results.length : 0;

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  total: results.length,
                  results
                }, null, 2)
              }
            ]
          };
        } catch (error) {
          status = 'ERROR';
          errorMessage = error.message;
          return {
            isError: true,
            content: [{ type: 'text', text: `拉取最近列表失败: ${error.message}` }]
          };
        }
      }

      default:
        status = 'ERROR';
        errorMessage = `未知工具: ${name}`;
        throw new McpError(ErrorCode.MethodNotFound, errorMessage);
    }
  } finally {
    // 异步无阻断记录审计日志流水
    const durationMs = Date.now() - startMs;
    try {
      logMcpAccess({
        tool_name: name,
        project: args?.project || args?.workspace || null,
        session_id: args?.session_id || null,
        query_summary: querySummary,
        input_payload: args,
        hits_count: hitsCount,
        duration_ms: durationMs,
        status,
        error_message: errorMessage
      });
    } catch {}
  }
});

// 3. 启动 Server 并监听 Stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MemHub MCP Server] 已启动，正在通过 stdio 监听请求...');
}

main().catch((err) => {
  console.error('[MemHub MCP Server] 启动失败:', err);
  process.exit(1);
});
