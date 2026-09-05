# ExoBrain 项目文档索引 (Documentation Index)

## 1. 项目定位
ExoBrain 是一个专为 AI 编程与实操任务设计的**实操经验锦囊（Pocket Playbook）与散碎暗知识外脑**，面向任意 AI Agent（OpenCode、Cursor、Claude Code、Codex、Workbuddy Code、BodhiQ 等不限工具）。
通过将开发者与 Agent 交互中产生的散碎暗知识、排错经验与关键参数配方无感提炼为结构化原子知识，彻底消灭"跨会话人肉翻历史记录"和"反复踩同一个坑"的痛点。
核心差异化：**借宿主 Agent 算力提炼（0 外部 API）+ 只记高价值实操知识 + 全局/项目两级记忆隔离 + MCP 与 AGENTS.md 双开放标准集成**。

## 2. 文档清单
- [需求规格与系统边界 (Requirements & Boundaries)](./requirements-and-boundaries.md)：核心定位、价值密度原则、两级记忆空间、做与不做的清单、功能矩阵 FR-1~3（v1.2，含业界对标后的边界重校）。
- [完整架构与演进蓝图 (System Architecture & Roadmap)](./architecture-design.md)：业界深度对标（Mem0 v3/Zep/Letta/Basic Memory/mcp-memory-service/claude-mem）与自审、四层解耦架构修订版、MCP + AGENTS.md 双集成通道、两级存储模型、混合检索设计、"借宿主算力"结构性天花板诚实声明、P0~P2 路线图（v2.0）。

## 3. 核心设计原则
1. **价值密度**：只记有长期复用价值的实操暗知识，拒绝全量记录（业界全记录方案的膨胀噪声教训）。
2. **两级空间**：全局层 + 项目层隔离，写入默认项目级，检索项目优先、全局兜底。
3. **借宿主算力**：绝不强迫用户配置第三方大模型 Key，利用原 Agent 的上下文与 Prompt Cache；结构性天花板已明确划定（架构文档 §7）。
4. **不锁工具**：MCP（读写）+ AGENTS.md（注入，Linux 基金会 AAIF 标准）双开放标准通吃任意 agent；hooks 自动提取为可选增强，绝不构成依赖。
5. **站在开源肩膀上**：存储格式采用 Basic Memory 验证语法、混合检索采用 mcp-memory-service 验证方案；自研收缩为提炼管道、领域 schema、脱敏管道三件全行业空白。
6. **文件即契约**：纯本地 SQLite FTS5 + 结构化 Markdown 真理源，索引可全量重建，Obsidian 兼容。

## 4. 文档维护规约
- 文档与实现严格对齐：未落地的能力必须标注状态，禁止"宣称已完成"（v1.4 教训，见架构文档 §9）。
- 重大边界变更须经业界对标论证后落盘（对标记录保留在架构文档 §2）。
