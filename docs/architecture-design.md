# ExoBrain 完整架构设计与项目蓝图文档 (System Architecture & Roadmap)

> **版本**：v1.3 (Production Hardened & Full Lifecycle Blueprint)  
> **状态**：Approved / Baseline Established  
> **核心定位**：AI 编程与任务协作的原生知识外脑（免维护、散碎经验沉淀、跨场景秒级复用）

---

## 1. 项目本质哲学与核心目标 (Core Philosophy & Mission)

### 1.1 什么是 ExoBrain？（重新定义外脑的灵魂）
ExoBrain **坚决不做**大而全的项目官方架构文档生成器，也**不做**代码仓库的变更日志（Changelog）管理器——那些本应由 Agent 在项目内部自行完成。

ExoBrain 的唯一使命，是充当开发者与各类 AI Agent（OpenCode、Cursor、Claude Code 等）身后的**【实操经验随身锦囊 / 散碎暗知识蓄水池 (Pocket Playbook)】**：
- **不求宏大完整，但求零碎可用**；
- 专门收录那些**“不大不小、写进官方 Wiki 嫌太碎、不记下来下次遇到又得重新抓瞎”**的实操经验、野路子技巧、特殊参数配方与环境暗坑；
- 让每一次在某个特定会话、特定项目或赛事中“好不容易跑通的宝贵经验”，沉淀为不可丢失的原子资产。

### 1.2 解决的三大核心痛点场景
1. **跨项目 / 跨赛事的“成功经验迁移”（复制成功）**：
   - *痛点*：在“赛事 A”花了 3 小时调试通的评测脚本与参数组合，两周后切换到“赛事 B”，Agent 又从零试错、反复踩坑。
   - *外脑价值*：直接问 Agent：“*查查上次在赛事 A 里是怎么跑通的？*”，Agent 1 秒唤醒卡片，提取核心参数与启动命令，直接照猫画虎成功复现。
2. **工作轨迹与关键改动的“快速回溯盘点”（足迹梳理）**：
   - *痛点*：时隔一个月重新接手某个 Workspace，代码改动繁杂，人脑完全失忆：“*我之前在这个项目里到底改了哪些关键逻辑？跑通过哪些尝试？*”
   - *外脑价值*：一行命令 `exo list --project <name>`，毫秒级吐出该项目下沉淀的 5~10 条关键实操卡片，30 秒找回全部上下文记忆。
3. **值班排障与非标技巧的“一招制敌”（防重复排查）**：
   - *痛点*：数字人或值班 Agent 天天帮人排查问题，遇到相同的偶发报错（如特定环境下的 403 封禁、glibc 缺失、npm 语法死锁），每次都重新推导半小时。
   - *外脑价值*：第一次排查完自动入库，后续任何人遇到相同问题，数字人秒级命中历史卡片，直接给出经过验证的正解。

---

## 2. 系统四层解耦架构 (Layered Architecture)

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

## 3. 双轨知识获取运行机制

### 3.1 主动直通机制（核心主路径：RPC 内存直通）
- **触发入口**：用户在任何支持 MCP 的 Agent 中输入 `/know`、`/save` 或说“记录一下刚才跑通的参数/踩坑”。
- **模型推理**：宿主 Agent 基于当前受热的完整会话上下文，提炼出 25 字标准标题与结构化卡片参数。
- **安全脱敏管道 (Secret Scrubbing)**：
  MCP Server 收到参数后，**强制经过正则脱敏器**（清洗常见 AK/SK、JWT、Bearer Token、私钥、密码），替换为 `***REDACTED***`。
- **协议入库**：直接以原子方式落盘 Markdown 并写入 SQLite FTS5 索引，返回 `{ success: true, id: "kb-xxxx" }`，耗时 <10ms，**坚决不读 IDE 本地数据库，绝对安全稳定**。

