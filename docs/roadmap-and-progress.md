# MemHub 目标差距分析与工程演进计划书 (Roadmap & Progress)

> **版本定位**：v0.1.2 常驻定时守护与宿主驱动提炼交付版（Daemon & Host-Driven Release）  
> **项目定位**：面向 AI Coding Agent 的工程长效记忆与暗知识调度中枢（Unified Memory & Knowledge Hub）  
> **更新基准**：2026-09-08

---

## 一、 核心设计目标与全量现状盘点 (Executive Summary)

对照项目的最终设计愿景（`requirements-and-boundaries.md` 与 `architecture-design.md`），我们对当前已落地工程资产进行了**地毯式核对与差距分析（Gap Analysis）**：

| 架构分层 / 功能模块 | 设计终态目标 (Vision) | 当前实现状态 (Status) | 达成度 |
| :--- | :--- | :--- | :---: |
| **1. 存储内核与事务安全** | 单文件 SQLite 物理分层 + DDL自愈热迁移 + VACUUM INTO 热备 + Markdown 导出 | 已完整实现（`src/storage.js`），支持物理列扩展、老库 DDL 自愈、查重防线与冷备 | **100%** |
| **2. 极简动宾 MCP 协议** | `memhub_*` 极简动宾契约（memhub_search/get/save/recent）两阶段渐进披露 | 已完整实现（`src/index.js`），两阶段防爆 Token，且完全向下兼容老别名 | **100%** |
| **3. 四大基石分类与结构要素** | 收敛为四大正交顶级分类（learnings/decisions/patterns/business），各具备专属要素结构 | 已完整实现（`src/config.js`、`src/storage.js`），彻底补全业务背景与排错误区 | **100%** |
| **4. 存储层 Upsert 原地覆盖与多卡** | 同 session 同主题多次抽取原地 UPDATE 覆盖，不同主题/分类沉淀为多张卡 | 已完整实现（`src/storage.js`），引入 `topic_fingerprint` 列与权威 `session_tracking` | **100%** |
| **5. 过滤引擎与配置体系** | 动态静默时间阈值 + watchDirectories / include / exclude 路径正则规则 | 已完整实现（`src/path-filter.js`、`src/config.js`），防时序踩踏与特殊字符转义 | **100%** |
| **6. 后台常驻定时提炼守护 (P0)** | `memhub daemon` 常驻自循环，通过 OpenCode HTTP 驱动宿主 LLM 抽取 | 已完整打透（`src/daemon.js`、`src/host/opencode-client.js`）：动态端口与鉴权发现 + 7天窗口/120分钟静默防重 + 沉淀指令注入(不 fork) + 无价值坚决不沉淀 | **100%** |
| **7. 废除离线启发式造假 (P0)** | 彻底清除硬编码关键词捏造假卡，只允许真实 LLM 分析沉淀高质量资产 | 已彻底重构（`src/pipeline/extractor.js`）：废除死模板，保留 Truth Gate 物理成功证据门禁与 LLM 结果解析 | **100%** |
| **8. 混合检索与向量融合层 (P1)** | SQLite FTS5 Trigram + 本地 384 维稠密向量 + RRF 倒数排名融合 | 已完整实现（`src/search/vector-engine.js`、`src/search/rrf.js`、`src/storage.js`）：双路并行召回 + 60 平滑因子 RRF 融合 + 词汇鸿沟语义泛化 + LIKE 优雅兜底 | **100%** |
| **9. 离线做梦与记忆熔炼 (P1 - 顶层热点)** | 闲时做梦机制（Dreaming）：碎片聚合、矛盾雷达、增量吸收、防重状态机与 L4 升华层 | 顶层架构设计已完成落盘（`docs/dreaming-architecture-design.md`），计划于 **v0.2.0** 核心落地 | **20% (设计已定稿)** |
| **10. 认知读协议与触发规约增强 (P0)** | 强化 MCP 工具描述与读协议诱导，解决 LLM 不知何时读、怎么读、能做什么 | 技术设计定稿（`docs/read-protocol-and-stats-design.md`），正在落地推进 | **30%** |
| **11. 研发态势与项目资产大盘 (P1)** | `memhub stats` 全局/项目研发态势与按 Project 维度分类资产大盘总结 | 已完整实现（`src/storage.js`、`src/cli.js`），支持 ASCII 可视化与 `--json` 输出 | **100%** |
| **12. 动态知识地图注入 (P2)** | `memhub map` 自动生成当前项目 `<500 tokens` 的 `AGENTS.md` 知识地图节 | 评估识别痛点（开局任务未知），调整优先级至 v0.2.x 探索 | **0%** |
| **13. Cursor 深度穿透 (P2)** | 穿透 `%APPDATA%/Cursor/.../state.vscdb` 读取 `composerData` 时序流 | 接口骨架与插槽已就绪（`src/adapters/cursor.js`），底层解析逻辑暂未填入（按既定策略延后） | **20%** |

