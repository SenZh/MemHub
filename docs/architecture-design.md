# ExoBrain 完整架构设计与演进蓝图文档 (System Architecture & Roadmap)

> **版本**：v2.0 (Industry Benchmark Reset & Scope Contraction Edition)
> **状态**：Approved / Baseline Re-established
> **核心定位**：AI 编程与任务协作的实操锦囊（Pocket Playbook）——轻量、零外部依赖、不锁工具的项目级/全局级暗知识外脑
> **v2.0 变更摘要**：基于对 Mem0 v3、Zep/Graphiti、Letta/MemGPT、Basic Memory、mcp-memory-service、claude-mem、claude-code-memory 等业界方案的深度对标，完成三块（提取/存储/读取）逐项差距分析与架构重定向：收缩自研边界、确立"站在开源肩膀上只做差异层"路线、引入全局/项目两级记忆空间、确立 MCP + AGENTS.md 双开放标准集成通道。**明确承认"借宿主算力"模式的结构性天花板并划定其适用边界。**

---

## 1. 项目本质哲学与核心使命 (Core Philosophy)

### 1.1 什么是 ExoBrain？（重新定义外脑的灵魂）
ExoBrain **坚决不做**大而全的项目官方架构文档生成器，也**不做**代码仓库的变更日志（Changelog）管理器——那些本应由 Agent 在项目内部自行完成。

ExoBrain 的核心使命，是充当开发者与各类 AI Agent（OpenCode、Cursor、Claude Code、Codex 等任意工具）身后的**【实操经验随身锦囊、长效架构决策与工程暗知识蓄水池 (Engineering Playbook & Memory Vault)】**：
- **不求宏大完整，但求实用长效**；
- 专门收录那些**“不大不小、写进官方 Wiki 嫌太碎、不记下来下次遇到又得重新抓瞎”**的实操经验、野路子技巧、特殊参数配方与环境暗坑；
- **记录关键架构决策（ADR）与隐性业务规则**：记录“为什么放弃方案 B 选用方案 A”、“老系统为何存在此特异性逻辑”，避免后续迭代或切换 Agent 时引发重大倒退；
- **支持用户自定义分类扩展**：系统内置基础分类，同时允许开发者/项目方按特定业务需要自定义扩展知识类别与校验模式；
- **只记有复用价值的高密度知识，拒绝无脑记录工具流水账**；
- 让每一次在特定会话、特定工程中跑通的宝贵经验与决策，沉淀为不可丢失的原子资产。

### 1.2 与业界方案的灵魂区别（一句话版）

> **他们做的是“对话录音机与操作流水账”，存的是“刚才执行了什么命令”；我们做的是“工程决策与实操锦囊”，存的是“为什么这么做，以及下次遇到该怎么干”。**

| 维度 | 业界方案们 (claude-mem / memento / basic-memory / Supermemory) | ExoBrain |
|---|---|---|
| **提取算力** | 自建繁重提取管道：要配置专属 OpenAI Key / Neo4j / 专属云端服务，或纯手工记录 | **借宿主 Agent 会话算力提炼**（0 key、0 额外开销，直接复用当前已配置环境） |
| **知识定位** | 离散微观事实 / 工具调用 Observation（命令回显、读文件日志等大量噪声） | **工程长效知识**：排错根因正解（Learnings）+ 架构决策权衡（Decisions）+ 验证模板（Solutions）+ 自定义分类 |
| **分类扩展** | 硬编码固定类型，或单一无分类笔记 | **Schema 扩展框架**：内置 3 核心分类 + 项目级自定义扩展配置（`categories.json`） |
| **绑定方式** | 绑定特定 IDE 或私有协议 | **MCP + AGENTS.md 双开放标准**，OpenCode、Cursor、Claude Code 通吃 |
| **采集策略** | 仅依赖工具拦截（噪声极大）或纯手动（极易荒废） | **双轨制**：交互中主动 `/know` 直通 + **定时离线自动扫描（2小时无更新静默判定）** |

### 1.3 解决的四大核心痛点场景
1. **疑难排错与避坑资产复现（一次踩坑，全局免疫）**：
   - 调试通的特殊环境兼容性、底层依赖冲突，沉淀为“现象-根因-正解代码”，下次在任意会话遇到相同报错，Agent 秒级唤醒正解一次性搞定。
2. **架构决策与隐性规则防倒退（为什么这么做）**：
   - 记录编码前讨论确认的架构权衡（ADR）与业务潜规则。防止后续会话中 Agent 因缺乏背景“自作聪明”地将关键妥协代码重构成错误形式。
3. **工作轨迹与全局态势盘点（做过什么与资产统计）**：
   - 执行 `exo stats`，快速盘点最近在各个项目里攻克了哪些模块、消耗了多少 Token、留下了哪些核心资产。
4. **跨项目经验迁移与自定义沉淀（定制业务知识库）**：
   - 项目可通过扩展配置定义专用知识（如 `env_recipes`、`benchmark_tricks`），支持特定赛道或私有业务的高效复用。

---

## 2. 业界深度对标与自审 (Industry Benchmark & Self-Review)

> 本章为 v2.0 新增核心章节。调研对象（2026-09 时点）：**Mem0 v3**、**Zep/Graphiti**（arXiv 2501.13956 论文 + 仓库）、**Letta/MemGPT**、**Basic Memory**（basicmachines-co）、**mcp-memory-service**（doobidoo，含 issue #175 混合检索完整实现细节）、**claude-mem**（thedotmack，9.3k stars）、**claude-code-memory**（d2a8k3u）、**claude-code-auto-memory**、**AGENTS.md 标准**（Linux 基金会 AAIF，60k+ 项目采用）、**Claude Code hooks 官方规范**（PreCompact/SessionStart/Stop 等）。

