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
  getStats
} from './storage.js';

const server = new Server(
  {
    name: 'memhub',
    version: '0.1.1'
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
          enum: ['learnings', 'decisions', 'patterns'],
          description: '【必须】三大分类之一: learnings(排错避坑因果链), decisions(架构决策ADR/红线), patterns(最佳实践/可复用代码配置模板)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '【必须】客观技术实体关键词列表(自动小写)，如: ["redis", "redisson", "docker", "alpine"]'
        },
        context: {
          type: 'string',
          description: '【必须】业务背景与触发动作：说明在进行什么业务操作、何种环境版本、或者什么痛点驱动下发生的'
        },
        solution: {
          type: 'string',
          description: '【必须】经过验证的完整正解（可复用的配置变更、核心修复代码片段、标准模板代码）'
        },
        symptom: {
          type: 'string',
          description: '[learnings专用] 现象与具体报错信息（包含真实错误堆栈字面量、异常类签名）'
        },
        root_cause: {
          type: 'string',
          description: '[learnings/decisions专用] 深入技术根因因果链剖析，或架构决策核心裁决理由'
        },
        ineffective_attempts: {
          type: 'array',
          items: { type: 'string' },
          description: '[learnings专用] 已排除的误区与无效尝试清单（防止后人重蹈覆辙）'
        },
        prevention: {
          type: 'string',
          description: '[learnings专用] 验证自测手段与防复发门禁（如加了什么单测、配了什么监控报警）'
        },
        impact: {
          type: 'string',
          description: '[decisions专用] 受影响拓扑面、改动类与关联数据表清单'
        },
        alternatives: {
          type: 'array',
          items: { type: 'string' },
          description: '[decisions专用] 评估过的备选方案及放弃理由（Why Not X?）'
        },
        migration: {
          type: 'string',
          description: '[decisions专用] 新老数据平滑迁移方案与回滚降级策略'
        },
        guardrails: {
          type: 'array',
          items: { type: 'string' },
          description: '[decisions专用] 不可触碰的架构红线与硬约束'
        },
        prerequisites: {
          type: 'string',
          description: '[patterns专用] 前置运行环境依赖、版本矩阵与中间件要求'
        },
        mechanism: {
          type: 'string',
          description: '[patterns专用] 核心交互时序、数据流向与执行机制'
        },
        boundaries: {
          type: 'string',
          description: '[patterns专用] 适用边界与反模式（什么时候坚决别用）'
        },
        verification: {
          type: 'string',
          description: '[patterns专用] 自测验证与并发压测用例代码'
        },
        project: {
          type: 'string',
          description: '所属工作区/项目名。默认自动推导当前工作区；若属于全公司跨项目通用的最佳实践或避坑，显式填 "global"'
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
      required: ['title', 'category', 'tags', 'context', 'solution']
    }
  };

  const memhubSearchTool = {
    name: 'memhub_search',
    description: '【两阶段渐进式检索 - 阶段一】在动手写代码、设计方案或排查报错前调用。支持关键词、工作区(project/workspace)、标签(tags)和分类过滤。仅返回 25-45 字强指纹摘要(~30-50 Tokens)，绝不撑爆上下文。大模型必须先比对返回的摘要，确认命中后再调用 memhub_get 拉取正文。',
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
          enum: ['learnings', 'decisions', 'patterns'],
          description: '可选：限定分类（learnings=排错, decisions=架构决策, patterns=代码模板）'
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
    description: '【两阶段渐进式检索 - 阶段二】当 memhub_search 返回的某条摘要与当前问题高度吻合时，调用此工具拉取该卡片的完整 Markdown 详情（包含详细业务背景、技术根因、真实修复代码、已排除误区与架构红线）。',
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: '要拉取详情的记忆卡片 ID 列表 (例如 ["kb-c3ffcbe1"])'
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

// 2. 处理工具调用请求 (CallTool)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'memhub_save':
    case 'hub_record_knowledge':
    case 'exo_record_knowledge': {
      try {
        const result = recordKnowledge(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `沉淀知识失败: ${error.message}` }]
        };
      }
    }

    case 'memhub_search':
    case 'hub_search_knowledge':
    case 'exo_search_knowledge': {
      try {
        const results = searchKnowledge(args.query, {
          category: args.category,
          project: args.project || args.workspace,
          tags: args.tags,
          limit: args.limit || 5
        });

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
          instruction: `已命中 ${results.length} 条相关记忆索引。请比对是否与当前问题吻合。如需完整技术根因、正解代码与修改步骤，请立即调用 memhub_get(ids=[...]) 获取详情。`,
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

        if (targetIds.length === 0) {
          throw new Error('缺少必填参数 id 或 ids 列表');
        }

        const details = getKnowledgeBatch(targetIds);

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
        return {
          isError: true,
          content: [{ type: 'text', text: `读取知识详情失败: ${error.message}` }]
        };
      }
    }

    case 'memhub_recent':
    case 'hub_list_recent':
    case 'exo_list_recent': {
      try {
        const results = listRecent({
          limit: args.limit || 10,
          project: args.project
        });

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
        return {
          isError: true,
          content: [{ type: 'text', text: `拉取最近列表失败: ${error.message}` }]
        };
      }
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
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