---

## 二、 当前已完整实现的内容清单 (Done in v0.1.2)

截至当前版本，系统已形成**端到端闭环的工业级基础核心**，全部 7 大测试套件与宿主客户端单测 100% 绿灯：

### 1. 单文件 SQLite 物理分层存储引擎 (`src/storage.js`)
- **存读一体分层**：
  - **L1 检索层**：`title`, `category`, `project`, `tags`, `summary`, `related_files`（单条仅消耗 30~50 tokens）；
  - **L2/L3 实体层**：`context_text`, `root_cause`, `solution_core`, `code_payload`, `extra_payload`（按需展开大文本）；
- **DDL 热迁移自愈与存量兼容**：内置 `runMigrations` 钩子，老库自愈补齐新列（含 `topic_fingerprint`、`session_tracking` 单一权威定义），并自动幂等刷写存量历史分类；
- **原地 UPDATE 覆盖 (Upsert)**：
  - 支持 `recordKnowledge({ mode: 'upsert', ... })`；
  - 覆盖定位键为 `session_id + category + topic_fingerprint`（标题漂移兜底），原地更新已有记录，彻底解决多轮抽取导致的卡片重复堆积；
- **哈希查重与版本链（`supersedes`）**：常规写入严格执行查重防线，显式版本更新时将旧卡片标记为 `superseded`；
- **冷备与导出**：
  - `backupDatabase()`：底层调用 SQLite 原生 `VACUUM INTO` 瞬时生成紧凑热备镜像；
  - `exportToMarkdown()`：支持一键将数据库全量还原为 Obsidian 格式的标准 Markdown 文件树。

### 2. 统一命名体系与极简动宾 MCP 协议 (`src/index.js`)
- **动宾契约**：`memhub_save`（存）、`memhub_search`（搜）、`memhub_get`（取）、`memhub_recent`（历），完全终结心智割裂，并向下兼容 `hub_*` 与 `exo_*`；
- **第一阶段（高维索引检索）**：
  - 工具 `memhub_search`；
  - 仅返回 L1 强指纹摘要数组，并在 Payload 中植入显式 `instruction` 引导大模型下一步动作；
  - 支持 `project` 工作区隔离与 global 穿透，以及 `tags` 多标签参数化交集收窄；
- **第二阶段（代码与根因展开）**：
  - 工具 `memhub_get`；
  - 支持传入单个 ID 或多 ID 数组，按三大分类专属 Markdown 模板高清呈现完整细节与可运行代码块。

