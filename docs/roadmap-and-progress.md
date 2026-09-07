# MemHub 目标差距分析与工程演进计划书 (Roadmap & Progress)

> **版本定位**：v0.1.1 认知与契约强化交付版（Cognitive & Contract Release）  
> **项目定位**：面向 AI Coding Agent 的工程长效记忆与暗知识调度中枢（Unified Memory & Knowledge Hub）  
> **基准日期**：2026-09-07

---

## 一、 核心设计目标与全量现状盘点 (Executive Summary)

对照项目的最终设计愿景（`requirements-and-boundaries.md` 与 `architecture-design.md`），我们对当前已落地工程资产进行了**地毯式核对与差距分析（Gap Analysis）**：

| 架构分层 / 功能模块 | 设计终态目标 (Vision) | 当前实现状态 (Status) | 达成度 |
| :--- | :--- | :--- | :---: |
| **1. 存储内核与事务安全** | 单文件 SQLite 物理分层 + DDL自愈热迁移 + VACUUM INTO 热备 + Markdown 导出 | 已完整实现（`src/storage.js`），支持物理列扩展、老库 DDL 自愈、查重防线与冷备 | **100%** |
| **2. 极简动宾 MCP 协议** | `memhub_*` 极简动宾契约（memhub_search/get/save/recent）两阶段渐进披露 | 已完整实现（`src/index.js`），两阶段防爆 Token，且完全向下兼容老别名 | **100%** |
| **3. 三大基石分类与结构要素** | 收敛为三大正交顶级分类（learnings/decisions/patterns），各具备专属要素结构 | 已完整实现（`src/config.js`、`src/storage.js`），彻底补全业务背景与排错误区 | **100%** |
| **4. 工作区与标签多维过滤** | 支持 (project=? OR global) 工作区隔离穿透 + json_each 多标签 AND 交集过滤 | 已完整实现（`src/storage.js`、`src/cli.js`），CLI 与 MCP 全面支持收窄 | **100%** |
| **5. 过滤引擎与配置体系** | 动态静默时间阈值 + watchDirectories / include / exclude 路径正则规则 | 已完整实现（`src/path-filter.js`、`src/config.js`），防时序踩踏与特殊字符转义 | **100%** |
| **6. OpenCode 深度打透** | 本地 `opencode.db` WAL 只读扫描 + 离线静默状态机判定 + Truth 证据门禁 | 已完整打透（`src/adapters/opencode.js`、`src/pipeline/extractor.js`），严格防自循环 | **100%** |
| **7. 后台常驻定时守护进程 (P1)** | `memhub daemon` 后台常驻定时扫描（可配置定时轮询周期） | 规划至 **v0.2.0**（当前已支持单次 `memhub scan` 与静默状态机） | **40%** |
| **8. 动态知识地图注入 (P1)** | `memhub map` 自动生成当前项目 `<500 tokens` 的 `AGENTS.md` 知识地图节 | 规划至 **v0.2.0**（目前通过 MCP 工具和静态规则引导） | **0%** |
| **9. 混合检索与向量层 (P1)** | SQLite FTS5 Trigram + 本地轻量向量 (MiniLM) + RRF 倒数排名融合 | 当前基于 **FTS5 Trigram + LIKE 智能兜底**；本地 ONNX 向量引擎与 RRF 规划至后续版本 | **40%** |
| **10. Cursor 深度穿透 (P2)** | 穿透 `%APPDATA%/Cursor/.../state.vscdb` 读取 `composerData` 时序流 | 接口骨架与插槽已就绪（`src/adapters/cursor.js`），底层解析逻辑暂未填入（按既定策略延后） | **20%** |
| **11. 研发态势与资产大盘** | `memhub stats` 全局与项目投入盘点、资产统计与盲区分析 | 已实现基础统计（分类分布、有效条目数、已扫描会话数），高阶文件改动频次与盲区预警待细化 | **70%** |

---

## 二、 当前已完整实现的内容清单 (Done in v0.1.1)

截至当前版本，系统已形成**端到端闭环的工业级基础核心**，全部 7 大测试套件 31 个场景 100% 绿灯：

### 1. 单文件 SQLite 物理分层存储引擎 (`src/storage.js`)
- **存读一体分层**：
  - **L1 检索层**：`title`, `category`, `project`, `tags`, `summary`, `related_files`（单条仅消耗 30~50 tokens）；
  - **L2/L3 实体层**：`context_text`, `root_cause`, `solution_core`, `code_payload`, `extra_payload`（按需展开大文本）；
