# ExoBrain 需求规格与系统边界定义 (Requirements & Boundaries Specification)

> **版本**：v1.2 (Industry Benchmark Reset)
> **状态**：Approved
> **核心定位**：AI 编程会话的实操锦囊（免维护、只记有价值知识、全局/项目两级隔离、借宿主算力、不锁工具）
> **v1.2 变更摘要**：基于业界对标（Mem0 v3 / Zep / Letta / Basic Memory / mcp-memory-service / claude-mem / AGENTS.md 标准）重校系统边界：新增"价值密度原则"与"两级记忆空间"两大核心诉求、确立 MCP + AGENTS.md 双开放标准集成通道、修正 v1.1 中与实现漂移的表述、明确"借宿主算力"模式的结构性天花板及其接受条款。

---

## 一、核心业务问题与价值主张

### 1. 业务痛点："跨三省找历史"与"踩同样的坑"
在当下使用 AI Agent（OpenCode、Cursor、Claude Code、Codex、Workbuddy Code、BodhiQ 等任意工具）进行软件工程开发时，存在严重的**知识资产流失**问题：
- **知识蒸发（Knowledge Evaporation）**：开发者花数小时与 Agent 攻克的一个隐蔽环境 Bug、特殊兼容性问题或深层架构决策，在 Session 结束后就彻底淹没在海量对话日志中。下次开启新会话或切换工具时，Agent 依然"失忆"，开发者不得不从头重新解释、再次踩坑。
- **检索断层（Retrieval Friction）**：开发者模糊记得"以前某个项目、某个 Session 里解决过"，但需要在不同 IDE、不同工程目录的本地数据库与历史聊天窗口中像"跨三省"一样人肉翻找。
- **录入负担（Documentation Fatigue）**：开发者和团队极度缺乏动力手动在 Notion/飞书/Wiki 中维护一份"踩坑手册"，因为脱离了开发主路径，维护成本极高，极易过时。

### 2. 价值主张 (Value Proposition)
ExoBrain 让**会话本身成为知识的沉淀源泉**：
通过主动 MCP 内存直通与后台轻量被动扫描，将散落的对话自动萃取为原子化知识（避坑经验、架构决策、技术方案），并通过全局统一的极速索引与标准 MCP 接口，使得人（CLI 终端）和 Agent（上下文检索）均能在**毫秒级**唤醒过往经验，实现**一次踩坑、全局免疫、永不遗忘**。

### 3. ⭐ 与业界方案的客观边界与分工（v1.3 新增）

在工业级 AI 研发实践中，代码理解与记忆系统存在清晰的**双轮驱动分工**：

```text
                    ┌──────────────────────────────────────────────┐
                    │            AI Coding Agent 执行循环           │
                    └──────────────────────┬───────────────────────┘
                                           │
               ┌───────────────────────────┴───────────────────────────┐
               ▼                                                       ▼
  【代码知识图谱 CodeGraph / Aider repomap】              【工程实操经验记忆 ExoBrain】
  （客观物理世界 / What is code）                         （主观决策历史 / Why it was done）
  ─────────────────────────────                           ───────────────────────────────
  · 代表：腾讯 TencentDB-Agent-Memory / colbymchenry/codegraph · 代表：ExoBrain
  · 底层：Tree-sitter AST 静态解析 + 调用图 + 爆炸半径      · 底层：单文件 SQLite + FTS5 + 渐进披露 + 宿主提炼
  · 属性：静态代码事实、调用树、确定性拓扑                 · 属性：时序经验、架构权衡、踩坑教训、业务潜规则
  · 职责：回答“代码在哪里、谁调用了谁、改动影响谁”         · 职责：回答“为什么这么做、踩过什么坑、该怎么改”
```

| 维度 | 代码图谱 / 符号检索 (CodeGraph / SCIP / Aider) | 通用对话记忆 (Mem0 / Zep) | 操作审计流水账 (claude-mem) | **工程经验与决策外脑 (ExoBrain)** |
|---|---|---|---|---|
| **核心定位** | 代码静态物理拓扑与符号引用 | 用户偏好与扁平陈述句事实 | 会话级工具调用操作记录仪 | **软件工程实操暗知识与长效决策随身锦囊** |
| **知识形态** | 函数/类/方法的调用关系与依赖图 | 主谓宾三元组 (User likes X) | 单次工具执行结果切片 (Observation) | **排错因果链 (Learnings) + 架构决策 (ADR) + 业务隐性规则** |
| **解决痛点** | 避免盲目 Grep 全仓代码，秒查依赖链路 | 跨会话记住用户个人习惯 | 追溯上一轮调试中跑过的具体命令 | **消灭跨会话“人肉翻历史”与“反复踩同一个环境/业务坑”** |
| **局限性** | 无法记录代码背后的意图、权衡与踩坑 | 缺乏工程 AST 拓扑，工程场景严重失真 | 偏向操作流水账，缺乏全局架构认知 | 不替代静态代码 AST 分析，专注认知与决策层 |

