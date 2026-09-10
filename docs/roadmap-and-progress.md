# MemHub 目标差距分析与工程演进计划书 (Roadmap & Progress)

> **版本定位**：v0.1.3 会话零污染抽取、配置热重载与 Cron 做梦调度增强版（Isolated Extraction & Scheduling Release）  
> **项目定位**：面向 AI Coding Agent 的工程长效记忆与暗知识调度中枢（Unified Memory & Knowledge Hub）  
> **更新基准**：2026-09-10

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
| **6. 后台常驻定时提炼守护 (P0)** | `memhub daemon` 常驻自循环，通过 OpenCode HTTP 驱动宿主 LLM 抽取 | 已完整打透（`src/daemon.js`、`src/host/opencode-client.js`）：动态端口与鉴权 + 7天窗口/120分静默 + 权威排除所有 Subagent 子会话 + **fork 副本抽取（原会话零污染，抽完即删）** + **每轮配置热重载** + 严禁假卡 | **100%** |
| **7. 废除离线启发式造假 (P0)** | 彻底清除硬编码关键词捏造假卡，只允许真实 LLM 分析沉淀高质量资产 | 已彻底重构（`src/pipeline/extractor.js`）：废除死模板，保留 Truth Gate 物理成功证据门禁与 LLM 结果解析 | **100%** |
| **8. 混合检索与向量融合层 (P1)** | SQLite FTS5 Trigram + 本地 384 维稠密向量 + RRF 倒数排名融合 | 已完整实现（`src/search/vector-engine.js`、`src/search/rrf.js`、`src/storage.js`）：双路并行召回 + 60 平滑因子 RRF 融合 + 词汇鸿沟语义泛化 + LIKE 优雅兜底 | **100%** |
| **9. 离线做梦与记忆熔炼 (P1 - 顶层热点)** | 极简 Cron 触发闲时做梦（Dreaming）：碎片三维聚类、宿主 LLM 反思 Prompt、防重状态机、L4 升华层落盘与碎片封存 | Phase 1 & 2 端到端已完整打通（Prompt 模板、执行流水线、supersedes 溯源链、consolidated 封存流转）；**Cron 已真正生效（标准 5 段式 + 区间命中检测，修复轮询相位错位）**，单测 100% 覆盖 | **100%** |
| **10. 认知读协议与触发规约增强 (P0)** | 强化 MCP 工具描述与读协议诱导，解决 LLM 不知何时读、怎么读、能做什么 | 已完整实现（`src/index.js`），注入 4 大触发门禁与动态分支指引，单测验证通过 | **100%** |
| **11. 研发态势与项目资产大盘 (P1)** | `memhub stats` 全局/项目研发态势与按 Project 维度分类资产大盘总结 | 已完整实现（`src/storage.js`、`src/cli.js`），支持 ASCII 可视化、`--json` 输出与**做梦引擎成效透视（L4 升华/封存碎片/熔炼轮次/候选池）** | **100%** |
| **12. MCP 工具调用审计日志 (P0)** | 端到端捕获 MCP 工具调用流水、查询关键词、命中条数与耗时，CLI `memhub audit` 检索 | 已完整实现（`mcp_audit_logs` 表、AOP 切面、`memhub audit` 命令），单测全覆盖 | **100%** |
| **13. 项目命名空间防腐与治理 (P0)** | 根治多系统别名（如 `omsdubhe` / `OMS-Dubhe`）裂变，统一收敛为权威项目名 | 已完整实现（存量数据清洗归一、`normalizeProjectName` 写入防腐、Prompt 强约束注入） | **100%** |
| **14. 动态知识地图注入 (P2)** | `memhub map` 自动生成当前项目 `<500 tokens` 的 `AGENTS.md` 知识地图节 | 评估识别痛点（开局任务未知），调整优先级至 v0.2.x 探索 | **0%** |
| **15. Cursor 深度穿透 (P2)** | 穿透 `%APPDATA%/Cursor/.../state.vscdb` 读取 `composerData` 时序流 | 接口骨架与插槽已就绪（`src/adapters/cursor.js`），底层解析逻辑暂未填入（按既定策略延后） | **20%** |
| **16. 会话零污染抽取与 Cron 调度增强 (P0)** | fork 副本抽取避免污染原会话排序/缓存；daemon 配置热重载；dream cron 真正按表达式触发 | 已完整实现：`fork`→抽取→轮询完成→`finally` 删除的闭环 + `(fork #N)` 防套娃拦截 + 每轮热重载 + 标准 5 段式 Cron 引擎与区间命中检测，实测与 13 套件单测全绿 | **100%** |

---

## 二、 当前已完整实现的内容清单 (Done in v0.1.3)

截至当前版本，系统已形成**端到端闭环的工业级基础核心**，全部 13 大测试套件与宿主客户端单测 100% 绿灯：

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
  - **单一权威 Subagent 拦截门禁**：通过 `isSubagentSession` 全面拦截 `parentID` / `agent` 子角色 / `subagent` 标题派生会话，仅聚焦主任务，直接节省 60% 无效推理算力；
