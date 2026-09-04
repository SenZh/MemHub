# ExoBrain 项目文档索引 (Documentation Index)

## 1. 项目定位
ExoBrain 是一个专为 AI 编程与实操任务设计的**免维护原生知识外脑（Self-Accumulating Knowledge Exobrain）与实操经验锦囊（Pocket Playbook）**。
它通过将开发者与各类 AI Agent（如 OpenCode、Claude Code、Cursor 等）交互中产生的散碎暗知识、排错经验与关键参数配方无感提炼为结构化原子知识，彻底消灭“跨会话人肉翻历史记录”和“反复踩同一个坑”的痛点。

## 2. 文档清单
- [需求规格与系统边界 (Requirements & Boundaries)](./requirements-and-boundaries.md)：定义系统的核心定位、要做与不做的清单、功能矩阵与非功能要求（v1.1）。
- [完整架构与演进蓝图 (System Architecture & Roadmap)](./architecture-design.md)：系统四层解耦架构、行业前沿（腾讯TencentDB-Agent-Memory等）对比、轻量因果图谱（Experience Graph）设计、三级存储模型及 MCP 协议契约（v1.4 终版）。

## 3. 核心设计原则
1. **知识而非任务**：专注沉淀散碎暗知识与实操 Know-how，坚决不做临时任务交接或官方大型架构文档。
2. **复用宿主能力**：绝不强迫用户额外配置第三方大模型 Key，利用原 Agent 的上下文与 Prompt Cache。
3. **文件即契约**：纯本地 SQLite FTS5 + 结构化 Markdown，无沉重外部向量库依赖。
4. **轻量因果图谱**：通过单 SQLite 递归查询实现实操因果顺藤摸瓜与多跳关联。
5. **四层解耦与独立测试**：各抽象层单一职责，均配有专属单元测试套件（`npm test` 自动化全量回归）。