**立项合理性核对结论**：ExoBrain 不重复造 Tree-sitter 静态分析器的轮子，而是专注于代码图谱无法表达的**“长效架构权衡、深度排错因果与业务潜规则”**，与静态代码拓扑互为齿轮、协同配合。

---

## 二、系统边界设计：能做哪些 vs 不做哪些

### 1. 核心设计原则（v1.2 修订）

| # | 原则 | 说明 |
|---|---|---|
| 1 | **价值密度原则** | 只记有长期复用价值的实操暗知识与长效决策，拒绝记录低价值的工具操作流水账（避免膨胀与信噪比崩溃）。 |
| 2 | **两级空间与项目隔离** | 全局命名空间 + 项目命名空间（基于 Workspace 路径与 Git 根目录自动识别）；写入默认项目级，检索项目优先、全局兜底。 |
| 3 | **借宿主算力** | 绝不强迫用户配置第三方大模型 Key，利用原会话自身的上下文与模型参数执行提炼，Prompt Cache 极速零额外负担。 |
| 4 | **不锁工具（双开放标准）** | 集成通道收敛为 MCP（读写交互）+ AGENTS.md（被动注入，AAIF 约定）；跨 OpenCode、Cursor、Claude Code 通吃。 |
| 5 | **单文件 SQLite 工业存储内核** | 以单文件 SQLite 为核心存储真理源，自带 WAL 事务一致性与 FTS5 倒排索引，原生支持 `VACUUM INTO` 无损归档；Markdown 作为人类友好导出格式（按需导出）。 |
| 6 | **渐进式披露与存读一体** | 字段物理分层存储（L1 索引摘要 vs L2/L3 根因代码正文）；检索二阶段展开（先查索引再按 ID 抓取正解代码），从根本上避免 Token 爆炸与注意力迷失。 |

### 2. 能做哪些 (In-Scope / Core Capabilities)

| 模块 | 能力边界说明 |
|---|---|
| **会话级知识萃取** | 从会话中识别并抽取核心知识，内置三大高度抽象分类，并**支持结构化要素清单与用户自定义扩展**：<br>1. **避坑指南 (learnings/gotchas)**：业务操作背景、偶发报错、深层因果推导、真实正解代码、已排除误区清单、防复发自测门禁。<br>2. **架构决策 (decisions/ADR)**：业务痛点背景、受影响拓扑面、备选方案及放弃理由、最终裁决与妥协代价、平滑迁移与回滚、不可违背的设计红线。<br>3. **最佳实践 (patterns/solutions)**：业务适用场景与痛点、前置环境依赖树、核心时序与机制、生产级完整参考代码、适用边界与反模式、自测验证用例。<br>4. ⭐ **用户自定义扩展分类 (custom categories)**：允许项目通过配置文件声明新分类，定义其必填字段并自动生成校验与存储分层。 |
| **⭐ 智能多维过滤检索** | 支持全文检索 (FTS5 Trigram) + **工作区隔离与全局穿透 (`project = ? OR project = 'global'`)** + **多标签交集参数化收窄 (`tags AND`)**；检索默认只召回有效版本。 |
| **⭐ 两级空间与代码实体锚定** | 全局 vault + `workspaces/<project>/` 项目 vault；知识卡片与代码实体（`related_files`, `symbols`, `dependencies`）强绑定；文件变更可倒查关联经验。 |
| **复用宿主 Agent 算力** | **零外部模型与零 API Key 依赖**：利用原会话上下文与宿主环境已配置的模型参数执行提炼与归纳，利用 Prompt Cache 实现近乎免费的萃取。 |
| **三级渐进式披露存储** | 1. **L3 (极短高密度索引)**：单条 20~30 字，统一格式 `[技术栈/模块] 核心场景/症状 最终结论/正解`，毫秒级检索召回，极低 Token 消耗。<br>2. **L2 (知识卡片真理源)**：300~800 字标准化 Markdown（现象/根因/正解或背景/权衡/决议），本地存储，Obsidian 友好。<br>3. **L1 (证据与溯源)**：原 Session ID、Git Commit、时间戳及上下文凭证。 |
| **⭐ 双轨获取：主动沉淀 + 定时离线萃取** | 1. **主动链路**：开发者与 Agent 交互中通过 `/know` 或 MCP 工具主动沉淀，即刻落盘；<br>2. **被动离线定时扫描**：后台定时扫描 OpenCode (`opencode.db`) 与 Cursor (`state.vscdb`)，对**超过 2 小时未更新（判定为已结束）**的高价值会话自动借宿主算力萃取并沉淀。 |
| **跨工具全局汇聚** | 通过 MCP + AGENTS.md 双开放标准支持 OpenCode、Cursor、Claude Code、Codex 等任意工具；底层提供针对 OpenCode 与 Cursor 的双源离线数据适配器。 |
| **⭐ 全局态势统计与盘点** | 提供 `exo stats` / `exo list`，基于扫描采集的 session 元数据与知识库，统计各项目投入精力、修改重点、关键架构决策演进及避坑总资产。 |
| **敏感凭据前置脱敏** | 所有知识落盘入库前强制正则脱敏（API Key、Token、密码、内网私有 IP），替换为 `***REDACTED***`。 |
| **生命周期与自愈重建** | 版本覆盖与废弃标记；`exo rebuild` 从纯 Markdown 目录一键重建 SQLite 倒排索引与图谱。 |