### 3.2 被动离线增量扫描（安全兜底路径）
- **防 Fork 炸弹隔离**：扫描 SQL 强制排除 `parent_id IS NOT NULL` 与特定前缀，绝不递归提炼派生会话。
- **状态机与悲观锁**：`session_tracking` 维护 `PENDING` $\rightarrow$ `EXTRACTING` $\rightarrow$ `EXTRACTED` / `SKIPPED` / `FAILED`，带 180s 租约锁，保证单会话只处理一次，支持随时重跑与增量顺延。
- **进程树治理**：对无头回唤进程引入 120 秒硬超时和 `taskkill /T /F` 级联清理，杜绝 Windows 孤儿进程与端口泄漏。

---

## 4. 存储模型与物理契约 (Storage Design)

### 4.1 物理目录布局 (`~/.exobrain/`)
```text
~/.exobrain/
├── config.json                     # 全局配置
├── index.db                        # SQLite 数据库（WAL 模式，元数据、FTS5、状态机）
└── vault/                          # 知识真理唯一来源 (Markdown 纯文本，Git-Ready)
    ├── learnings/                  # 避坑指南与排错经验 (kb-<id>.md)
    ├── decisions/                  # 架构与设计决策 (kb-<id>.md)
    └── solutions/                  # 通用方案与模板代码 (kb-<id>.md)
```

### 4.2 L2 知识卡片格式规范 (Markdown + YAML Frontmatter)
物理文件统一命名为：`~/.exobrain/vault/<category>/kb-<nanoid>.md`：
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

### 4.3 中英双语检索加速层 (`index.db`)
- SQLite 强制启用 `PRAGMA journal_mode = WAL;` 与 `PRAGMA busy_timeout = 5000;`，彻底避免多进程 `SQLITE_BUSY` 锁死。
- `knowledge_fts` 采用 **`trigram` (三元分词器)**，原生支持中文无空格分词、英文实体词与代码段混合的高速 BM25 检索。

---

## 5. 后期展望与演进路线图 (Roadmap)

在当前 MVP 完备验证的基础上，ExoBrain 下一阶段演进规划如下：

### 5.1 规划一：两级空间与开放自定义分类 (Workspace $\rightarrow$ Custom Taxonomy)
- **目标**：彻底打破死板的枚举分类，实现“项目天然隔离 + 分类随心所欲”。
- **两级空间模型**：
  - **L1 项目工作区隔离**：自动根据 session 的物理目录映射到 `workspaces/<project_name>/`；
  - **L2 开放分类与三层决策漏斗**：
    1. *用户显式指定*：用户说“/know 归类到赛事技巧”，100% 遵从；
    2. *项目配置覆盖*：工程根目录支持 `.exobrain.json`，自定义本项目的专属分类清单（如：*赛事技巧、参数配方、环境暗坑、接口联调*）；
    3. *Agent 语义分诊*：默认由 Agent 识别内容属性自动分流。

### 5.2 规划二：知识跨机漫游 (Git-Backed Vault Sync)
- **借鉴开源生态**：吸收 `spolom/memory-mcp` 的 Git 同步精髓。
- **落地方案**：
  - 将 `~/.exobrain/vault/` 自身作为本地 Git 仓库；
  - 提供 CLI 命令 `exo sync`（或随 Agent 启动静默触发），执行 `git pull --rebase` 与 `git push`；
  - 开发者在办公室台式机调试通的技巧，回家打开笔记本电脑直接无缝继承！

### 5.3 规划三：时间衰减与常青标记 (Temporal Decay & Evergreen)
- **借鉴开源生态**：吸收 `adamrdrew/agent-memory-mcp` 的衰减算法。
- **落地方案**：
  - 排错经验随时间自动衰减（半衰期设为 30 天，老旧环境问题检索权重自动后移）；
  - 关键成功经验与核心参数配方支持打上 `evergreen: true`（常青标记），永久锁定最高召回优先级。

### 5.4 规划四：工作轨迹轻量盘点与案卷报表 (Workplace Ledger & Digest)
- **目标**：方便人类和数字人管理者纵览“之前到底做过了什么”。
- **落地方案**：
  - 提供 `exo export --project <name> --format table` 命令，一键在终端以优雅的 Markdown Table 输出该项目沉淀的实操足迹；
  - 支持导出为 CSV 格式，作为团队排错案例库（Issue Registry）进行复盘分析。

---

## 6. 当前工程交付资产与质量基线

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
