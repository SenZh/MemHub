# ExoBrain 项目文档索引 (Documentation Index)

## 1. 项目定位
ExoBrain 是一个专为 AI 编程场景设计的**免维护知识沉淀与即时检索外脑 (Self-Accumulating Knowledge Exobrain)**。
它通过将开发者与各类 AI Agent（如 OpenCode、Claude Code、Cursor 等）交互中产生的宝贵经验、踩坑记录与架构决策无感提炼为结构化原子知识，彻底消灭“跨会话人肉翻历史记录”和“反复踩同一个坑”的痛点。

## 2. 文档清单
- [需求规格与系统边界 (Requirements & Boundaries)](./requirements-and-boundaries.md)：定义系统的核心定位、要做与不做的清单、功能矩阵与非功能要求（v1.1）。
- [完整架构与详细系统设计 (System Architecture Document)](./architecture-design.md)：系统四层解耦架构（Adapters, Core, Pipeline, Interfaces）、三级存储模型、FTS5 Trigram 检索及 MCP 协议契约（v1.2）。

## 3. 核心设计原则
1. **知识而非任务**：专注沉淀可复用的 Know-how，坚决不做临时任务交接。
2. **复用宿主能力**：绝不强迫用户额外配置第三方大模型 Key，利用原 Agent 的上下文与 Prompt Cache。
3. **文件即契约**：纯本地 SQLite FTS5 + 结构化 Markdown，无沉重向量库依赖。
4. **四层解耦与独立测试**：各抽象层单一职责，均配有专属单元测试套件（`npm test` 自动化全量回归）。