### 2.1 竞争格局总览与客观分工

结合最新对标（覆盖 Mem0 v3、Zep/Graphiti、Basic Memory、mcp-memory-service、claude-mem、Aider repomap、Cline Memory Bank、腾讯 TencentDB-Agent-Memory / CodeGraph）：

| 方案 / 流派 | 核心定位与技术底座 | 擅长领域（不可否定的价值） | 边界与局限性（为什么无法替代工程外脑） |
|---|---|---|---|
| **腾讯开源 CodeGraph**<br>(TencentDB-Agent-Memory) | Tree-sitter AST 解析 + 嵌入式 SQLite + 拓扑遍历（复用 colbymchenry/codegraph） | **静态代码调用链与爆炸半径（Blast Radius）分析**，精准计算函数出入度与受影响模块 | 解决的是“代码怎么连、改动影响谁”，但无法记录代码背后的意图与历史决策 |
| **Aider (repomap)** | Tree-sitter + PageRank 算法计算核心符号拓扑密度 | **瞬时动态工作区大纲**，1k~2k Tokens 即可精准交代核心类和符号位置 | 瞬时只读投影，不负责跨会话的认知沉淀与排错经验留存 |
| **claude-mem** | Hook 拦截 Tool 调用 + 异步后台提炼 + 3-Layer 渐进披露 | **会话级操作轨迹审计与局部排错接力**，按需展开有效降低 Token 消耗 | 偏向操作流水账（行车记录仪），缺乏全局系统模型与架构决策（ADR）建模 |
| **Cline Memory Bank** | 规范化 Markdown 模板 + System Prompt 约束读写 | **最贴合软件工程生命周期的文档规范**，涵盖架构模式、技术背景与业务愿景 | 纯靠 Prompt 自律驱动，长会话极易遗忘更新，缺乏数据库级版本演进仲裁 |
| **Mem0 / Zep / Graphiti** | 对话事实抽取 + 语义向量 / 双时态知识图谱 | **通用伴侣/客服对话中的个人偏好与扁平陈述事实追踪** | 颗粒度错配，三元组无法表达微服务事务、并发锁、响应式流等强逻辑工程概念 |
| **ExoBrain** | **工程暗知识与长效决策随身外脑**<br>(单文件 SQLite 内核 + 存读一体分层 + 双轨萃取) | **专注工程暗知识因果链（现象-根因-正解代码）与架构权衡决策（ADR），零额外开销** | 不替代 Tree-sitter 静态代码分析，与代码拓扑互为齿轮协同运作 |

### 2.2 工业界双轮驱动模型：代码物理图谱 vs 工程经验记忆

严肃工业界（腾讯、微软等）的最新共识：**代码工程理解绝非单一银弹，必须由“物理世界”与“经验世界”两套齿轮协同咬合**：

1. **代码物理图谱（CodeGraph / Aider repomap）——回答“What & Where”**：
   - 依赖 AST 语法树和符号依赖分析，提供客观、确定性的调用拓扑；
   - 确保 Agent 不用全仓盲目 Grep，改动底层接口前清晰预警下游连带故障。
2. **工程经验外脑（ExoBrain）——回答“Why & How”**：
   - 依赖工程诊断因果链与架构决策记录，提供长效、演进式的经验认知；
   - 确保 Agent 不重复踩历史环境坑，理解“老系统为什么有这个看似冗余的防御性逻辑”。

**ExoBrain 的精准生态位**：坚决不重复造代码编译器和 AST 解析器的轮子，牢牢深耕代码 AST 无法体现的**【长效架构决策权衡 + 验证避坑正解 + 业务隐性潜规则】**。

### 2.2 逐方案需求满足度核对（对照我们需求硬性清单）

| 我们的需求 | Mem0 | Zep | Letta | mcp-memory-service | Basic Memory | claude-mem |
|---|---|---|---|---|---|---|
| 零外部模型/API key | ❌ 要 OpenAI | ❌ 要 LLM+图库 | ❌ 要 embedding | ✅ 本地 ONNX | ✅ | ❌ 自建 worker |
| Markdown 真理源/可 Git | ❌ 向量库 | ❌ 图库 | ❌ | ❌ SQLite 为主 | ✅✅ 最强 | ❌ |
| 跨工具通吃 | SDK 嵌入 | SDK 嵌入 | 要托管整个 agent | ✅ 25+ 工具 | ✅ MCP | ❌ 锁 Claude Code |
| 实操知识结构化模板（现象/根因/正解） | ❌ 平文本事实 | ❌ 实体图 | ❌ | ❌ 自由文本+tags | ⚠️ 有结构但通用 | ⚠️ observation 非领域化 |
| 自动提炼（免手动录入） | ✅ 但要 key | ✅ 但要 key | ✅ 但要接管 agent | ❌ 靠 agent 自觉 | ❌ 靠 agent 自觉 | ✅ 但锁 Claude Code |
| 凭据脱敏管道 | ⚠️ 文档建议 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 轻量（无 Python/无服务端） | ❌ | ❌ | ❌ | ❌ Python+模型下载 | ❌ Python | ❌ Bun+Chroma+uv |

