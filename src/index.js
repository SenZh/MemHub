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
    name: 'memory-hub',
    version: '0.2.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// 1. 注册可用工具列表 (ListTools) - 同时兼容 hub_* 与 exo_* 双命名空间
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'hub_record_knowledge',
        description: '【主动知识沉淀】当攻克了复杂排错/Bug、做出关键架构决策、或提炼出通用可复用方案时，将高价值工程暗知识持久化存入 Memory Hub。支持前置查重与版本替换。',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'L3 高密度检索标题，格式严格遵守: [技术栈/模块] 核心场景/症状 最终结论/正解 (20-35字，必须含具体实体名)'
            },
            category: {
              type: 'string',
              description: '知识分类：learnings(踩坑排错), decisions(架构设计决策), solutions(通用方案模板) 或项目自定义分类'
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
            },
            supersedes: {
              type: 'string',
              description: '可选：若本次沉淀是对某张历史卡片的演进或推翻，填入被替代的旧卡片 ID (如 kb-xxxx)'
            }
          },
          required: ['title', 'category', 'tags', 'symptom', 'root_cause', 'solution']
        }
      },
      {
        name: 'hub_search_knowledge',
        description: '【第一步：检索高维索引】在设计方案或排查 Bug 前，毫秒级检索知识库。注意：本工具仅返回 L1 极简摘要与 ID (~30-50 Tokens)，绝对不含代码正文。若命中相关条目，必须紧接着调用 hub_get_knowledge 拉取正文。',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词或问题描述（支持中英文、错误日志、代码实体名，如 "Alpine glibc" 或 "Spring 循环依赖"）'
            },
            category: {
              type: 'string',
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
        name: 'hub_get_knowledge',
        description: '【第二步：展开详情与代码正文】根据 hub_search_knowledge 返回的 ID 数组，拉取完整的深度根因分析与验证正解代码（L2/L3 详文）。',
        inputSchema: {
          type: 'object',
          properties: {
            ids: {
              type: 'array',
              items: { type: 'string' },
              description: '要拉取的一组或单个知识卡片 ID 列表 (例如 ["kb-c3ffcbe1"])'
            },
            id: {
              type: 'string',
              description: '单个卡片 ID（兼容旧单值参数）'
            }
          }
        }
      },
      {
        name: 'hub_list_recent',
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
      },
      // 兼容旧 exo_* 前缀别名
      {
        name: 'exo_record_knowledge',
        description: '【向后兼容别名】请优先使用 hub_record_knowledge。',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            symptom: { type: 'string' },
            root_cause: { type: 'string' },
            solution: { type: 'string' },
            related_files: { type: 'array', items: { type: 'string' } },
            session_id: { type: 'string' },
            supersedes: { type: 'string' }
          },
          required: ['title', 'category', 'tags', 'symptom', 'root_cause', 'solution']
        }
      },
      {
        name: 'exo_search_knowledge',
        description: '【向后兼容别名】请优先使用 hub_search_knowledge。',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            category: { type: 'string' },
            limit: { type: 'number' }
          },
          required: ['query']
        }
      },
      {
        name: 'exo_get_knowledge',
        description: '【向后兼容别名】请优先使用 hub_get_knowledge。',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        }
      },
      {
        name: 'exo_list_recent',
        description: '【向后兼容别名】请优先使用 hub_list_recent。',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            project: { type: 'string' }
          }
        }
      }
    ]
  };
});

// 2. 处理工具调用请求 (CallTool)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
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

    case 'hub_search_knowledge':
    case 'exo_search_knowledge': {
      try {
        const results = searchKnowledge(args.query, {
          category: args.category,
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
          instruction: `已命中 ${results.length} 条相关知识索引。请比对是否与当前问题吻合。如需完整技术根因、正解代码与修改步骤，请立即调用 hub_get_knowledge(ids=[...]) 获取详情。`,
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
  console.error('[Memory Hub MCP Server] 已启动，正在通过 stdio 监听请求...');
}

main().catch((err) => {
  console.error('[Memory Hub MCP Server] 启动失败:', err);
  process.exit(1);
});
