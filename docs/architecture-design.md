# ExoBrain 完整架构设计与演进蓝图文档 (System Architecture & Roadmap)

> **版本**：v1.4 (Experience Graph & Industry Benchmark Edition)  
> **状态**：Approved / Baseline Established  
> **核心定位**：AI 编程与任务协作的原生知识外脑（免维护、散碎暗知识沉淀、轻量因果图谱、跨场景秒级复用）

---

## 1. 项目本质哲学与核心使命 (Core Philosophy)

### 1.1 什么是 ExoBrain？（重新定义外脑的灵魂）
ExoBrain **坚决不做**大而全的项目官方架构文档生成器，也**不做**代码仓库的变更日志（Changelog）管理器——那些本应由 Agent 在项目内部自行完成。

ExoBrain 的唯一使命，是充当开发者与各类 AI Agent（OpenCode、Cursor、Claude Code 等）身后的**【实操经验随身锦囊 / 散碎暗知识蓄水池 (Pocket Playbook)】**：
- **不求宏大完整，但求零碎可用**；
- 专门收录那些**“不大不小、写进官方 Wiki 嫌太碎、不记下来下次遇到又得重新抓瞎”**的实操经验、野路子技巧、特殊参数配方与环境暗坑；
- 让每一次在某个特定会话、特定项目或赛事中“好不容易跑通的宝贵经验”，沉淀为不可丢失的原子资产。

### 1.2 解决的三大核心痛点场景
1. **跨项目 / 跨赛事的“成功经验迁移”（复制成功）**：
   - 上次在“赛事 A”费尽周折调试通的评测脚本与参数配方，下次在“赛事 B”卡住时，直接让 Agent 调工具查出上次的解法，一秒钟照猫画虎直接跑通。
2. **工作轨迹与关键改动的“快速回溯盘点”（足迹梳理）**：
   - 时隔一个月重新打开某个 Workspace，敲一行 `exo list --project <name>`，30 秒快速盘点“我之前在这个项目里到底改了哪些关键逻辑、跑通过哪些尝试”。
3. **值班排障数字人的“一招制敌”（防重复排查）**：
   - 数字人作为负责人帮不同人排查问题，一次踩坑排查完自动沉淀，后续任何人遇到相同故障，数字人秒级唤醒卡片给出正解。

---

## 2. 行业前沿生态对比与护城河 (Industry Benchmark)

针对 GitHub 开源生态（如 `agentmemory`、`ipiton`、`Astrivya`）以及大厂方案（如腾讯最新开源的 `TencentDB-Agent-Memory` v2.0），ExoBrain 的差异化护城河如下：

| 对比维度 | 腾讯 TencentDB-Agent-Memory | 常见开源记忆体 (agentmemory / Ruben) | **ExoBrain (我们的方案)** |
|---|---|---|---|
| **核心定位** | **企业级记忆中台**（偏中后台管控与多团队共享） | **全量对话向量切片**（什么都记的录音笔） | **个人/Agent 实操经验便签本**（专记暗知识与避坑） |
| **接入机制** | **流量代理劫持 (Proxy 模式)**<br>必须把 Agent 的 `baseURL` 改为腾讯网关。 | **工具严重过载**<br>暴露 **53~54 个工具**，严重造成模型注意力崩溃与 Token 浪费。 | **极简标准 MCP (stdio 直通)**<br>**仅 4 个原子工具**，即插即用，0 端口占用，0 网络流量劫持。 |
| **算力与配置** | 强依赖外部 Embedding 接口与腾讯云向量库 TCVDB。 | 逼用户额外配 OpenAI Key，或本地硬编译 `llama.cpp` + Qdrant 向量库。 | **绝对 0 外置大模型配置**<br>借用宿主当前会话算力，吃满 **Prompt Cache（近乎免费）**。 |
| **存储透明度** | 专有数据库与网关内部格式。 | 向量索引深渊（人类不可读）。 | **纯 Markdown (真理源) + SQLite FTS5 (加速视图)**<br>文件直接可看可改，随时 Git 同步。 |
| **知识组织** | 复杂的 CodeGraph (AST语法树) 与企业级 Wiki。 | 扁平切片碎片。 | **原子实操卡片 + 轻量因果实体图谱 (Triples)**。 |

---

## 3. 系统四层解耦架构 (Layered Architecture)

系统严格按照工业级 4 层解耦模型设计，各层职责单一、单测独立、可插拔扩展：

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

## 4. 双轨知识获取运行机制

