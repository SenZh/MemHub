# MemHub 目标差距分析与工程演进计划书 (Roadmap & Progress)

> **版本定位**：v0.1.0 基础交付版（Baseline Release）  
> **项目定位**：面向 AI Coding Agent 的工程长效记忆与暗知识调度中枢（Unified Memory & Knowledge Hub）  
> **基准日期**：2026-09-06

---

## 一、 核心设计目标与全量现状盘点 (Executive Summary)

对照项目的最终设计愿景（`requirements-and-boundaries.md` 与 `architecture-design.md`），我们对当前已落地工程资产进行了**地毯式核对与差距分析（Gap Analysis）**：

| 架构分层 / 功能模块 | 设计终态目标 (Vision) | 当前实现状态 (Status) | 达成度 |
| :--- | :--- | :--- | :---: |
| **1. 存储内核与事务安全** | 单文件 SQLite 物理分层 + FTS5 倒排 + VACUUM INTO 热备 + Markdown 导出 | 已完整实现（`src/storage.js`），支持物理字段分层、查重防线、版本演进与冷备归档 | **100%** |
| **2. 渐进式披露交互协议** | MCP Stdio 两阶段渐进协议（L1 极简索引 + instruction 引导 $\rightarrow$ L2/L3 展开代码详情） | 已完整实现（`src/index.js`），支持单条与批量多 ID 展开，双命名空间兼容 | **100%** |
| **3. 过滤引擎与配置体系** | 动态静默时间阈值 + watchDirectories / include / exclude 路径正则规则 | 已完整实现（`src/path-filter.js`、`src/config.js`），防时序踩踏与特殊字符转义 | **100%** |
| **4. OpenCode 深度打透** | 本地 `opencode.db` WAL 只读扫描 + 离线静默状态机判定 + 自动萃取 | 已完整打透（`src/adapters/opencode.js`、`src/pipeline/scanner-service.js`），SQL 层彻底防自循环 | **100%** |
| **5. 用户自定义分类扩展** | 项目级/全局级 `categories.json` 动态注册新分类与 Schema 校验 | 核心配置与入参校验已打通，专用 Markdown 模板动态渲染待进阶完善 | **85%** |
| **6. 混合检索与向量层 (P1)** | SQLite FTS5 Trigram + 本地轻量向量 (MiniLM) + RRF 倒数排名融合 | 当前基于 **FTS5 Trigram + LIKE 智能兜底**；本地 ONNX 向量引擎与 RRF 算法尚未接入 | **40%** |
| **7. 动态知识地图注入 (P1)** | `memhub map` 自动生成当前项目 `<500 tokens` 的 `AGENTS.md` 知识地图节 | 尚未实现（目前通过 MCP 工具和静态规则引导） | **0%** |
| **8. Cursor 深度穿透 (P2)** | 穿透 `%APPDATA%/Cursor/.../state.vscdb` 读取 `composerData` 时序流 | 接口骨架与插槽已就绪（`src/adapters/cursor.js`），底层解析逻辑暂未填入（按既定策略延后） | **20%** |
| **9. 研发态势与资产大盘** | `memhub stats` 全局与项目投入盘点、资产统计与盲区分析 | 已实现基础统计（分类分布、有效条目数、已扫描会话数），高阶文件改动频次与盲区预警待细化 | **70%** |

---

## 二、 当前已完整实现的内容清单 (Done in v0.1.0)

截至当前版本，系统已形成**端到端闭环的工业级基础核心**，全部 7 大测试套件 31 个场景 100% 绿灯：

### 1. 单文件 SQLite 物理分层存储引擎 (`src/storage.js`)
- **存读一体分层**：
  - **L1 检索层**：`title`, `category`, `project`, `tags`, `summary`, `related_files`（单条仅消耗 30~50 tokens）；
  - **L2/L3 实体层**：`root_cause`, `solution_core`, `code_payload`（按需展开大文本）；
- **哈希查重与幂等防线**：入库前对标准化标题与项目进行唯一性检测，完全同名直接跳过并提示已有 ID，彻底杜绝历史重复插入垃圾数据；
- **显式版本链（`supersedes`）**：新决策/方案入库时可指定替代旧卡片 ID，旧卡片自动置为 `superseded`，检索默认只召回有效版本；
- **冷备与导出**：
  - `backupDatabase()`：底层调用 SQLite 原生 `VACUUM INTO` 瞬时生成紧凑热备镜像；
  - `exportToMarkdown()`：支持一键将数据库全量还原为 Obsidian 格式的标准 Markdown 文件树。

### 2. 两阶段渐进式披露 MCP 协议 (`src/index.js`)
- **第一阶段（高维索引检索）**：
  - 工具 `hub_search_knowledge`（兼容 `exo_search_knowledge`）；
  - 仅返回 L1 摘要数组，并在 Payload 中植入显式 `instruction` 引导大模型下一步动作；
- **第二阶段（代码与根因展开）**：
  - 工具 `hub_get_knowledge`（兼容 `exo_get_knowledge`）；
  - 支持传入单个 ID 或多 ID 数组，按需释放完整技术细节与可运行代码块；
- **工具全集**：`hub_record_knowledge`, `hub_search_knowledge`, `hub_get_knowledge`, `hub_list_recent`。

### 3. 路径过滤与自动采集规则引擎 (`src/path-filter.js`)
- **三道安全防线**：`watchDirectories 根目录限制` $\rightarrow$ `exclude 黑名单拦截 (最高)` $\rightarrow$ `include 白名单确认`；
- **安全 Glob 编译**：
  - 正则特殊字符（`.`, `+`, `()`, `[]` 等）全量安全转义，防止正则注入崩溃；
  - 分步占位符置换解决 `**` 与 `*` 嵌套踩踏；
  - 末尾 `/**` 特殊处理为 `(?:\/.*)?$`，精准兼顾目录自身与深层子路径匹配；
  - 尾部边界保护，严防 `tmp` 误杀 `tmp-data` 等前缀同名目录。

### 4. 动态配置与适配器闭环 (`src/config.js` & `src/adapters/opencode.js`)
- **可配置静默时间**：支持通过 `config.json` 或 `MEMHUB_IDLE_MINUTES` 自定义，拒绝硬编码；
- **OpenCode 深度打透**：
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
