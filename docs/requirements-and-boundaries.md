# ExoBrain 需求规格与系统边界定义 (Requirements & Boundaries Specification)

> **版本**：v1.1 (Post-Review Revised)  
> **状态**：Approved  
> **核心定位**：AI 编程会话的原生知识外脑（免维护、自动沉淀、遇事即唤）

---

## 一、核心业务问题与价值主张

### 1. 业务痛点：“跨三省找历史”与“踩同样的坑”
在当下使用 AI Agent（OpenCode、Claude Code、Cursor 等）进行软件工程开发时，存在严重的**知识资产流失**问题：
- **知识蒸发（Knowledge Evaporation）**：开发者花数小时与 Agent 攻克的一个隐蔽环境 Bug、特殊兼容性问题或深层架构决策，在 Session 结束后就彻底淹没在海量对话日志中。下次开启新会话或切换工具时，Agent 依然“失忆”，开发者不得不从头重新解释、再次踩坑。
- **检索断层（Retrieval Friction）**：开发者模糊记得“以前某个项目、某个 Session 里解决过”，但需要在不同 IDE、不同工程目录的本地数据库与历史聊天窗口中像“跨三省”一样人肉翻找。
- **录入负担（Documentation Fatigue）**：开发者和团队极度缺乏动力手动在 Notion/飞书/Wiki 中维护一份“踩坑手册”，因为脱离了开发主路径，维护成本极高，极易过时。

### 2. 价值主张 (Value Proposition)
ExoBrain 让**会话本身成为知识的沉淀源泉**：
通过主动 MCP 内存直通与后台轻量被动扫描，将散落的对话自动萃取为原子化知识（避坑经验、架构决策、技术方案），并通过全局统一的极速索引与标准 MCP 接口，使得人（CLI 终端）和 Agent（上下文检索）均能在**毫秒级**唤醒过往经验，实现**一次踩坑、全局免疫、永不遗忘**。

---

## 二、系统边界设计：能做哪些 vs 不做哪些

### 1. 能做哪些 (In-Scope / Core Capabilities)

| 模块 | 能力边界说明 |
|---|---|
| **会话级知识萃取** | 从会话中识别并抽取三类核心知识：<br>1. **避坑指南 (Learnings/Gotchas)**：偶发报错、深层兼容性、环境暗坑及正解。<br>2. **架构决策 (ADR/Decisions)**：为什么选方案 A 不选方案 B、隐性业务规则。<br>3. **技术方案 (Solutions/Know-how)**：关键算法实现、特殊工具链配置、典型代码模板。 |
| **复用宿主 Agent 算力** | **零外部模型配置**：利用原会话自身的上下文与模型参数执行提炼，利用服务商的 Prompt Cache 实现近乎免费且极速的知识萃取。 |
| **三级金字塔存储** | 1. **L3 (极短目录)**：单条 20~30 字，基于 SQLite FTS5 (Trigram 分词) 实现毫秒级中英文 BM25 全文检索。<br>2. **L2 (知识卡片)**：300~800 字标准化 Markdown，包含现象、根因、正解与参考文件，物理存储于本地，真理唯一来源。<br>3. **L1 (证据溯源)**：记录原 Session ID、指纹及关键上下文凭证。 |
| **跨工具全局汇聚** | 统一归纳来自 OpenCode、Cursor、Claude Code 等不同工具的知识资产，汇总至中心化目录 `~/.exobrain/`。 |
| **敏感凭据前置脱敏** | **强制安全管道 (Secret Scrubbing)**：所有知识落盘入库前，必须经过正则脱敏管道，过滤 API Key、Token、密码、内网私有 IP，防止跨项目泄露。 |
| **生命周期与自愈重建** | 支持版本覆盖与废弃标记（`superseded_by`），提供 `exo rebuild` 命令，支持从纯 Markdown 目录一键重建 SQLite 全文索引。 |

---

### 2. 明确不做哪些 (Non-Goals / Out-of-Scope)