### 3. 后台常驻定时提炼守护进程 `memhub daemon` (`src/daemon.js`)
- **常驻周期调度**：基于 `setInterval` 保持进程常驻，支持配置与 CLI 参数 `--interval`（默认 30 分钟），支持 SIGINT/SIGTERM 优雅释放；
- **动态端口与鉴权发现 (`src/host/opencode-client.js`)**：
  - 级联发现策略：显式配置 `MEMHUB_OPENCODE_URL` $\rightarrow$ 进程命令行（wmic/ps 解析 `--port` / `--hostname`） $\rightarrow$ 端口探测 $\rightarrow$ 默认 4096；
  - 自动读取环境变量 `OPENCODE_SERVER_PASSWORD` 构建 Basic 鉴权请求头，穿透安全防护；
- **双重时间窗口与防重过滤**：
  - 扫描窗口：只处理最近 `windowDays`（默认 7 天）内有更新的会话；
  - 静默时间：只处理更新时间距现在超过 `idleMinutes`（默认 120 分钟）的已稳定冷态会话；
  - 防重机制：查询本地 SQLite `session_tracking` 表，已标记为 `EXTRACTED` 或 `SKIPPED` 的会话不重复触发；
- **宿主 LLM 借算力驱动（HTTP 驱动，不 fork）**：
  - 调用 OpenCode HTTP API `POST /session/:id/prompt_async` 向目标会话注入深度复盘指令；
  - 宿主 LLM 在会话原有上下文中复盘真实变更，并调用已挂载的 MCP 工具 `memhub_save` 落盘；
  - 严禁假卡：无价值内容直接回复“无需沉淀”，不调用 `memhub_save`，杜绝脏数据；
  - 多卡支持：同一会话若并存问题排查与架构决策，分别拆分为独立卡片沉淀。

### 4. 提炼领域层重构与假抽取废除 (`src/pipeline/extractor.js`)
- **废除离线死模板**：彻底清理硬编码的 workbuddy/403/充值/泛化假卡代码，无 LLM 介入时不产生虚假知识；
- **物理终态证据门禁 (Truth Gate)**：严格检查退出码 0、测试通过、构建成功等确凿物理事实，未见成功证据严禁提取；
- **LLM 结果解析与门禁过滤**：提供 `parseLLMExtraction`，负责解析 LLM 的结构化输出并拦截无价值内容。

### 5. 混合检索与向量融合引擎 (`src/search/vector-engine.js` & `src/search/rrf.js`)
- **本地 384 维稠密特征向量空间**：基于字符级/词元级 N-gram 符号投影与 L2 范数归一化，零外部依赖、零 API Key、CPU 毫秒级计算；
- **双路并行检索架构**：第一路（SQLite FTS5 Trigram 字符精确穿透） + 第二路（384 维余弦相似度语义泛化，终结词汇鸿沟）；
- **倒数排名融合 (RRF 算法)**：基于 $Score(d) = \sum \frac{1}{60 + Rank_m(d)}$ 消除跨模态物理分差，无偏平滑合并与重排；
- **全生命周期向量同步与自愈**：老库热迁移自愈 `knowledge_embeddings` 表，写入时自动计算向量，CLI 支持 `memhub embed` 手动维护；
- **优雅降级保底**：两路未命中时自动平滑回退至 SQL `LIKE` 模糊匹配，保障零漏检。

### 6. CLI 命令行套件 (`src/cli.js`)
- 核心命令：
  - `memhub daemon`：启动常驻提炼调度（支持 `--once`, `--interval`, `--window-days`, `--idle`, `--limit`, `--dry-run`, `--force`）；
  - `memhub scan`：历史静默会话离线跟踪与扫描；
  - `memhub find <query>`：FTS5 + Vector + RRF 混合检索；
  - `memhub embed`：全量/增量向量同步与持久化；
  - `memhub get <id>`：查看卡片正文详情与代码；
  - `memhub list`：查看最近沉淀的知识大纲；
  - `memhub stats`：统计资产分布与会话萃取状态；
  - `memhub backup` / `memhub export`：热备份与 Markdown 导出；
  - `memhub path`：查看本地存储路径配置。

---

## 三、 尚待执行的差距与需求清单 (Pending Gap)

