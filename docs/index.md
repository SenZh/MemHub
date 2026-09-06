# MemHub 项目文档索引 (Documentation Index)

## 1. 项目定位
MemHub 是专为 AI 编程与软件工程设计的**工程长效记忆与暗知识调度中枢（Unified Memory & Knowledge Hub）**，面向任意 AI Agent（OpenCode、Cursor、Claude Code、Codex 等不限工具）。
通过将开发者与 Agent 交互中产生的架构权衡决策（ADR）、隐性业务潜规则、排错根因因果链与关键配置配方结构化沉淀为原子长效资产，彻底消灭“跨会话人肉翻历史记录”和“反复踩同一个坑”的痛点。
核心差异化：**借宿主 Agent 算力提炼（0 外部 API）+ 专注高密度工程决策与排错因果 + 单文件 SQLite 工业内核与 VACUUM 热备 + 两阶段渐进式披露 MCP 协议 + 灵活路径 include/exclude 规则**。

## 2. 核心文档清单
- [目标差距分析与演进计划书 (Roadmap & Progress)](./roadmap-and-progress.md)：当前 v0.1.0 已完成模块、全量设计目标差距对比（Gap Analysis）、GitHub 仓库准备与演进路线。
- [需求规格与系统边界 (Requirements & Boundaries)](./requirements-and-boundaries.md)：核心定位、价值密度原则、两级空间、代码物理图谱（CodeGraph）与经验记忆双轮驱动模型、功能矩阵 FR-1~3。
- [完整架构与演进蓝图 (System Architecture & Roadmap)](./architecture-design.md)：业界 10+ 开源项目深度对标（Mem0/Zep/claude-mem/Cline Memory Bank/腾讯 CodeGraph）、单文件 SQLite 物理分层存储模型、双阶段渐进式披露协议、离线扫描状态机。

## 3. 核心设计原则
1. **价值密度**：只记有长期复用价值的实操暗知识与架构决策，拒绝记录低价值的操作流水账。
2. **渐进式披露 (Progressive Disclosure)**：检索阶段只查 L1 极简索引摘要（~30-50 Tokens），并在 Payload 中提示引导；详情阶段按需拉取 L2/L3 深度代码块，彻底解决 Token 爆炸。
3. **单文件 SQLite 工业内核**：以单文件 SQLite（`memory.db`）为运行期核心真理源，自带 WAL 事务一致性与 FTS5 倒排索引，原生支持 `VACUUM INTO` 无损归档；Markdown 作为人类友好导出格式（按需导出）。
4. **两级空间与路径治理**：全局空间 + 项目空间自动识别；支持用户自定义配置静默时间阈值与 `watchDirectories`、`include`、`exclude` 规则。
5. **借宿主算力**：绝不强迫用户配置第三方大模型 Key，复用宿主环境已配置的模型与 Prompt Cache。
6. **不锁工具**：MCP（标准读写）+ AGENTS.md（注入标准）双开放通道。

## 4. 文档维护规约
- 文档与实现严格对齐：未落地的能力必须在 `roadmap-and-progress.md` 标注状态，禁止虚报进度。
- 开发必须严格按照三阶段工作流（Phase 1 设计双审 $\rightarrow$ Phase 2 代码测试双审 $\rightarrow$ Phase 3 自检总结）执行。