### 3. 明确不做哪些 (Non-Goals / Out-of-Scope)

| 排除项 (Non-Goals) | 排除原因与明确不做的边界 |
|---|---|
| ❌ **不做独立大模型推理中继 (No LLM Proxy/Daemon Gateway)** | 绝不要求用户配置第三方 API Key，所有推理必须通过宿主 Agent 借力完成。⭐v1.2 明确：此约束导致 server 端无法执行智能管道（自动冲突消解、智能遗忘、三元组抽取质量），我们**主动接受**该天花板（详见架构文档 §7 诚实声明）。 |
| ❌ **不做海量全量向量库 (No Heavy Vector DB / RAG)** | 拒绝暴力切片和外部 Embedding API。⭐v1.2 修正：允许**本地 ONNX 可选向量层**作为混合检索的语义补充（零 API key），仍拒绝外部向量库与云依赖。 |
| ❌ **不做在线多人协作 Wiki** | 不做 Notion/飞书的在线协同与富文本编辑器，纯粹面向本地开发者与 Agent。 |
| ❌ **不做临时任务交接管理器** | 不管理未完成的临时代码或待办，只沉淀已经验证过、具备长期复用价值的经验。 |
| ❌ **不做侵入式 IDE 修改** | 绝不修改 Cursor 或 VS Code 二进制文件，通过 MCP 协议与 AGENTS.md 开放标准实现无缝集成。 |
| ❌ **不做全量对话记录器** ⭐新增 | 拒绝"什么都记"的全记录路线（claude-mem/memento 的膨胀噪声教训），不存低价值 observation 洪流，写入即高价值。 |
| ❌ **不做智能遗忘/冲突消解引擎** ⭐新增 | 哑 server 原则下做不到 server 端智能；接受规则衰减（命中次数+时间）与 superseded_by 半自动的降级方案。 |

---

## 三、功能需求矩阵 (Functional Requirements)

### 1. 采集与提炼引擎 (Harvesting & Extraction)
- **FR-1.1 主动直通提炼（跨 Agent 通用核心路径）**：
  - 用户输入 `/know`、`/save` 或自然语言"沉淀刚才的排查/决策"。
  - 宿主 Agent 实时提炼，通过 MCP 工具 `exo_record_knowledge` 内存直通入库，零延迟，不回读 IDE 本地库。
  - ⭐入库前强制去重管道：标题+分类哈希精确去重；FTS5 前置查重命中则返回已有卡片 ID 引导版本更新；支持 `superseded_by` 显式版本演进链。
- **FR-1.2 定时离线自动扫描与萃取（两小时静默规则）**：
  - **调度机制**：后台定时任务（或 CLI `exo scan`），定期轮询 OpenCode 与 Cursor 本地会话库。
  - **完成态判定标准**：会话最后更新时间距离当前超过 2 小时（`time_updated < now - 2h`），且会话此前未被萃取或标记跳过（`session_id NOT IN session_tracking`）。
  - **数据源适配**：
    - **OpenCode**：直接以 WAL 只读模式查询 `opencode.db`，结合 `opencode export --sanitize` 抽取时序对话；
    - **Cursor**：通过只读不锁机制（`?mode=ro&immutable=1`）读取 `state.vscdb`，穿透 `composerData` 与 `bubbleId` 恢复完整对话、思考过程与工具调用流。
  - **提炼驱动**：复用宿主环境已配置模型（借算力）对已结束会话进行单轮轻量归纳，高价值内容沉淀入库，无价值会话标记 `SKIPPED_NO_VALUE` 防死循环。