**核对结论**：每一家都满足几条、缺几条，而"缺的那几条"恰好拼不出我们的完整需求。这是项目立项合理性的来源——但合理性只覆盖"提炼管道 + 领域模型"这一小块，**不覆盖存储引擎与检索实现**（v1.4 时期我们在这两块重复造了轮子）。

### 2.3 价值密度哲学（v2.0 确立，有业界共识背书）

**"只记有价值的，不什么都记"是被踩坑验证的方向，不是任性**：
- claude-mem / memento 走"全记录"路线（每次工具调用都存 observation），用户抱怨最多的恰恰是**记忆膨胀与噪声**；
- mcp-memory-service 后来被迫补建"遗忘机制"（衰减/压缩/归档）——全记录方案的宿命是亡羊补牢地造遗忘管道；
- Claude Code 官方 auto-memory 硬限 MEMORY.md 200 行、25KB，并建议"30 天没复现的条目删除"——连官方都在克制记录量。

**先想清楚记什么 > 先都记了再想着忘**。且"借宿主算力"恰好强化了这一点：**宿主 agent 在会话内拥有一手上下文（工具调用、代码理解、任务意图），它比任何会话外的二手提取管道都更清楚什么值得记**。

### 2.4 自审发现的实证缺陷（v1.4 → v2.0 必须修复）

| # | 缺陷 | 证据 | 严重级 |
|---|---|---|---|
| D1 | **无去重管道** | 本地库实证：SpringSecurity6 卡片重复存储两份（`kb-b0b96c16` / `kb-2538bd82`，同标题同标签） | P0 |
| D2 | **知识地图静态注入、双份人工维护** | `.cursor/rules/exobrain-map.mdc` 与 `.opencode/knowledge-map.xml` 需人肉同步，必然过时——恰是需求文档自己批判的"录入负担" | P0 |
| D3 | **检索天花板**：纯 FTS5 trigram 查 <3 字符失效；同义改写 miss（卡片写"动态库缺失"、搜"grpcio 报错"结果为 0） | 架构文档 v1.4 §6.1 自举的反例；mcp-memory-service issue #175 实测纯向量对精确匹配仅 60-70% 命中、混合后近 100% | P1 |
| D4 | **沉淀覆盖率靠人**：无 hooks 自动兜底，忘 `/know` = 流失 | claude-mem 全自动方案对比；Claude Code issue #17237 证实 PreCompact 是结构化数据被压缩毁掉前的最后抢救时机 | P1 |
| D5 | **无遗忘/衰减机制**：一年后老坑过时权重不降 | mcp-memory-service consolidation 对比 | P2 |
| D6 | **项目隔离只存在于 roadmap**：代码无 workspaces 层 | 用户核心诉求"项目 A 的记忆只在项目 A 用"，绝大多数业务知识不跨项目 | P0 |
| D7 | **文档与实现漂移**：v1.4 §6 因果图谱宣称"已落地"实为零代码；§8 声称模块在 `src/core/` 实际平铺于 `src/` | grep 验证零痕迹 | P0（诚实性） |

### 2.5 对标后的战略裁决

**三条路线曾摆上桌面**：
- 路线 A（放弃自研，改用 mcp-memory-service / Basic Memory）：接受 Python 环境、放弃 Markdown 真理源或检索能力二选一、丢失领域模板——**否决**，因为用户核心诉求（价值密度 + 两级隔离 + 借宿主算力）无法全部满足；
- 路线 B（收缩边界，站在开源肩膀上只做差异层）：**采纳**；
- 路线 C（维持 v1.4 全自研）：在检索/注入/遗忘上重复造别人造得更好的轮子，而真正的差异部分反而停留在纸面——**否决**。

**路线 B 的分工边界**（哪些用开源验证过的方案、哪些自研）：

| 层 | 决策 | 依据 |
|---|---|---|
| 存储格式 | **采用 Basic Memory 已验证的 Entity/Observation/Relation + wikilinks 语法** | Obsidian 图谱白嫖、格式零设计成本、与"SQLite 索引可重建"自愈原则同构 |
| 混合检索 | **抄 mcp-memory-service 方案**（FTS5 trigram + 可选本地向量，0.3/0.7 加权融合） | issue #175 公开了完整实现、归一化公式、CJK 踩坑细节 |
| 被动注入 | **走 AGENTS.md 开放标准**（Linux 基金会 AAIF，60k+ 项目，25+ agent 原生读取） | 取代双份人工维护的注入文件 |
| 借宿主算力的提炼管道（`/know` + hooks 探测） | **自研**（全行业空白） | 我们的核心差异 |
| 现象/根因/正解领域 schema + 三分类 | **自研**（全行业空白） | 我们的核心差异 |
| 凭据脱敏管道 | **自研**（业界普遍缺失） | 我们的核心差异 |

---

## 3. 系统分层架构 (Layered Architecture, v2.0 修订)

