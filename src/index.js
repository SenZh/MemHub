#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { recordKnowledge, searchKnowledge, getKnowledge, listRecent } from './storage.js';

const server = new Server(
  {
    name: 'exobrain-mcp',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// 1. 注册可用工具列表 (ListTools)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'exo_record_knowledge',
        description: '【主动知识沉淀】当攻克了复杂排错/Bug、做出关键架构决策、或提炼出可复用解决方案时，调用此工具将知识永久保存到 ExoBrain 知识库。',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'L3 高密度检索标题，格式严格遵守: [技术栈/模块] 核心场景/症状 最终结论/正解 (20-35字，必须含具体实体名)'
            },
            category: {
              type: 'string',
              enum: ['learnings', 'decisions', 'solutions'],
              description: '知识分类：learnings(踩坑排错), decisions(架构设计决策), solutions(通用方案模板)'
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: '检索关键词列表，如: ["docker", "alpine", "glibc", "sharp"]'
            },
            symptom: {
              type: 'string',
              description: '现象与具体报错信息（包含报错日志、环境条件、复现场景）'
            },
            root_cause: {
              type: 'string',
              description: '经过深度诊断后的技术根因剖析'
            },
            solution: {
              type: 'string',
              description: '经过验证的完整正解（可复用的配置变更、核心修复代码片段、操作步骤）'
            },
            related_files: {
              type: 'array',
              items: { type: 'string' },
              description: '涉及的核心代码或配置文件路径列表'
            },
            session_id: {
              type: 'string',
              description: '当前会话的 Session ID（若上下文可知）'
            }
          },
          required: ['title', 'category', 'tags', 'symptom', 'root_cause', 'solution']
        }
      },
      {
        name: 'exo_search_knowledge',
        description: '【毫秒级知识检索】在设计方案或排查 Bug 前，搜索 ExoBrain 历史知识库，查找是否已有排错经验或已定架构决策，防止重复踩坑。',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词或问题描述（支持中英文、代码实体名，如 "Alpine glibc" 或 "Spring 循环依赖"）'
            },
            category: {
              type: 'string',
              enum: ['learnings', 'decisions', 'solutions'],
              description: '可选：限定分类'
            },
            limit: {
              type: 'number',
              description: '返回结果数量上限，默认 5'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'exo_get_knowledge',
        description: '【读取详细知识卡片】根据搜索命中的知识 ID (如 kb-xxxx)，拉取完整的 L2 Markdown 正文及完整正解代码。',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: '知识卡片 ID (形如 kb-c3ffcbe1)'
            }
          },
          required: ['id']
        }
      },
      {
        name: 'exo_list_recent',
        description: '【查看最近知识地图】列出最近沉淀的知识索引，用于开局建立上下文或查看项目动态。',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: '返回条数，默认 10'
            },
            project: {
              type: 'string',
              description: '可选：限定所属项目名'
            }
          }
        }
      }
    ]
  };
});

// 2. 处理工具执行请求 (CallTool)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'exo_record_knowledge': {
        const result = recordKnowledge(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                message: `成功沉淀知识卡片 [${result.id}]`,
                id: result.id,
                title: result.title,
                category: result.category,
                file_path: result.file_path
              }, null, 2)
            }
          ]
        };
      }

      case 'exo_search_knowledge': {
        const results = searchKnowledge(args.query, {
          category: args.category,
          limit: args.limit || 5
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `未检索到与 "${args.query}" 相关的历史知识。建议自行排查后调用 exo_record_knowledge 沉淀经验。`
              }
            ]
          };
        }

        const formatted = results.map((r, i) => 
          `${i + 1}. [${r.id}] [${r.category}] ${r.title}\n   - 标签: ${r.tags.join(', ')}\n   - 关联项目: ${r.project || '全局'}\n   - 摘要: ${r.solution_snippet || r.symptom_snippet || '详见卡片'}`
        ).join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `检索到 ${results.length} 条相关知识：\n\n${formatted}\n\n提示：如需查看完整排错方案与代码，请调用 exo_get_knowledge(id)。`
            }
          ]
        };
      }

      case 'exo_get_knowledge': {
        const card = getKnowledge(args.id);
        if (!card) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `未找到 ID 为 "${args.id}" 的知识卡片。`
              }
            ]
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: card.content
            }
          ]
        };
      }

      case 'exo_list_recent': {
        const list = listRecent({
          limit: args?.limit || 10,
          project: args?.project
        });

        if (list.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: '当前知识库为空。'
              }
            ]
          };
        }

        const formatted = list.map((item, i) =>
          `${i + 1}. [${item.id}] [${item.category}] ${item.title} (项目: ${item.project || '通用'})`
        ).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `最近沉淀的知识地图 (共 ${list.length} 条)：\n\n${formatted}`
            }
          ]
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${name}`);
    }
  } catch (error) {
    console.error(`[ExoBrain MCP Error] 执行工具 ${name} 失败:`, error);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `执行失败: ${error.message}`
        }
      ]
    };
  }
});

// 3. 启动基于 Stdio 的传输层
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ExoBrain MCP Server] 已启动，正在通过 stdio 监听请求...');
}

main().catch((err) => {
  console.error('[ExoBrain MCP Server] 启动崩溃:', err);
  process.exit(1);
});