- **DDL 热迁移自愈与存量兼容**：内置 `runMigrations` 钩子，老库自愈补齐新列，并自动幂等刷写存量历史分类；
- **哈希查重与幂等防线**：入库前对标准化标题与项目进行唯一性检测，完全同名直接跳过并提示已有 ID，彻底杜绝历史重复插入垃圾数据；
- **显式版本链（`supersedes`）**：新决策/方案入库时可指定替代旧卡片 ID，旧卡片自动置为 `superseded`，检索默认只召回有效版本；
- **冷备与导出**：
  - `backupDatabase()`：底层调用 SQLite 原生 `VACUUM INTO` 瞬时生成紧凑热备镜像；
  - `exportToMarkdown()`：支持一键将数据库全量还原为 Obsidian 格式的标准 Markdown 文件树。

### 2. 统一命名体系与极简动宾 MCP 协议 (`src/index.js`)
- **命名全面升级**：`memhub_save`（存）、`memhub_search`（搜）、`memhub_get`（取）、`memhub_recent`（历），完全终结“叫 knowledge”的心智割裂，并向后兼容 `hub_*` 与 `exo_*`；
- **第一阶段（高维索引检索）**：
  - 工具 `memhub_search`；
  - 仅返回 L1 强指纹摘要数组，并在 Payload 中植入显式 `instruction` 引导大模型下一步动作；
  - 支持 `project` 工作区隔离与 global 穿透，以及 `tags` 多标签参数化交集收窄；
- **第二阶段（代码与根因展开）**：
  - 工具 `memhub_get`；
  - 支持传入单个 ID 或多 ID 数组，按三大分类专属 Markdown 模板高清呈现完整细节与可运行代码块。

### 3. 路径过滤与自动采集规则引擎 (`src/path-filter.js` & `src/pipeline/extractor.js`)
- **三道安全防线**：`watchDirectories 根目录限制` $\rightarrow$ `exclude 黑名单拦截 (最高)` $\rightarrow$ `include 白名单确认`；
- **物理终态证据门禁 (Truth Gate)**：提炼引擎前置检验会话尾部成功证据（退出码0、测试通过绿灯、日志明确），无成功证据一律拒绝提取，杜绝有害脑补；
- **敏感凭据深度递归脱敏**：标量字段与多级数组要素全量调用 `scrubSecrets` 正则脱敏，替换为 `***REDACTED***`。

---

## 三、 尚待执行的差距与需求清单 (Pending Gap)

对照完整愿景，后续演进需分步补齐以下关键模块：

### 差距 1：后台常驻定时守护进程 `memhub daemon` (规划至 v0.2.0)
- **当前状况**：目前仅支持通过终端命令手动触发单次离线扫描（`memhub scan`）。
- **待做事项**：在 CLI 中增加 `memhub daemon` 常驻守护命令，支持通过配置文件设置后台定时轮询周期（如每 30 分钟一次），在后台免打扰自动扫描静默完成的会话并提炼入库。

### 差距 2：动态知识地图自动注入 `memhub map` (P1)
- **当前状况**：目前依赖 Agent 自觉调用 MCP 工具检索。
- **待做事项**：开发 `memhub map` 命令，根据当前项目目录名与近期代码改动关键词，实时精选 Top 3~5 条最相关的长效资产，生成严格 `<500 tokens` 的 Markdown 块动态注入项目根目录的 `AGENTS.md`。

### 差距 3：本地向量引擎与混合检索 (P1)
- **当前状况**：目前依赖 SQLite FTS5 Trigram 精确字符匹配与 LIKE 模糊匹配。
- **待做事项**：引入本地零外部依赖的 ONNX 运行时小模型（MiniLM / 384维），实现“FTS5 字符 + 向量语义”双路召回与 RRF 倒数排名融合。

### 差距 4：Cursor 桌面端无锁穿透 (P2)
- **当前状况**：已在 `src/adapters/cursor.js` 预留接口，但目前扫描返回空数组。
- **待做事项**：以只读不锁模式（`?mode=ro&immutable=1`）穿透 `%APPDATA%/Cursor/User/globalStorage/state.vscdb`，解析 `composerData` 与 `bubbleId` 时序消息流。

---

## 四、 后续迭代演进路线图 (Roadmap)