v1.4 的四层解耦保留，但**各层职责重新划定**（修订处以 ⭐ 标注）：

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 4: 接口协议与呈现层 (Interfaces)                                   │
│  - Stdio MCP Server (exo_record/search/get/list/map) ⭐新增 map         │
│  - 开发者终端 CLI (exo find/get/list/scan/rebuild/map) ⭐新增 map        │
│  - AGENTS.md 动态知识地图生成器 ⭐取代 .mdc/.xml 双份静态注入            │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 3: 提炼与调度管道层 (Pipeline & Consolidation)                    │
│  - KnowledgeExtractor: 领域启发式提炼 (保留)                            │
│  - ScannerService: 离线会话调度器与状态机 (保留)                        │
│  - DedupPipeline ⭐新增: 标题哈希精确去重 + FTS5 前置查重               │
│  - HooksProbe ⭐新增: 能力探测式自动提取 (检测到 hooks 则挂, 否则降级)   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 2: 数据源适配器层 (Data Source Adapters) ⭐职责收缩               │
│  - AgentAdapter 抽象基类 (保留, 但定位变更: 只做离线扫描的数据源)        │
│  - OpenCodeAdapter / CursorAdapter (保留)                              │
│  - 集成通道收敛: MCP + AGENTS.md 双开放标准 (不再为每个 agent 写适配器)  │
└────────────────────────────────────┬────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1: 基础设施与存储层 (Core & Infrastructure)                       │
│  - StorageEngine: Markdown 真理源 (Basic Memory 语法) + SQLite FTS5     │
│  - ⭐可选本地向量层: ONNX 运行时 (384 维 MiniLM 级, CPU 毫秒级, 0 key)  │
│  - ⭐两级空间: 全局层 + 项目层 (workspaces/<project>/)                  │
│  - Scrubber: 敏感凭据脱敏管道 (保留)                                    │
│  - Config: 跨平台路径解析 (~/.exobrain/)                                │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键架构变更说明**：

1. **⭐ Layer 2 重新定位**：从"宿主适配器层"收缩为"数据源适配器层"。它的职责只剩离线扫描兜底（读 opencode.db、读 state.vscdb），**不再是集成通道**。集成通道统一收敛到 MCP（读写能力，所有主流 agent 原生支持）+ AGENTS.md（被动注入，25+ agent 原生读取，Claude Code 用 `CLAUDE.md` 首行 `@AGENTS.md` 一行桥接）。"支持新 agent"的成本从"写一个 Adapter"降为"零成本或写一个生成模板"。

2. **⭐ 双开放标准集成通道**：

```text
                 ┌─ 通道 A: MCP 协议（读写能力）────────────────┐
                 │ Claude Code / Cursor / Codex / OpenCode /    │
                 │ Windsurf / 任意新 agent —— 全部原生支持       │
                 │                                              │
任何 Agent ──────┤                                              │
                 │                                              │
                 └─ 通道 B: AGENTS.md（被动注入）────────────────┘
                 │ Linux 基金会 AAIF 开放标准, 25+ agent 原生读取 │
                 │ Claude Code 用 CLAUDE.md 首行 @AGENTS.md 桥接 │
                 └──────────────────────────────────────────────┘

  可选增强（有则用、无则降级, 绝不依赖）：
  Claude Code hooks / OpenCode events → 自动提取 + SessionStart 动态注入
```

3. **⭐ 自研收缩承诺**：自研部分从 v1.4 的"全栈"收缩为三件全行业空白：借宿主算力的提炼管道、领域 schema、脱敏管道。**预计代码量约为 v1.4 设想的三分之一**。

---

## 4. 双轨知识获取运行机制 (v2.0 修订)

### 4.1 主动直通机制（核心主路径，保留并强化）
- **触发入口**：用户在任何支持 MCP 的 Agent 中输入 `/know`、`/save` 或说"记录一下刚才跑通的参数/踩坑"。
- **模型推理**：宿主 Agent 基于当前受热的完整会话上下文，提炼出 25 字标准标题与结构化卡片参数。宿主 agent 拥有一手上下文（工具调用、代码理解、任务意图），比任何会话外二手提取管道更清楚什么值得记——这是"借宿主算力"模式的质量优势来源。
- **⭐ 去重管道（D1 修复）**：MCP Server 落库前强制执行：
  1. 标题+分类哈希精确去重；
  2. FTS5 前置查重（近同义命中则返回已有卡片 ID，提示 agent 走版本更新而非重复插入）；
  3. 冲突路径：新卡片入库时同实体+同问题域检测，命中则旧卡片自动写入 `superseded_by` 关闭版本窗口，检索默认只召回"当前有效"版本（简化版 Graphiti bi-temporal 模型）。
- **安全脱敏管道 (Secret Scrubbing)**：强制经过正则脱敏器（清洗常见 AK/SK、JWT、Bearer Token、私钥、密码），替换为 `***REDACTED***`。
- **协议入库**：原子方式落盘 Markdown 并写入 SQLite FTS5 索引，返回 `{ success: true, id: "kb-xxxx" }`，耗时 <10ms，坚决不读 IDE 本地数据库。

### 4.2 双轨知识获取运行机制 (v2.0 修订)

#### 1. 主动直通机制（高价值即时落盘，核心主路径）
- **触发入口**：用户在任何支持 MCP 的 Agent（OpenCode、Cursor、Claude Code）中输入 `/know`、`/save` 或说“记录刚才的架构决策/排错经验”。
- **模型推理**：宿主 Agent 基于当前受热的完整会话上下文，提炼出符合 Schema（内置三元组或用户自定义分类）的标准结构。
- **⭐ 去重与版本演进管道**：
  1. 标题哈希精确去重与 FTS5 前置查重；
  2. 显式版本废弃（`supersedes`）：新决策入库时可指定替代旧卡片 ID，旧卡片自动写入 `superseded_by` 并关闭版本窗口，检索默认只召回有效版本。
- **协议入库**：原子落盘 Markdown 并更新 SQLite FTS5 索引，耗时 <10ms。