| 排除项 (Non-Goals) | 排除原因与明确不做的边界 |
|---|---|
| ❌ **不做独立大模型推理中继 (No LLM Proxy/Daemon Gateway)** | 绝不要求用户配置第三方 API Key，所有推理必须通过宿主 Agent 借力完成。 |
| ❌ **不做海量全量向量数据库 (No Heavy Vector DB / RAG)** | 拒绝暴力切片和 Embedding，坚决杜绝语义漂移与闲聊噪声。以“精炼提炼 + FTS5 全文索引”为核心。 |
| ❌ **不做在线多人协作 Wiki (No Collaborative Wiki / Editor)** | 不做 Notion/飞书的在线协同与富文本编辑器，纯粹面向本地开发者与 Agent。 |
| ❌ **不做临时任务交接管理器 (No Task Hand-off / Kanban)** | 不管理未完成的临时代码或待办，只沉淀**已经验证过、具备长期复用价值的经验**。 |
| ❌ **不做侵入式 IDE 修改 (No Binary Hacking / Patching)** | 绝不修改 Cursor 或 VS Code 二进制文件，通过开放的 MCP 协议与规则文件实现无缝集成。 |

---

## 三、功能需求矩阵 (Functional Requirements)

### 1. 采集与提炼引擎 (Harvesting & Extraction)
- **FR-1.1 主动直通提炼（跨 Agent 通用核心路径）**：
  - 用户输入 `/know`、`/save` 或自然语言“沉淀刚才的排查”。
  - 宿主 Agent 实时提炼，通过 MCP 工具 `exo_record_knowledge` 内存直通入库，零延迟，不回读 IDE 本地库。
- **FR-1.2 OpenCode 无头安全提炼（离线兜底）**：
  - 扫描 `opencode.db`，严格过滤 `parent_id IS NULL` 与特定前缀，防范递归 Fork 炸弹。
  - 通过 `opencode run --session <id> --fork` 在独立子会话中提炼，Prompt Cache 100% 命中，原会话零污染。
  - Windows 环境下通过 `taskkill /T /F` 或 Job Objects 进行进程树级超时强杀（120s），防止端口泄漏。
- **FR-1.3 Cursor 主被动隔离**：
  - Cursor 全面以 MCP 主动调用为主路径；`state.vscdb` 仅作为只读崩溃后补捞工具，日常不监听高频 WAL 刷盘。
- **FR-1.4 敏感信息清洗管道 (Secret Scrubbing)**：
  - 入库前自动匹配清洗常见云厂商 AK/SK、JWT、密码、私钥等，替换为 `***REDACTED***`。

### 2. 存储与分层引擎 (Storage & Indexing)
- **FR-2.1 原子写入与 Markdown 优先**：
  - L2 知识卡片采用“临时文件写入 + 原子重命名（Atomic Rename）”落盘，杜绝文件损坏。
- **FR-2.2 中英文全文索引 (SQLite FTS5 Trigram)**：
  - 采用 SQLite FTS5 的 `trigram` tokenizer，完美支持中文分词、英文实体词与混合代码片段的高速 BM25 检索。
- **FR-2.3 数据库防并发死锁**：
  - 强制开启 `PRAGMA journal_mode = WAL;` 与 `PRAGMA busy_timeout = 5000;`。

### 3. 消费与消费交互 (Consumption Interfaces)
- **FR-3.1 统一 MCP 工具契约 (`exo-mcp`)**：
  - `exo_record_knowledge`: 主动沉淀知识卡片。
  - `exo_get_knowledge`: 获取单张知识卡片完整正文。
  - `exo_search_knowledge`: 关键字与标签的全文搜索。
  - `exo_list_recent`: 拉取最近沉淀或特定项目的知识。
- **FR-3.2 知识地图物理注入与容量上限**：
  - 严格限制预注入条目数（Top-30 或当前项目相关，Token 预算锁定在 500 以内）。
  - Cursor 端通过维护 `.cursor/rules/exobrain-map.mdc` 规则注入；OpenCode 端通过 `.opencode/knowledge-map.xml` 注入。
- **FR-3.3 开发者终端 CLI (`exo`)**：
  - `exo find "<query>"`：毫秒级终端搜索。
  - `exo list`：查看最近条目。
  - `exo rebuild`：从 Markdown 目录全量自愈重建 SQLite 索引。