对照完整愿景，后续版本需分步推进以下模块：

### 差距 1：离线做梦与记忆熔炼引擎 `memhub dream` (P1 - 顶层重点)
- **当前状况**：已完成 5W2H 顶层方案、聚类公式、防重指纹表设计及生命周期流转规约（参见 `docs/dreaming-architecture-design.md`）。
- **待做事项**：
  1. 存储层 DDL 热自愈扩展：增加 `is_synthesized`、`status`、`consolidated_into` 等字段，新建 `knowledge_dream_history` 审计表；
  2. 实现基于「Tag + File + 384维向量」三维相似度的无向连通子图聚类算法；
  3. 打造闲时守护做梦流水线，结合宿主 LLM 完成多碎片升华为 L4 认知规范与矛盾雷达预警。

### 差距 2：动态知识地图自动注入 `memhub map` (P1)
- **当前状况**：目前依赖 Agent 自觉调用 MCP 工具检索。
- **待做事项**：开发 `memhub map` 命令，根据当前项目目录名与近期代码改动关键词，实时精选 Top 3~5 条最相关的长效资产，生成严格 `<500 tokens` 的 Markdown 块动态注入项目根目录的 `AGENTS.md`。

### 差距 3：研发态势大盘深度统计 (P1)
- **当前状况**：`memhub stats` 当前仅展示分类分布与扫描状态。
- **待做事项**：深度解析 OpenCode 会话中的 `tokens_*`、`cost`、`summary_diffs` 字段，提供“投入精力分布、改动文件热点、高频报错未决预警”的高阶研发报表。

### 差距 4：Cursor 桌面端无锁穿透 (P2)
- **当前状况**：已在 `src/adapters/cursor.js` 预留接口，目前返回空数组。
- **待做事项**：以只读不锁模式（`?mode=ro&immutable=1`）穿透 `%APPDATA%/Cursor/User/globalStorage/state.vscdb`，解析 `composerData` 与 `bubbleId` 时序消息流。

---

## 四、 迭代演进路线图 (Roadmap)

```
┌──────────────────────────────────────────────────────────────────┐
│ v0.1.2 当前交付版本 (已达成)                                      │
│ • 单文件 SQLite 分层存储内核 + DDL 自愈热迁移 + VACUUM 热备        │
│ • 极简动宾 MCP 协议 (memhub_search/get/save/recent 两阶段渐进披露)│
│ • 四大顶级基石分类收敛 (learnings/decisions/patterns/business 专属要素) │
│ • 存储层 Upsert 原地覆盖 + session_id/topic_fingerprint 防重      │
│ • 后台常驻守护 memhub daemon (setInterval + 优雅退出信号)         │
│ • OpenCode 宿主 HTTP 驱动抽取 (动态端口与鉴权 + 7天窗口/120分静默) │
│ • 彻底删除离线启发式硬编码假抽取，确立真实 LLM 提炼主链路         │
│ • Truth Verification Gate 物理终态成功证据检验门禁               │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ v0.2.0 离线做梦与认知自省引擎 (下一阶段核心攻坚)                  │
│ • 落地 memhub dream 做梦引擎 (碎片聚类 + 记忆熔炼 + 矛盾自省)    │
│ • 引入 L4 认知升华层与增量吸收机制，彻底规避记忆碎片与认知精神分裂│
│ • 实现 memhub map 动态生成 AGENTS.md 知识地图节 (<500 tokens)   │
│ • 细化 memhub stats 高阶研发投入与代码热点统计报表               │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ v0.3.0 多宿主生态扩展 (进阶演进)                                  │
│ • 穿透 Cursor state.vscdb 离线会话提取                           │
│ • Claude Code hooks (Stop / SessionEnd / PreCompact) 原生探测挂载 │
│ • 团队级 Git-Backed Vault 双向同步 (memhub sync)                 │
└──────────────────────────────────────────────────────────────────┘
```