#### 2. 定时离线自动扫描与萃取机制（两小时无更新规则）
- **核心判定哲学**：开发者在沉浸式解决问题时，极易忘记手动输入 `/know`。系统提供后台扫描守护器（可通过系统定时任务或 CLI `exo scan` 驱动）。
- **完成态判定准则**：
  - 会话必须为根任务（排除派生/子任务递归）；
  - 会话最后活跃更新时间已超过 2 小时（`time_updated < now - 2h`），此时断定开发者已结束本次工作或切换了任务；
  - 过滤已处理会话（`session_id NOT IN session_tracking`）。
- **针对 OpenCode 的离线抽取实现**：
  - 直接以 WAL 只读协议安全查询 `opencode.db`；
  - 调用 `opencode export <session_id> --sanitize` 抽取时序消息与工具调用；
  - 复用宿主环境当前配置的模型进行单轮轻量归纳提炼。
- **针对 Cursor 的离线抽取实现**：
  - 以只读且不加锁协议（`?mode=ro&immutable=1`）连接 `%APPDATA%\Cursor\User\globalStorage\state.vscdb`；
  - 穿透 `composer.composerHeaders` 找到目标工程的会话索引；
  - 按照 `composerData` 中的 `bubbleId` 列表，读取 `cursorDiskKV` 还原包含 User Prompt、Reasoning（思考过程）、Assistant 响应与工具调用的完整轨迹；
  - 提交给宿主模型提炼。
- **状态机与防死循环防御**：
  - 在 `session_tracking` 表中严格记录 `session_id`, `source`, `status` (`EXTRACTED` / `SKIPPED_NO_VALUE` / `FAILED`), `time_processed`；
  - 凡是无代码修改、纯闲聊会话，前置规则直接打标 `SKIPPED_NO_VALUE`，坚决不浪费模型算力。

---

## 5. 知识分类与自定义扩展架构 (Custom Schema Extension)

系统内置三大核心工程知识分类，同时提供**项目级与全局级的分类扩展框架**，以支持不同技术团队沉淀特定领域的长效认知：

### 5.1 内置三大基石分类规范 (v0.2.0 收敛架构)

1. **`learnings`（排错与避坑指南 - 面向过去）**：
   - 核心使命：现实偏离理论预期的故障与暗坑，止血并防复发。
   - 专属要素：【业务操作背景】、【异常表象与错误签名】、【底层技术因果 (5-Whys)】、【真实正解代码】、【已排除误区清单】、【验证防复发门禁】。
2. **`decisions`（架构决策与设计权衡 / ADR - 立足当下）**：
   - 核心使命：技术选型、重大重构与契约约束，防止后人盲目重构踩雷。
   - 专属要素：【痛点背景与驱动】、【受影响拓扑面】、【备选方案与放弃理由 (Why Not X?)】、【最终裁决与妥协代价】、【平滑迁移与回滚】、【架构硬红线】。
3. **`patterns`（最佳实践与范式模板 - 面向未来）**：
   - 核心使命：经过实战验证的生产级标准代码骨架与脚手架，提升工程一致性。
   - 专属要素：【适用场景与痛点】、【前置环境依赖树】、【核心时序与机制】、【生产级完整参考代码】、【适用边界与反模式】、【自测验证用例】。

### 5.2 自定义分类扩展机制 (Custom Schema)

用户可在项目根目录 `.exobrain/categories.json` 或全局 `~/.exobrain/categories.json` 中扩展自定义知识类型。例如增加“业务隐性规则”与“赛事优化配方”：

```json
{
  "version": "1.0",
  "categories": {
    "business_rules": {
      "name": "业务隐性规则",
      "description": "老系统兼容逻辑、特定错误码降级约定、非直观的业务潜规则",
      "fields": [
        { "name": "rule_key", "type": "string", "required": true, "description": "规则标识或错误码" },
        { "name": "business_context", "type": "string", "required": true, "description": "为什么存在该规则（历史包袱或业务背景）" },
        { "name": "constraint_logic", "type": "string", "required": true, "description": "具体必须遵守的代码约束逻辑" }
      ],
      "template": "## 规则背景\n{{business_context}}\n\n## 约束与降级逻辑\n{{constraint_logic}}"
    },
    "env_recipes": {
      "name": "特殊环境与调优配方",
      "description": "跨机环境配置、特定显卡/依赖底层编译参数、评测调优 Tricks",
      "fields": [
        { "name": "target_env", "type": "string", "required": true, "description": "操作系统/GPU/硬件架构" },
        { "name": "recipe_commands", "type": "string", "required": true, "description": "可执行的配置命令或参数组合" }
      ],
      "template": "## 目标环境\n{{target_env}}\n\n## 经过跑通的完整配置步骤\n{{recipe_commands}}"
    }
  }
}
```

- **运行时自适应**：
  - MCP 工具 `exo_record_knowledge` 的入参动态兼容所有在 `categories.json` 中声明的合法 `category`；
  - 存储层自动在 Markdown 文件中按指定模板渲染，并在 SQLite 中建立分类索引；
  - CLI `exo list --category <type>` 和检索接口自动支持按自定义分类多维筛选。

### 4.3 ⭐ hooks 能力探测式自动提取（新增，可选增强层）
- **设计原则：有则用、无则降级，绝不构成依赖**。因为 Cursor、Codex 等没有等价 hooks 机制，这保证了跨工具通用性底线。
- 检测到 Claude Code 环境 → 挂载 `Stop`（turn 结束触发提炼建议）、`SessionEnd`、`PreCompact`（上下文压缩毁掉结构化数据前的最后抢救时机，Claude Code issue #17237 证实该痛点）。
- 检测到 OpenCode events → 挂载等价事件。
- 检测不到任何 hooks → 降级为现状（`/know` 手动 + 离线扫描兜底），功能完整可用。
- hooks 触发的提炼依然是**借宿主算力**：hook 只做信号收集与触发，不做本地推理。