```
┌──────────────────────────────────────────────────────────────────┐
│ v0.1.1 当前交付版本 (已达成)                                      │
│ • 单文件 SQLite 分层存储内核 + DDL 自愈热迁移 + VACUUM 热备        │
│ • 极简动宾 MCP 协议 (memhub_search/get/save/recent 两阶段渐进披露)│
│ • 三大顶级基石分类收敛 (learnings/decisions/patterns 专属要素)     │
│ • 工作区隔离与全局穿透 (project = ? OR global) + 标签交集 (tags AND)│
│ • 提炼引擎 Truth Verification Gate 物理终态成功证据检验门禁       │
│ • 统一命名全面对齐为 MemHub                                      │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ v0.2.0 后台常驻守护与被动注入增强 (下一阶段重点)                  │
│ • 实现 memhub daemon 后台常驻定时扫描与周期轮询调度               │
│ • 实现 memhub map 动态生成 AGENTS.md 知识地图节 (<500 tokens)   │
│ • 细化 memhub stats 高阶研发投入与代码热点统计报表               │
│ • 接入本地 ONNX 向量嵌入与 RRF 混合检索算法 (终结词汇鸿沟)          │
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
  - WAL 只读模式直连 `opencode.db`；
  - SQL 参数化时间过滤：`(time_updated < (? - ?) OR ? = 1)`；
  - SQL 前缀黑名单：`AND title NOT LIKE '[MemHub]%'`，彻底杜绝自循环萃取风暴；
  - 资源安全：加入 `close()` 机制，彻底解决 Windows 平台下的 SQLite 锁定报错；
- **配置优先级与兼容**：环境变量绝对优先，平滑兼顾本地旧目录（`~/.memhub` > `~/.memory-hub` > `~/.exobrain`）。

### 5. CLI 命令行套件 (`src/cli.js`)
- 绑定命令：`memhub` 与 `mem-hub`（彻底移除通用的 `hub`）；
- 核心命令集：
  - `memhub scan`：手动触发离线静默会话自动萃取；
  - `memhub find <query>`：FTS5 Trigram 毫秒级全文检索；
  - `memhub get <id>`：查看详情与完整代码；
  - `memhub list`：拉取最近知识大纲；
  - `memhub stats`：统计资产分布与已扫描状态；
  - `memhub backup`：执行无损原子热备份；
  - `memhub export`：按需导出 Markdown 知识卡片。

---

## 三、 尚待执行的差距与需求清单 (Pending Gap)

对照完整愿景，后续演进需分步补齐以下关键模块：

### 差距 1：本地向量引擎与混合检索 (P1)
- **当前状况**：目前完全依赖 SQLite FTS5 Trigram 进行精确字符匹配。对于代码类名、错误码、文件名精准度 100%，但在“词汇鸿沟”（如用户搜“掉单”，卡片写“Webhook 丢包”）场景下略显吃力。
- **待做事项**：引入本地零外部依赖的 ONNX 运行时小模型（MiniLM / 384维），实现“FTS5 字符 + 向量语义”双路召回与 RRF 倒数排名融合。

### 差距 2：动态知识地图自动注入 `memhub map` (P1)
- **当前状况**：目前依赖 Agent 自觉调用 MCP 工具检索。
- **待做事项**：开发 `memhub map` 命令，根据当前项目目录名与近期代码改动关键词，实时精选 Top 3~5 条最相关的长效资产，生成严格 `<500 tokens` 的 Markdown 块动态注入项目根目录的 `AGENTS.md`。

### 差距 3：研发态势大盘深度统计 (P1)
- **当前状况**：`memhub stats` 仅展示了分类条目数与扫描状态。
- **待做事项**：深度解析 OpenCode 会话中的 `tokens_*`、`cost`、`summary_diffs` 字段，提供“投入精力分布、改动文件热点、高频报错未决预警”的高阶报表。

### 差距 4：Cursor 桌面端无锁穿透 (P2)
- **当前状况**：已在 `src/adapters/cursor.js` 预留接口，但目前扫描返回空数组。
- **待做事项**：按照此前调研成果，以只读不锁模式（`?mode=ro&immutable=1`）穿透 `%APPDATA%/Cursor/User/globalStorage/state.vscdb`，解析 `composerData` 与 `bubbleId` 时序消息流。

---

## 四、 后续迭代演进路线图 (Roadmap)

```
┌──────────────────────────────────────────────────────────────────┐
│ v0.1.0 当前基线版本 (已达成)                                      │
│ • 单文件 SQLite 分层存储内核 + VACUUM 热备                       │
│ • 两阶段渐进式披露 MCP 协议 (L1 索引 + instruction 引导 -> L2 正文) │
│ • 路径规则与自动采集引擎 (watchDirectories/include/exclude)        │
│ • OpenCode 离线扫描全链路打透 (可配置静默时间 + SQL防自循环)       │
│ • 统一命名收敛为 MemHub (memhub / mem-hub)                      │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ v0.2.0 智能检索与被动注入增强 (下一阶段重点)                      │
│ • 接入本地 ONNX 向量嵌入与 RRF 混合检索算法 (终结词汇鸿沟)          │
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

---

## 五、 GitHub 仓库初始化准备指引

你即将去 GitHub 创建官方仓库，信息核对如下：
- **Repository Name**: **`MemHub`**（或 `memhub`）
- **Description**: `The unified long-term memory & knowledge hub for AI coding agents (OpenCode, Cursor, Claude Code, etc.)`
- **Visibility**: Public / Private
- **License**: MIT
- **Primary Package**: `memhub@0.1.0` (CLI: `memhub`, `mem-hub`, MCP: `memhub-mcp`)