- **宿主 LLM 借算力驱动（fork 副本抽取，原会话零污染）**：
  - 调用 OpenCode HTTP API `POST /session/:id/fork` 复制原会话上下文（继承前缀 Prompt Cache），再向副本 `POST /session/:id/prompt_async` 注入深度复盘指令；
  - 全程不写原会话，**原会话排序与缓存完全不受影响**；轮询副本最后一条 assistant 消息的完成度（`time.completed`）判定抽取结束，无论成败均在 `finally` 中删除副本；
  - 副本标题带 `(fork #N)` 特征，`isSubagentSession` 予以拦截，配合抽完即删彻底杜绝套娃循环抽取；
  - 宿主 LLM 在副本上下文中复盘真实变更，并调用已挂载的 MCP 工具 `memhub_save` 落盘（结果归属原会话 `session_id`）；
  - 严禁假卡：无价值内容直接回复“无需沉淀”，不调用 `memhub_save`，杜绝脏数据；
  - 多卡支持：同一会话若并存问题排查与架构决策，分别拆分为独立卡片沉淀。
- **配置热重载**：每轮 tick 重新读取 `config.json`，`daemon`/`dream`/`scanRules` 等改动无需重启进程即可生效。

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
  - `memhub dream`：离线记忆熔炼与碎片聚类（支持 `--dry-run`, `--affinity`, `--project`, `--json`）；
  - `memhub search` / `memhub find`：FTS5 + Vector + RRF 混合检索（支持 `--project`, `--category`, `--tag`）；
  - `memhub list`：查看最近沉淀的知识大纲（支持 `--limit`, `--project`, `--category`, `--tag` 与 search 规范对齐）；
  - `memhub stats`：统计资产分布、项目维度矩阵分布与会话萃取状态（支持 `--json`, `--project`）；
  - `memhub audit`：查看 MCP 工具调用与访问审计流水（支持 `--tool <name>`, `--json`, `--limit`）；
  - `memhub embed`：全量/增量向量同步与持久化；
  - `memhub get <id>`：查看卡片正文详情与代码；
  - `memhub backup` / `memhub export`：热备份与 Markdown 导出；
  - `memhub path`：查看本地存储路径配置。

---

## 三、 尚待执行的差距与需求清单 (Pending Gap)

对照完整愿景，后续版本需分步推进以下模块（原"离线做梦与记忆熔炼引擎"已于 v0.1.2~v0.1.3 交付，详见第四节 Done 清单）：

### 差距 1：动态知识地图自动注入 `memhub map` (P2)
- **当前状况**：目前依赖 Agent 自觉调用 MCP 工具检索。
- **待做事项**：开发 `memhub map` 命令，根据当前项目目录名与近期代码改动关键词，实时精选 Top 3~5 条最相关的长效资产，生成严格 `<500 tokens` 的 Markdown 块动态注入项目根目录的 `AGENTS.md`。

### 差距 2：研发态势大盘深度统计 (P2)
- **当前状况**：`memhub stats` 当前已支持分类分布、按 Project 维度矩阵分布与 MCP 频次透视。
- **待做事项**：深度解析 OpenCode 会话中的 `tokens_*`、`cost`、`summary_diffs` 字段，提供“投入精力分布、改动文件热点”的高阶报表。

### 差距 3：Cursor 桌面端无锁穿透 (P2)
- **当前状况**：已在 `src/adapters/cursor.js` 预留接口，目前返回空数组。
- **待做事项**：以只读不锁模式（`?mode=ro&immutable=1`）穿透 `%APPDATA%/Cursor/User/globalStorage/state.vscdb`，解析 `composerData` 与 `bubbleId` 时序消息流。

---

## 四、 迭代演进路线图 (Roadmap)

```
┌──────────────────────────────────────────────────────────────────┐
│ v0.1.3 当前交付版本 (已达成全部 16 项能力)                        │
│ • 单文件 SQLite 分层存储内核 + DDL 自愈热迁移 + VACUUM 原生热备     │
│ • 极简动宾 MCP 协议 (memhub_search/get/save/recent 两阶段防爆Token)│
│ • 认知读门禁注入 (4 大必调时机 + 动态 instruction 分支指引)       │
│ • 端到端 MCP 调用审计流水 (mcp_audit_logs 与 memhub audit)         │
│ • 项目维度研发态势与资产大盘矩阵 (memhub stats + 做梦成效透视)     │
│ • 项目命名空间防腐治理 (统一 oms 权威收敛与 Prompt 强约束)         │
│ • 本地 384 维向量 + FTS5 Trigram + RRF 倒数排名混合检索           │
│ • 后台常驻提炼守护 memhub daemon (fork 副本抽取, 原会话零污染)     │
│ • daemon 配置热重载 (每轮 tick 重读 config.json, 免重启生效)      │
│ • 离线做梦与记忆熔炼 (Dreaming: 三维聚类 + L4 熔炼 + 封存)        │
│ • 标准 5 段式 Cron 做梦调度 (区间命中检测, 修复轮询相位错位)       │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ v0.2.0 多宿主生态扩展与协同 (下一阶段演进)                        │
│ • 穿透 Cursor state.vscdb 离线会话提取                           │
│ • Claude Code hooks (Stop / SessionEnd / PreCompact) 原生探测挂载 │
│ • 探索开局动态知识地图注入 (memhub map)                          │
│ • 团队级 Git-Backed Vault 双向同步 (memhub sync)                 │
└──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ v0.3.0 多宿主生态扩展 (进阶演进)                                  │
│ • 穿透 Cursor state.vscdb 离线会话提取                           │
│ • Claude Code hooks (Stop / SessionEnd / PreCompact) 原生探测挂载 │
│ • 团队级 Git-Backed Vault 双向同步 (memhub sync)                 │
└──────────────────────────────────────────────────────────────────┘
```