### 4.4 ⭐ 沉淀漏斗分级（新增设计）
- 不是所有内容都值得 300-800 字 L2 卡片。引入轻量 observation 层（claude-mem 模式）：低价值信号只留一行索引，会话结束再由 agent 判断是否升级为完整卡片——"广撒网、深提炼"。
- 升级判断由宿主 agent 执行（`/know` 或 hooks Stop 事件），维持哑 server 原则。

---

## 5. 存储模型、归档流水线与渐进式契约 (Storage, Archive & Disclosure Design)

### 5.1 存储选型裁决：为什么摒弃散落 Markdown，确立单文件 SQLite 内核？

业界工业级实践（`claude-mem`、`memento-mcp`、`mcp-memory-service`）表明：
- **散碎 Markdown 文件的工程缺陷**：当记忆卡片积累至数百上千条时，多文件 I/O 极其低效；多个 Agent 或并发任务写入时极易发生文本写撕裂；全文检索必须依赖外部工具或临时建立内存缓存，带来一致性维护成本。
- **单文件 SQLite 核心的压倒性优势**：
  1. **严格的 ACID 事务一致性**：WAL 模式下并发读写绝不锁库，写入毫秒级确认；
  2. **多维倒排一体化**：元数据字段、FTS5 全文倒排虚拟表、向量字段集中存储在单个物理文件中；
  3. **零环境门槛**：纯本地单文件，免除外部数据库或服务守护开销。

> **人类可读性解决方案（按需导出）**：
> SQLite 充当运行期的高性能核心真理源；通过 `exo export --format markdown`，随时可将数据库导出为格式优雅的 Obsidian / Git 风格的 Markdown 树。

---

### 5.2 核心物理表结构与存读一体设计

```sql
-- 1. 核心知识条目表（存读一体、物理分层设计）
CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,               -- 唯一标识: 'kb-c3ffcbe1'
    project TEXT NOT NULL,            -- 命名空间: 'global' 或工程 slug ('my-backend')
    category TEXT NOT NULL,           -- 内置: 'learnings', 'decisions', 'solutions', 或自定义分类
    
    -- 【L1：第一步检索层数据，极低 Token 消耗】
    title TEXT NOT NULL,              -- 规范化高密度标题: [技术栈/模块] 核心场景 最终正解
    summary TEXT NOT NULL,            -- 100字以内现象与根因极简摘要
    tags TEXT NOT NULL,               -- JSON 数组: ["docker", "alpine", "glibc"]
    related_files TEXT,               -- JSON 数组: ["Dockerfile", "package.json"]
    topic_fingerprint TEXT,           -- 同 session+分类+主题的覆盖定位键：title/tags 归一化实体哈希前缀
    
    -- 【L2/L3：第二步按需展开详情层数据，大文本】
    root_cause TEXT,                  -- 深入技术根因深度剖析
    solution_core TEXT NOT NULL,      -- 核心改动原则与思路
    code_payload TEXT,                -- 完整可运行代码块、配置文本、补丁
    
    -- 元数据与演进关系
    session_id TEXT,                  -- 溯源 Session ID
    superseded_by TEXT,               -- 若被新版本取代，记录新卡片 ID
    supersedes TEXT,                  -- 替代了哪条历史卡片
    access_count INTEGER DEFAULT 0,   -- 访问与命中频次
    time_created INTEGER NOT NULL,
    time_updated INTEGER NOT NULL
);

-- 2. 全文检索倒排虚拟表 (FTS5 Trigram Tokenizer)
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    id UNINDEXED,
    title,
    tags,
    summary,
    solution_core,
    tokenize='trigram'
);

-- 3. 离线会话扫描状态机（防止死循环与重复扫描；schema 由 storage 单一权威维护）
CREATE TABLE IF NOT EXISTS session_tracking (
    session_id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'opencode', -- 'opencode' | 'cursor'
    source_agent TEXT,
    project TEXT NOT NULL DEFAULT '',
    project_path TEXT,
    session_title TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',  -- 'EXTRACTED' | 'SKIPPED' | 'FAILED' | 'EXTRACTING' | 'PENDING'
    extracted_kb_ids TEXT,                   -- 提取出的卡片 ID 列表 (JSON)
    card_id TEXT,                            -- 单卡或多卡 ID 数组(JSON)
    attempts INTEGER DEFAULT 0,
    locked_until INTEGER DEFAULT 0,
    last_error TEXT,
    time_processed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
);
```
> ⚠️ 同一表曾因两处 `CREATE TABLE IF NOT EXISTS` 以不同列定义而冲突（scanner 报 `no column named source_agent`）。
> 现已收敛：**权威 schema 仅由 `src/storage.js` 维护**，scanner-service 复用；老库靠 `runMigrations` 幂等 `ADD COLUMN` 补齐。

---

### 5.3 归档存储机制：无损热备份与极高压缩比冷存储

针对开发者对“电脑本地运行一段时间后进行冷备归档”的核心需求：
1. **在线热备（`VACUUM INTO` 零停机备份）**：
   SQLite 原生支持热备份命令。即使当前正在进行高频读写，系统依然可以瞬时生成一份数据紧凑、WAL 缓存已完全合流的独立只读镜像：
   ```sql
   VACUUM INTO '/backups/exobrain_archive_20260905.db';
   ```
