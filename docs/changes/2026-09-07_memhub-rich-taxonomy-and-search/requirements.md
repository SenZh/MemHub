# 需求规格：MemHub 高度抽象三分类与精准工程长效记忆模型

## 1. 业务痛点与用户原始诉求
在经过多轮深度推演与用户审查后，确认当前系统的核心矛盾：
1. **分类过度碎片化 vs 抽象高度**：
   - 曾尝试扩展至 7 类（domain, topology, contract, capacity, troubleshoot, decision, rule 等），被用户严厉指出“太细、没有必要、认知负担重”；
   - 必须将工程暗知识高度收敛为人类与 Agent 毫无犹豫的 **3 大顶级正交分类**：
     - **`learnings`（排错与避坑）**：面向过去，现实偏离预期的故障与问题怎么解；
     - **`decisions`（架构决策与ADR）**：立足当下，为什么这么做、放弃了什么备选、不可推翻的硬红线；
     - **`patterns`（范式与模板）**：面向未来，经过验证的生产级标准代码/配置骨架与套路。
2. **要素不全导致“半拉子废纸”**：
   - 用户明确指出：`learnings` 之前严重缺失**问题业务背景**，只贴报错日志未来人接手根本不知道在干什么；
   - 每一个分类内部必须清清楚楚、明明白白定义**专属的结构化要素清单**，彻底消灭“千篇一律扁平字段”导致的上下文信息蒸发。
3. **查询维度必须支持 Workspace 与 Tags 过滤**：
   - 检索时不能全局混杂，必须支持根据 **`project`（工作区，当前项目+全局穿透）** 与 **`tags`（客观技术实体标签）** 进行毫秒级精准过滤；
   - 存时自动从当前 Git/工程清单推导 workspace，tag 强制提取客观代码实体；
   - 查时默认自动绑定当前工作区，tag 编入 FTS5 倒排索引支持可选收窄与全文兜底。
4. **彻底剔除“学术过度设计（证据链毒药）”**：
   - 经审查与用户确认，彻底废除 AST 语法树哈希比对、Git Commit 快照对齐、正文行级论文式角标 `[1][2]` 等学术自嗨产物；
   - 确立“已入库即信任真理”原则，仅保留极轻量的人类可读软引用（`related_files` 与 `id`）。

---

## 2. 量化验收指标 (Acceptance Criteria)

### AC-1: 高度抽象三大分类契约
- 系统核心分类严格收敛为：`learnings`, `decisions`, `patterns`（兼容历史 `solutions` 别名映射为 `patterns`）；
- 存储层与 MCP 工具层入参严格支持并校验这三大分类。

### AC-2: 各分类内部要素完整性 (Rich Schema)
- **`learnings`** 必须包含：业务背景与触发动作 (`context`)、现象与报错堆栈 (`symptom`)、底层机制因果 (`root_cause`)、验证正解代码与步骤 (`solution`)、排除误区清单 (`ineffective_attempts`)、验证自测与防复发门禁 (`prevention`)；
- **`decisions`** 必须包含：业务痛点背景 (`context`)、改动细节与影响面 (`impact`)、备选方案及放弃理由 (`alternatives`)、最终裁决与妥协代价 (`decision`)、数据迁移与回滚 (`migration`)、不可触碰红线 (`guardrails`)；
- **`patterns`** 必须包含：适用场景与痛点 (`scenario`)、前置运行环境与依赖 (`prerequisites`)、核心时序与机制 (`mechanism`)、生产级完整代码/配置 (`implementation`)、边界与反模式 (`boundaries`)、自测验证用例 (`verification`)。

### AC-3: Workspace 与 Tags 检索过滤与 MCP 工具命名体系升级
- **MCP 核心工具名全面升级为 `memhub_*`**：
  - `memhub_search`：搜索记忆索引（L1 极简摘要）；
  - `memhub_get`：按需展开记忆正文与代码（L2 详情）；
  - `memhub_save`：沉淀并保存长效记忆；
  - `memhub_recent`：查看最近记忆轨迹；
  - （底层对 `hub_*_knowledge` 与 `exo_*` 实施完全向后兼容）；
- `memhub_search`（MCP）与 `memhub find`（CLI）支持 `project`（或 `workspace`）与 `tags`（数组或单值）过滤；
- 查询逻辑：
  - 若指定 `project`：仅返回 `(k.project = ? OR k.project = 'global')` 的有效知识；
  - 若指定 `tags`：仅返回命中全部指定标签的记录；
- CLI `memhub find` 增加 `--project / -w` 与 `--tag / -t` 参数解析；
- 保持两阶段渐进式披露协议（L1 极简摘要 25~45 字 $\to$ L2 展开详情）。

### AC-4: 宿主提炼引擎与 Prompt 彻底重构
- 彻底废弃 `src/pipeline/extractor.js` 中的硬编码 `if-else` 与 `slice(0, 150)` 粗暴切片；
- 落地标准结构化 Extraction System Prompt，严格依照三大分类专属要素生成标准卡片；
- 实施终态成功物理证据校验（Truth Verification Gate：退出码 0、测试通过、日志明确）。

### AC-5: 质量保障
- 现有测试用例全量兼容升级；
- 编写专项测试验证：三大分类结构化落盘、Workspace 隔离与全局穿透、Tags 精确过滤、渐进式检索；
- 自动化测试套件保持 100% 绿灯。