### 4.1 主动直通机制（核心主路径：RPC 内存直通）
- **触发入口**：用户在任何支持 MCP 的 Agent 中输入 `/know`、`/save` 或说“记录一下刚才跑通的参数/踩坑”。
- **模型推理**：宿主 Agent 基于当前受热的完整会话上下文，提炼出 25 字标准标题与结构化卡片参数。
- **安全脱敏管道 (Secret Scrubbing)**：
  MCP Server 收到参数后，**强制经过正则脱敏器**（清洗常见 AK/SK、JWT、Bearer Token、私钥、密码），替换为 `***REDACTED***`。
- **协议入库**：直接以原子方式落盘 Markdown 并写入 SQLite FTS5 索引，返回 `{ success: true, id: "kb-xxxx" }`，耗时 <10ms，**坚决不读 IDE 本地数据库，绝对安全稳定**。

### 4.2 被动离线增量扫描（安全兜底路径）
- **防 Fork 炸弹隔离**：扫描 SQL 强制排除 `parent_id IS NOT NULL` 与特定前缀，绝不递归提炼派生会话。
- **状态机与悲观锁**：`session_tracking` 维护 `PENDING` $\rightarrow$ `EXTRACTING` $\rightarrow$ `EXTRACTED` / `SKIPPED` / `FAILED`，带 180s 租约锁，保证单会话只处理一次，支持随时重跑与增量顺延。
- **进程树治理**：对无头回唤进程引入 120 秒硬超时和 `taskkill /T /F` 级联清理，杜绝 Windows 孤儿进程与端口泄漏。

---

## 5. 存储模型与物理契约 (Storage Design)

### 5.1 物理目录布局 (`~/.exobrain/`)
```text
~/.exobrain/
├── config.json                     # 全局配置
├── index.db                        # SQLite 数据库（WAL 模式，元数据、FTS5、图谱、状态机）
└── vault/                          # 知识真理唯一来源 (Markdown 纯文本，Git-Ready)
    ├── learnings/                  # 避坑指南与排错经验 (kb-<id>.md)
    ├── decisions/                  # 架构与设计决策 (kb-<id>.md)
    └── solutions/                  # 通用方案与模板代码 (kb-<id>.md)
```

### 5.2 存储加速层与并发防御 (`index.db`)
- SQLite 强制启用 `PRAGMA journal_mode = WAL;` 与 `PRAGMA busy_timeout = 5000;`，彻底避免多进程 `SQLITE_BUSY` 锁死。
- `knowledge_fts` 采用 **`trigram` (三元分词器)**，原生支持中文无空格分词、英文实体词与代码段混合的高速 BM25 检索。

---

## 6. 前沿扩展：轻量级实操因果知识图谱 (Experience Graph)

> **设计宗旨**：不做沉重复杂的代码 AST 语法树分析，专注沉淀**“技术环境、报错现象、关键参数与解法的因果关联网络”**。让 Agent 具备“顺藤摸瓜”的多跳推理能力。

### 6.1 为什么需要实操知识图谱？（多跳因果联想）
- **单点全文检索的局限**：
  若历史卡片记录的是 `Alpine 下缺少 glibc 导致 sharp 报错，正解是安装 libc6-compat`。
  当新项目里用 Alpine 跑 `grpcio` 遇到动态库报错时，搜 `grpcio` 全文检索结果为 0，依然重新踩坑。
- **因果图谱的破局**：
  通过三元组边关系：`[grpcio] -(依赖)-> [glibc] <-(缺少)- [Alpine] -(安装解决)-> [libc6-compat]`。
  Agent 顺着图谱 2 跳（2-Hop）关联，即便从未记录过 `grpcio`，也能瞬间发现根因在于 Alpine 缺少 glibc，并直接给出安装 `libc6-compat` 的正解！

### 6.2 零外部依赖的 SQLite 图存储契约
坚决拒绝引入 Neo4j 等独立图数据库，直接在本地 `~/.exobrain/index.db` 内建轻量图拓扑表：

```sql
-- 1. 实体表 (Entity Node)
CREATE TABLE IF NOT EXISTS graph_entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,          -- 如: "Alpine", "glibc", "libc6-compat", "HTTP-403"
    entity_type TEXT NOT NULL           -- "env" | "lib" | "error" | "solution" | "param"
);

-- 2. 因果边表 (Directed Relation Edge)
CREATE TABLE IF NOT EXISTS graph_relations (
    source_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,        -- "lacks" | "depends_on" | "solves" | "conflicts_with"
    target_id TEXT NOT NULL,
    card_id TEXT NOT NULL,              -- 关联回 Markdown 知识卡片
    PRIMARY KEY (source_id, relation_type, target_id, card_id)
);
```