2. **高效压缩与随手迁移**：
   SQLite 格式的数据页具备极高压缩比。结合 `zstd` / `gzip` 压缩，归档文件体积通常缩减 80% 以上。开发者可直接单文件打包同步至企业网盘、私有对象存储或冷备目录。

---

### 5.4 渐进式披露（Progressive Disclosure）两阶段交互流

彻底避免传统 RAG 一次性返回数千字代码导致 Context Window 爆炸与模型“Attention Lost in the Middle”：

```
                Agent 发起排错/决策检索
                           │
                           ▼
  [第一步：检索 L1 索引] exo_search_knowledge(query="...")
                           │
                           ▼
  返回极简 JSON（单条约 30~50 Tokens）：
  - id, title, summary, tags, related_files
  - 伴随显式 instruction 指导：“如需完整代码请根据 ID 调用 exo_get_knowledge”
                           │
                           ▼ Agent 判断某条索引高度吻合当前上下文
  [第二步：展开 L2/L3 详文] exo_get_knowledge(ids=["kb-c3ffcbe1"])
                           │
                           ▼
  返回完整资产（约 500 Tokens）：
  - root_cause 深度根因
  - code_payload 完整可运行代码与配置
```

---

### 5.5 混合检索与倒数排名融合 (RRF) 架构

为了保证**“抽象问题不漏检（靠语义），具体报错不失真（靠精确实体）”**：
1. **第一路（精确匹配）**：SQLite FTS5 `trigram` tokenizer，对代码类名、错误码、文件名、动态库路径具备 100% 字符级穿透力；
2. **第二路（意图泛化）**：轻量本地向量嵌入（MiniLM / 384维），召回自然语言场景与同义意图；
3. **倒数排名融合 (RRF 算法)**：
   $$Score(d) = \sum_{m \in \{fts, vec\}} \frac{1}{60 + Rank_m(d)}$$
   根据两路召回名次自动结算综合得分，并在项目命名空间内硬过滤，杜绝关键信息漏检。

---

## 6. 消费与读取设计 (Consumption, v2.0 修订)

### 6.1 MCP 协议与大模型自主认知契约 (LLM Cognitive Contract)

MemHub 对外通过标准 MCP 协议提供 4 大核心工具。为了让大模型在接入 MCP 时能够自主理解**“何时用、怎么两阶段防爆 Token、什么时候该沉淀”**，工具描述与 Schema 强力注入了认知指引：

| 工具命令 (Tool Name) | 大模型认知定位 (LLM Cognitive Role) | 行为契约与自解释机制 |
|:---|:---|:---|
| **`memhub_search`** | **两阶段渐进式检索 - 阶段一**<br>(Token 防爆探测器) | **在动手写代码、设计方案或排查报错前必须先调用**。<br>• 仅返回 25-45 字强指纹摘要（~30-50 Tokens），绝不直接吐出大段代码；<br>• 返回结果附带显式 `instruction` 引导大模型必须在当前上下文先做裁判，确认吻合后再调用阶段二；<br>• 支持 `query`、`project`（工作区私有+global穿透）、`tags`（多标签AND交集）和 `category` 过滤。 |
| **`memhub_get`** | **两阶段渐进式检索 - 阶段二**<br>(确定性正解注入器) | **当大模型在阶段一确认某条摘要高度吻合当前问题时调用**。<br>• 按三大分类专属模板展开高清 Markdown：<br>  - `learnings`: 呈现业务背景、错误签名、根因、修复代码、已排除误区与防复发门禁；<br>  - `decisions`: 呈现痛点背景、受影响拓扑面、备选放弃理由、裁决代价与架构红线；<br>  - `patterns`: 呈现适用场景、前置依赖树、核心机制、生产代码骨架与反模式；<br>• 支持单 ID 或数组多 ID 批量拉取。 |
| **`memhub_save`** | **主动长效知识沉淀**<br>(工程认知持久化中枢) | **当攻克复杂报错、敲定重大架构决策、或写出标准代码模板时调用**。<br>• 强制要求输入 `context`（业务操作背景）与 `solution`（验证正解）；<br>• 严格枚举校验三大顶级分类 (`learnings`, `decisions`, `patterns`)；<br>• 内置标题哈希查重与 `supersedes` 显式版本演进替换，严禁记录未经验证的猜测。 |
| **`memhub_recent`** | **最近记忆轨迹与破冰**<br>(项目态势速览) | **在新会话启动、接手新模块时调用**。<br>• 倒序列出最近沉淀的资产，支持按 `project`（自动穿透 global）和 `tags` 快速建立项目上下文。 |

*(注：系统底层同时自动注册了 `hub_*` 与 `exo_*` 兼容别名，完全向下兼容历史工具调用)*

### 6.2 统计与全局态势洞察 (`exo stats`)

基于扫描并解析的 OpenCode (`opencode.db`) 与 Cursor (`state.vscdb`) 历史会话数据，提供开发者与团队级的宏观态势统计：
- **工程投入分析**：各项目过去一段时间内的会话总数、改动涉及的核心文件清单、Token 消耗统计；
- **知识资产大盘**：累计沉淀的排错经验、架构决策（ADR）、可复用脚手架与自定义分类条目数分布；
- **排错未决预警**：检测历史会话中多次出现报错重试、但未成功沉淀有效正解的遗留技术痛点。