- **FR-1.3 用户自定义分类与动态模式扩展 (Custom Schema Extension)**：
  - 支持在项目或全局配置 `categories.json` 定义扩展分类及其必填字段、Markdown 渲染模板、校验规则；
  - 提炼引擎与 MCP 工具契约动态兼容自定义分类，实现知识体系的无缝演进。
- **FR-1.4 敏感信息清洗管道 (Secret Scrubbing)**：
  - 入库前自动匹配清洗常见云厂商 AK/SK、JWT、密码、私钥等，替换为 `***REDACTED***`。

### 2. 存储与分层引擎 (Storage & Indexing)
- **FR-2.1 单文件 SQLite 工业存储内核与事务保障**：
  - 核心存储收敛为单文件 SQLite (`~/.exobrain/exobrain.db`)，强制开启 `PRAGMA journal_mode = WAL;` 与 `PRAGMA busy_timeout = 5000;`，杜绝小文件 I/O 碎片与并发写撕裂。
- **FR-2.2 存读一体与物理字段分层（渐进式基础）**：
  - 知识条目分为轻量检索层（`id`, `project`, `category`, `title`, `summary`, `tags`, `related_files`）与深度实体层（`root_cause`, `solution_core`, `code_payload`）。
  - 检索阶段仅加载检索层字段，详情阶段按需拉取深度实体层。
- **FR-2.3 混合检索 (FTS5 Trigram + 向量) 与 RRF 排名融合**：
  - 第一路：SQLite FTS5 `trigram` tokenizer，保障代码类名、错误日志、文件路径的 100% 字符级精确命中；
  - 第二路：轻量本地向量检索，保障抽象语义意图与同义词泛化；
  - 结合倒数排名融合（RRF）与项目/分类元数据硬过滤，杜绝关键信息漏检。
- **FR-2.4 两级命名空间与工作区自动识别**：
  - 自动基于当前路径向上查找 Git 根目录或目录名生成项目 Slug；
  - 支持 `project` 命名空间隔离与 `global` 全局兜底。
- **FR-2.5 无损热备归档与多格式导出**：
  - 原生支持 `VACUUM INTO` 热备份，不中断读写即可生成紧凑的单文件冷备镜像；
  - 提供 `exo export --format markdown`，按需将 SQLite 数据无损导出为人类友好的 Markdown 目录树。

### 3. 消费与消费交互 (Consumption Interfaces)
- **FR-3.1 统一 MCP 工具契约 (`exo-mcp`)**：
  - `exo_record_knowledge`: 主动沉淀知识卡片（支持内置 learnings/decisions/solutions 及用户自定义分类，含去重与 supersede 版本替换）。
  - `exo_search_knowledge`: ⭐三层渐进披露第一层，返回 L3 索引行（id+标题+标签+相关文件，~50-100 token/条）。
  - `exo_get_knowledge`: 获取单张知识卡片完整正文（第二层 L2）。
  - `exo_list_recent`: 拉取最近沉淀或特定项目的知识。
  - `exo_map`: 按项目上下文与代码关联生成知识地图。
- **FR-3.2 ⭐ 统计与态势洞察 (`exo stats`)**：
  - 基于采集的 OpenCode / Cursor 会话元数据与沉淀知识，按时间段、项目汇总统计：
    - 研发投入轨迹（总会话数、活跃天数、Token 消耗、修改文件总数）；
    - 知识资产盘点（累计沉淀避坑条数、关键架构决策条数、技术配方条数）；
    - 历史盲区感知（频繁报错但未形成正解的未决会话预警）。
- **FR-3.3 知识地图动态注入（AGENTS.md 标准）**：
  - `exo map` 按当前 cwd 项目名 + git 最近提交关键词 + 代码关联实体实时选 Top-N 生成 AGENTS.md 知识地图节；
  - Token 预算 500 以内**代码级强制**（超限截断+提示 search 细查）；
  - 一份 AGENTS.md 通吃主流 Agent。
- **FR-3.4 开发者终端 CLI (`exo`)**：
  - `exo find "<query>"`：毫秒级终端搜索。
  - `exo list [--project <name>] [--category <type>]`：查看条目（支持项目与自定义分类过滤）。
  - `exo stats [--project <name>] [--since 7d]`：统计研发活动与知识资产。
  - `exo scan [--source opencode|cursor]`：手动或定时触发离线会话萃取。
  - `exo rebuild`：从 Markdown 目录全量自愈重建 SQLite 索引。