### 6.3 递归图遍历与多跳唤醒 (Multi-hop Recall via Recursive CTE)
利用 SQLite 原生内置的 `WITH RECURSIVE` 递归公用表表达式，在 **0.5 毫秒内**完成深度为 2~3 跳的因果网络查询：

```sql
WITH RECURSIVE graph_walk(current_id, depth, path) AS (
    SELECT id, 0, name FROM graph_entities WHERE name = :seed_entity
    UNION ALL
    SELECT r.target_id, gw.depth + 1, gw.path || ' -> ' || r.relation_type || ' -> ' || e.name
    FROM graph_relations r
    JOIN graph_walk gw ON r.source_id = gw.current_id
    JOIN graph_entities e ON r.target_id = e.id
    WHERE gw.depth < 2
)
SELECT DISTINCT path FROM graph_walk;
```

### 6.4 双向双链语法兼容 ([[WikiLinks]] / Obsidian 兼容)
在 Markdown 卡片正文与 Frontmatter 中原生支持双链：
```markdown
## 根本原因
[[Alpine]] 基础镜像基于 musl libc，而预编译的 [[sharp]] 依赖 [[glibc]]。

## 经过验证的正解
安装 [[libc6-compat]] 解决动态链接缺失。
```
- **人类可读**：用 Obsidian 打开 `~/.exobrain/vault/` 直接呈现震撼的知识星空连线图；
- **机器解析**：正则提取 `\[\[(.*?)\]\]` 自动沉淀为图谱节点，零额外解析开销。

---

## 7. 后期展望与演进路线图 (Roadmap)

在当前 MVP 完备验证的基础上，ExoBrain 下一阶段演进规划如下：

### 7.1 规划一：轻量因果图谱引擎落地 (Experience Graph Engine)
- 在 MCP 中扩展 `exo_explore_graph(entity, max_hops)` 工具；
- CLI 增加 `exo graph <entity>` 命令，以字符 ASCII 树直接打印实操因果拓扑；
- 实体同义词归一化（如 `nodejs` 与 `node.js` 自动映射同一节点）。

### 7.2 规划二：两级空间与开放自定义分类 (Workspace $\rightarrow$ Custom Taxonomy)
- **L1 项目工作区隔离**：自动根据 session 物理目录映射到 `workspaces/<project_name>/`；
- **L2 开放分类与三层决策漏斗**：
  1. *用户显式指定*：用户说“/know 归类到赛事技巧”，100% 遵从；
  2. *项目配置覆盖*：工程根目录支持 `.exobrain.json`，自定义分类清单（如：*赛事技巧、参数配方、环境暗坑、接口联调*）；
  3. *Agent 语义分诊*：默认由 Agent 识别内容属性自动分流。

### 7.3 规划三：知识跨机漫游 (Git-Backed Vault Sync)
- 借鉴 `spolom/memory-mcp` 的 Git 同步精髓；
- 将 `~/.exobrain/vault/` 自身作为本地 Git 仓库，提供 `exo sync` 自动 `git pull --rebase` 与 `git push`，办公室台式机与笔记本无缝同步。

### 7.4 规划四：时间半衰期与常青标记 (Temporal Decay & Evergreen)
- 借鉴 `adamrdrew/agent-memory-mcp` 的衰减算法；
- 排错经验随时间自动衰减（半衰期设为 30 天，老旧环境问题检索权重自动后移）；
- 关键成功经验与核心参数配方支持打上 `evergreen: true`，永久锁定最高召回优先级。

### 7.5 规划五：工作轨迹轻量盘点与案卷报表 (Workplace Ledger & Digest)
- 提供 `exo export --project <name> --format table`，一键在终端输出该项目沉淀的实操足迹；
- 支持导出为 CSV 格式，作为团队排错案例库（Issue Registry）进行复盘分析。

---

## 8. 当前工程交付资产与质量基线

当前仓库已全部完成工程落地与提交：
- **核心模块**：
  - `src/core/`：存储、配置与脱敏管道
  - `src/adapters/`：多态适配器层（OpenCode 已实战验证，Cursor 已提供插槽）
  - `src/pipeline/`：知识萃取与离线扫描调度服务
  - `src/interfaces/`：Stdio MCP Server 与开发者终端 CLI
- **自动化测试套件**：
  - `npm test`：包含 Layer 1~Layer 4 的 4 个独立单元测试与 E2E 连通性测试，**100% 绿灯通过**。
- **真实数据验证**：
  - 本地知识库已真实收录包括本工程故障修复、本地网关图像生成、Go 编译产物处理、充值账本设计等多篇真实沉淀资产，可随时查阅。