### 6.2 ⭐ 注入预算硬上限
- 知识地图 Token 预算锁定 500 以内，**代码级强制**（按字符预算裁剪，超限截断并提示用 search 细查）——v1.4 只写在文档里，v2.0 要求实现为断言。

### 6.3 ⭐ 知识地图动态生成（D2 修复，取代静态双份注入）

- **`exo map` 命令**：按当前 cwd 的项目名 + git 最近提交关键词，从两级库实时选 Top-N 生成注入内容，写入项目根 `AGENTS.md` 的知识地图节；
- **一份文件通吃所有工具**：Codex / Cursor / Devin / Copilot / Amp / Gemini CLI 等 25+ agent 原生读取 AGENTS.md；Claude Code 用 `CLAUDE.md` 首行 `@AGENTS.md` 一行桥接（官方文档指引的标准做法）；
- 取代 v1.4 的 `.cursor/rules/exobrain-map.mdc` + `.opencode/knowledge-map.xml` 双份人工维护——从"录入负担"变为"一条命令再生成"；
- 生成时机：`/know` 沉淀后自动刷新 + 用户手动 `exo map`。

---

## 7. "借宿主算力"模式的结构性天花板（v2.0 诚实声明）

> 这是 v2.0 最重要的自我认知，写进文档防止未来误判方向。

**结构性约束**：凡是需要 server 端智能的功能——自动去重判断、语义冲突消解、衰减打分、图谱三元组抽取质量——哑 server 自己都做不了，只有两条路：
1. 塞进 agent 端 prompt → prompt 膨胀、行为不可控、各 agent 表现不一致；
2. 自己接模型 → 违背立项原则。

Mem0 式自带管道的方案没有这个矛盾。**这是模式的先天约束，不是工程能修的。**

**但这个天花板恰好罩在"低频高价值写入 + 简单可靠检索"场景上方**——即实操锦囊定位——所以是自洽的。我们主动放弃的能力清单（并接受其代价）：
- 自动冲突消解 → 接受"agent 判断 + superseded_by 半自动"的降级方案；
- 智能遗忘 → 接受 P2 阶段做基于命中次数的时间衰减（纯规则，非智能）；
- 全自动无感沉淀 → 接受"hooks 探测式增强 + 人主动 `/know`"的组合。

**换来的**：零 key 零成本零运维、生态中立（不锁任何工具）、提取质量一手上下文、Markdown 所有权。

**清醒条款**：如果未来需要"自动冲突消解、智能遗忘、图谱自动抽取"这类管道智能，就是该换模式或接管道的时候——届时优先评估 Basic Memory（同模式最成熟）与 mcp-memory-service（混合检索最成熟）作为底层，ExoBrain 收缩为一个领域模板层。

---

## 8. 后期展望与演进路线图 (Roadmap)

### 8.1 P0（立即执行，成本最低收益最大）
1. **去重管道**：标题哈希精确去重 + FTS5 前置查重 + `superseded_by` 版本链（§4.1）；
2. **两级记忆空间落地**：workspaces/ 目录结构 + 检索合并序（§5.1）；
3. **`exo map` 动态知识地图（输出 AGENTS.md）**：取代静态双份注入（§6.3）。

### 8.2 P1（补齐业界基线差距）
1. **本地 ONNX 混合检索**：vec0 表 + 双路并行 + 0.3/0.7 融合（§5.3）；
2. **hooks 能力探测式自动提取**：Claude Code/OpenCode 检测挂载，无则降级（§4.3）；
3. **检索三层渐进披露**：`exo_search_knowledge` 返回结构改造（§6.1）。

### 8.3 P2（锦上添花，Obsidian 生态红利）
1. **Basic Memory 式卡片语法 + 图谱自动派生**（§5.2）；
2. **supersede 半自动化增强**：同实体+同问题域检测；
3. **基于命中次数的规则衰减**（非智能遗忘）；
4. **Git-Backed Vault Sync**：`~/.exobrain/vault/` 作为本地 Git 仓库，`exo sync` 自动 pull --rebase / push（借鉴 spolom/memory-mcp）；
5. **工作轨迹盘点**：`exo export --project <name> --format table|csv`。

---

## 9. 当前工程交付资产与质量基线（诚实修正）

**v2.0 起文档与实现严格对齐，以下为截至 v2.0 评审时点的真实状态**：

已落地（`npm test` 4 层测试全绿验证）：
- `src/storage.js`：SQLite FTS5 (trigram) + WAL + Markdown 双写 + `superseded_by` 字段（仅 schema，链路未启用）；
- `src/scrubber.js`：脱敏管道（AK/SK、JWT、连接串实测通过）；
- `src/adapters/`：OpenCodeAdapter（实战验证）+ CursorAdapter（插槽）+ AdapterRegistry；
- `src/pipeline/`：KnowledgeExtractor 领域启发式 + ScannerService 状态机（session_tracking 表已落地）；
- `src/index.js` + `src/cli.js`：MCP Server（4 工具）+ CLI（find/get/list/scan/rebuild）。

**尚未落地（v1.4 曾误述为已完成）**：
- 因果知识图谱（graph_entities/graph_relations 表、递归 CTE 遍历、`[[双链]]` 解析）——零代码，v2.0 将其归入 P2 并改用 Basic Memory 语法派生路线（§5.2）；
- 模块路径：实际平铺于 `src/` 根目录（storage/config/scrubber 等），非 v1.4 所述的 `src/core/`。

**v2.0 新增承诺待落地项**：见 §8.1-8.3 路线图，P0 三项为下一迭代验收标准。
