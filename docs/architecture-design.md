# ExoBrain 完整架构与详细系统设计文档 (System Architecture Document)

> **版本**：v1.2 (Layered Decoupled Architecture & Fully Verified)  
> **状态**：Approved / Production Prototype Delivered  
> **定位**：AI 编程会话的原生知识外脑（免维护、自动沉淀、遇事即唤）

---

## 1. 系统摘要与核心设计原则

### 1.1 背景与痛点
开发者与各类 AI Agent（OpenCode、Cursor、Claude Code 等）交互中产出了大量极其宝贵的排错经验、兼容性方案与架构决策。然而，现有模式存在三大致命问题：
1. **知识蒸发（Knowledge Evaporation）**：会话阅后即焚，调试数小时攻克的难题随会话关闭而淹没，新会话中 Agent 再次踩坑。
2. **“跨三省”人工翻找（Retrieval Friction）**：开发者隐约记得以前解决过，但需要在几十个历史窗口、不同 IDE 数据库中人肉搜索。
3. **传统方案失焦**：通用 Wiki（Notion/飞书）维护门槛高易过时；全量向量 RAG 将闲聊切片导致噪声大，且需配置独立付费 LLM。

### 1.2 核心设计原则 (Core Tenets)
1. **知识而非任务**：专注沉淀长期可复用的 Know-how（避坑指南、架构决策、技术方案），坚决不做临时任务交接。
2. **复用宿主算力与缓存**：绝不强迫用户额外配置第三方大模型 Key，利用原 Agent 的上下文与 Prompt Cache。
3. **主动直通为主、被动安全兜底**：主路径走 MCP Tool 内存直通落盘；离线增量扫描通过适配器排重推进。
4. **Markdown 为真理唯一来源，SQLite 为加速视图**：物理卡片纯文本可读可备份，随时可一键自愈重建索引。
5. **中英双语检索开箱即用**：采用 SQLite FTS5 原生 `trigram` 分词器，彻底解决中文全文检索断层。

---

## 2. 系统四层解耦架构 (Layered Architecture)

为了保证系统的高度可维护性与跨 Agent 扩展能力，代码严格遵循 4 层解耦模型：

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 4: 接口协议与呈现层 (Interfaces)                                   │
│  - Stdio MCP Server (exo_record/search/get/list)                        │
│  - 开发者终端 CLI (exo find/get/list/scan/rebuild)                     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 3: 提炼与调度管道层 (Pipeline & Consolidation)                    │
│  - KnowledgeExtractor: 领域启发式与特征提炼引擎 (过滤闲聊、构建卡片)     │
│  - ScannerService: 离线会话调度器与 session_tracking 状态机控制         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌────────────────────────────────────┴────────────────────────────────────┐
│ Layer 2: 宿主适配器层 (Agent Adapters)                                  │
│  - AgentAdapter 抽象基类 (定义 isAvailable, scan, readContext 契约)     │
│  - OpenCodeAdapter (本地 opencode.db 扫描与消息提取)                    │
│  - CursorAdapter (workspaceStorage 探测与状态插槽)                       │
│  - AdapterRegistry (适配器注册中心与活跃 Session 自动推导)              │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1: 基础设施与存储层 (Core & Infrastructure)                       │
│  - StorageEngine: SQLite FTS5 (Trigram) + Markdown 原子双写管道         │
│  - Scrubber: 敏感凭据脱敏管道 (Secret Scrubbing)                        │
│  - Config: 跨平台路径解析 (~/.exobrain/)                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 存储模型与物理契约 (Storage Design)

### 3.1 物理目录布局 (`~/.exobrain/`)
```text
~/.exobrain/
├── config.json                     # 全局配置
├── index.db                        # SQLite 数据库（WAL 模式，元数据、FTS5、状态机）
└── vault/                          # 知识真理唯一来源 (Markdown 纯文本)
    ├── learnings/                  # 避坑指南与排错经验 (kb-<id>.md)
    ├── decisions/                  # 架构与设计决策 (kb-<id>.md)
    └── solutions/                  # 通用方案与模板代码 (kb-<id>.md)
```

### 3.2 L2 知识卡片格式规范 (Markdown + YAML Frontmatter)
```markdown
---
id: "kb-36bb2d0c"
title: "[OpenCode/MCP] 搭建本地 Stdio MCP 服务的防锁死与协议纯净实践"
category: "solutions"
tags: ["mcp","opencode","sqlite","stdio","wal"]
project: "v0"
source_agent: "generic"
session_id: "ses_f9366d481ffeAwkdOnpcImsrOI"
status: "active"
superseded_by: null
created_at: "2026-09-04T14:42:24.353Z"
---

## 现象与症状 (Symptom)
...

## 根本原因 (Root Cause)
...

## 经过验证的正解 (Solution)
...

## 关键关联面 / 文件
- `src/index.js`
- `src/storage.js`
```

### 3.3 存储加速层与并发防御 (`index.db`)
- `PRAGMA journal_mode = WAL;` 与 `PRAGMA busy_timeout = 5000;` 确保并发读写不锁死。
- `knowledge_fts` 启用 `trigram` 分词器，支持中英文、代码片段高速 BM25 检索。
- `session_tracking` 维护状态机：`PENDING` $\rightarrow$ `EXTRACTING` $\rightarrow$ `EXTRACTED` / `SKIPPED` / `FAILED`。

---

## 4. 双轨知识获取机制

### 4.1 主动直通机制（核心主路径：RPC 内存直通）
- 用户输入 `/know`、`/save` 或说“总结沉淀刚才的方案”。
- Agent 调用 `exo_record_knowledge` MCP Tool。
- MCP Server 执行密钥脱敏后直接写入文件与 SQLite，耗时 <10ms，不触碰 IDE 私有数据库。

### 4.2 被动离线扫描机制（兜底增量推进）
- 调度器通过 `OpenCodeAdapter` 等适配器扫描未处理候选会话（`parent_id IS NULL` 杜绝 Fork 炸弹）。
- 经由 `KnowledgeExtractor` 领域过滤后原子写入并打标 `EXTRACTED`，自动增量推进，绝不循环死锁。

---

## 5. 分层自动化测试策略

系统为 4 个解耦层级分别配备了完全独立的单元测试：
1. `npm run test:storage`：测试 Layer 1 基础设施（脱敏管道、原子写、FTS5 中英文分词）。
2. `npm run test:adapters`：测试 Layer 2 适配器（多态约束、本地 OpenCode 会话探测）。
3. `npm run test:extractor`：测试 Layer 3 领域管道（闲聊过滤、结构化提炼）。
4. `npm run test:mcp`：测试 Layer 4 接口层（Stdio JSON-RPC 协议与 4 个工具契约）。
5. `npm test`：端到端全量回归测试套件。
