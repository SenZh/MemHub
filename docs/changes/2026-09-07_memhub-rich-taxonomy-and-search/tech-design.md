# 技术方案设计：高度抽象三分类、结构化要素与多维检索过滤 (v1.1 修订版)

## 1. 架构定位与设计哲学
本设计解决 MemHub 当前三大痛点：
1. **分类过度碎片化**：收敛为三大高度抽象的顶级分类 `learnings`、`decisions`、`patterns`，将分类作为“内部模板路由器（Template Router）”；
2. **要素残缺半拉子**：通过结构化分层模型，针对每个分类提供专属的核心字段与完整上下文，绝不再让业务背景与排查误区蒸发；
3. **检索隔离与实体收窄**：打通 `project`（工作区，当前私有 + global 穿透）与 `tags`（客观代码实体标签）两大多维过滤通道。

---

## 2. 核心架构与数据流图

```
                  ┌──────────────────────────────────────────────────────────┐
                  │                 AI Agent / 人类 CLI 交互层               │
                  └─────────────────────────────┬────────────────────────────┘
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 ▼ (写入：内部路由)                                             ▼ (查询：多维过滤)
    hub_record_knowledge                                         hub_search_knowledge
    [title, category, tags, context,                             [query, project, tags,
     category_payload, ...]                                       category, limit]
                 │                                                             │
                 ▼                                                             ▼
     【内部模板路由与校验】                                            【多维过滤引擎】
    • learnings ──► 业务背景+报错+根因+正解+误区+防复发                 • 实体倒排全文检索 (FTS5 Trigram)
    • decisions ──► 背景+改动影响+备选放弃+裁决妥协+红线               • (k.project = ? OR k.project = 'global')
    • patterns  ──► 场景+依赖+时序+代码骨架+边界+自测                  • 多标签交集参数化过滤
                 │                                                             │
                 └──────────────────────────────┬──────────────────────────────┘
                                                ▼
                             【单文件 SQLite 内核 (memory.db)】
                              • knowledge_items (物理字段+结构化JSON)
                              • DDL 热迁移自愈 (PRAGMA + ALTER TABLE)
                              • knowledge_fts (FTS5 全文倒排虚拟表)
                              • session_tracking (离线提炼状态机)
```

---

## 3. 详细模块设计与实现规范

### 3.1 核心分类收敛与兼容映射 (`src/config.js`)
- **默认三大分类常量**：
  ```javascript
  export const DEFAULT_CATEGORIES = ['learnings', 'decisions', 'patterns'];
  ```
- **输入别名规范化函数 (`normalizeCategory`)**：
  - `solutions` $\to$ `patterns`；
  - `gotchas` / `pitfall` $\to$ `learnings`；
  - `adr` / `rule` / `rules` $\to$ `decisions`。
  任何进入系统的 `category` 统一归一化为三大合法值。

---

### 3.2 存储模型与 DDL 迁移自愈机制 (`src/storage.js`)

#### (1) DDL 自动热迁移与老库自愈 (P0 修复)
在 `getDatabase()` 初始化时，通过 `PRAGMA table_info` 探测物理列，若老库缺少新字段，自动执行平滑迁移并执行存量数据别名纠偏：
```javascript
function runMigrations(db) {
  const columns = db.prepare("PRAGMA table_info(knowledge_items)").all();
  const colSet = new Set(columns.map(c => c.name));

  // 1. 动态补充新物理字段
  if (!colSet.has('context_text')) {
    db.exec("ALTER TABLE knowledge_items ADD COLUMN context_text TEXT;");
  }
  if (!colSet.has('extra_payload')) {
    db.exec("ALTER TABLE knowledge_items ADD COLUMN extra_payload TEXT;");
  }

  // 2. 存量分类数据幂等刷写 (解决旧 solutions 查询隔离断裂)
  db.exec("UPDATE knowledge_items SET category = 'patterns' WHERE category = 'solutions';");
}
```

#### (2) 物理列与分类专属要素映射矩阵 (P0 修复)
系统采用【通用物理核心列 + 专用文本列 + JSON 扩展列】的混合存储模型：

| 逻辑要素名 | 物理存储列 | 适用分类与含义 |
| :--- | :--- | :--- |
| **`title`** | `title TEXT` (已索引) | 通用：25~45 字高密度语义强指纹 `[技术/模块] 场景 -> 结论` |
| **`category`** | `category TEXT` | 通用：`learnings` \| `decisions` \| `patterns` |
| **`project`** | `project TEXT` | 通用：工作区名称或 `global` |
| **`tags`** | `tags TEXT` (JSON 数组) | 通用：客观技术实体标签（自动小写归一） |
| **`context`** | `context_text TEXT` | 通用：业务操作背景 / 痛点驱动 / 适用场景 |
| **`summary`** | `summary TEXT` | 通用：L1 阶段返回给大模型的极简摘要（~50 Tokens） |
| **`root_cause` / `rationale`** | `root_cause TEXT` | `learnings`：技术因果链；`decisions`：架构裁决理由 |
| **`solution` / `implementation`** | `solution_core TEXT` | `learnings`：修复代码；`patterns`：标准代码骨架 |
| **`extra_payload`** | `extra_payload TEXT` (JSON) | 细化分类专有高阶要素（见下表） |

**`extra_payload` 内部 JSON 结构规范**：
- **`learnings`**：
  ```json
  {
    "symptom": "原始报错堆栈与日志字面量",
    "ineffective_attempts": ["已排除的无效尝试A", "已排除的无效尝试B"],
    "prevention": "防复发单测用例与监控告警指标"
  }
  ```
- **`decisions`**：
  ```json
  {
    "impact": "受影响微服务模块拓扑面与数据表清单",
    "alternatives": [{"option": "方案A", "why_rejected": "枪毙理由"}],
    "migration": "新老数据平滑迁移方案与回滚策略",
    "guardrails": ["绝对不可违反的设计红线"]
  }
  ```
- **`patterns`**：
  ```json
  {
    "prerequisites": "前置环境要求与依赖库版本树",
    "mechanism": "核心时序交互图或执行流程机制",
    "boundaries": "适用边界与反模式 (什么时候严禁使用)",
    "verification": "自测验证与压测并发用例代码"
  }
  ```

---

### 3.3 多维检索过滤算法规范 (`src/storage.js` -> `searchKnowledge`) (P1 修复)

查询构造支持动态条件拼接，完美兼顾 **FTS5 全文召回 + 工作区隔离与全局穿透 + 标签多值交集 AND 过滤**：

#### (1) 动态 SQL 生成规范
```javascript
export function searchKnowledge(query, options = {}) {
  const db = getDatabase();
  const limit = options.limit || 5;
  const rawCat = options.category ? normalizeCategory(options.category) : null;
  const project = options.project || options.workspace || null;
  const rawTags = Array.isArray(options.tags) ? options.tags : (options.tags ? [options.tags] : []);
  const cleanTags = rawTags.map(t => String(t).trim().toLowerCase()).filter(Boolean);

  const conditions = ["k.status = 'active'"];
  const params = [];

  // 1. 分类过滤
  if (rawCat) {
    conditions.push("k.category = ?");
    params.push(rawCat);
  }

  // 2. 工作区隔离 (当前工作区 + global 穿透)
  if (project) {
    conditions.push("(k.project = ? OR k.project = 'global')");
    params.push(project);
  }

  // 3. 多标签交集 (AND 逻辑，支持多个 tag 参数化)
  cleanTags.forEach(tag => {
    conditions.push("EXISTS (SELECT 1 FROM json_each(k.tags) WHERE value = ?)");
    params.push(tag);
  });

  // ... 结合 FTS5 MATCH 或 LIKE 模糊查询拼装完整 SQL
}
```

---

### 3.4 渐进式第二阶段：分类专属 Markdown 渲染 (`getKnowledge`) (P1 修复)

当 Agent 调用 `hub_get_knowledge(id)` 或命令行执行 `memhub get <id>` 展开详情时，服务端按分类专属模板拼装高清 Markdown：

- **`learnings` 模板**：
  ```markdown
  # [标题同 L1]
  > 分类: learnings | 项目: {project} | 标签: {tags}

  ### 🎯 业务操作背景
  {context_text}

  ### 💥 异常表象与错误签名
  {symptom}

  ### 🔬 技术根因剖析 (5-Whys)
  {root_cause}

  ### 🛠️ 经过验证的真实正解
  {solution_core}

  ### 🚫 已排除的误区与无效尝试 (防后人重踩)
  {ineffective_attempts}

  ### 🛡️ 验证手段与防复发门禁
  {prevention}
  ```

- **`decisions` 模板**：
  ```markdown
  # [标题同 L1]
  > 分类: decisions | 项目: {project} | 标签: {tags}

  ### 📌 业务与技术痛点背景
  {context_text}

  ### 🌐 受影响拓扑面与改动细节
  {impact}

  ### ⚖️ 备选方案及其放弃理由 (Why Not X?)
  {alternatives}

  ### 🏛️ 最终裁决与妥协代价 (Trade-offs)
  {root_cause} (裁决核心理由)
  {solution_core} (核心架构改动契约)

  ### 🔄 平滑迁移与回滚方案
  {migration}

  ### ⛔ 不可触碰的架构红线 (Guardrails)
  {guardrails}
  ```

- **`patterns` 模板**：
  ```markdown
  # [标题同 L1]
  > 分类: patterns | 项目: {project} | 标签: {tags}

  ### 🎯 业务应用场景与解决痛点
  {context_text}

  ### 📦 前置依赖与运行环境
  {prerequisites}

  ### ⚙️ 核心交互时序与机制
  {mechanism}

  ### 💻 生产级完整参考实现代码
  {solution_core}

  ### ⚠️ 适用边界与反模式 (什么时候别用)
  {boundaries}

  ### 🧪 自测验证与压测用例
  {verification}
  ```

---

### 3.5 MCP 工具契约与命名体系升级规范 (`src/index.js`)

#### (1) 命名体系全面升级为 `memhub_*`
彻底消除“插件叫 MemHub，工具叫 knowledge”的认知断层，确立统一的 4 大标准工具命名：
- **`memhub_save`**：主动沉淀长效工程记忆；
- **`memhub_search`**：两阶段渐进式检索第一阶段（~50 Tokens 强指纹摘要）；
- **`memhub_get`**：两阶段渐进式检索第二阶段（展开高清 Markdown 记忆正文与代码）；
- **`memhub_recent`**：最近沉淀记忆轨迹速览。

#### (2) 向后兼容映射规范
底层注册时，保持对历史别名的隐式透传：
- `hub_record_knowledge` / `exo_record_knowledge` $\to$ `memhub_save`
- `hub_search_knowledge` / `exo_search_knowledge` $\to$ `memhub_search`
- `hub_get_knowledge` / `exo_get_knowledge` $\to$ `memhub_get`
- `hub_list_recent` / `exo_list_recent` $\to$ `memhub_recent`

#### (3) 标准入参 Schema
在 `memhub_save` 中，入参 Schema 完整支持三大分类专属字段：
```javascript
{
  name: 'memhub_save',
  description: '【主动长效记忆沉淀】当攻克了排错避坑(learnings)、做出关键架构决策(decisions)、或沉淀出最佳实践模板(patterns)时调用。必须包含业务操作背景(context)与验证通过的解决方案(solution)。支持前置查重与版本替换。严禁记录未经验证的猜测。',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '25-45字高密度语义指纹: [技术/模块] 场景 -> 结论' },
      category: { type: 'string', enum: ['learnings', 'decisions', 'patterns'] },
      tags: { type: 'array', items: { type: 'string' } },
      context: { type: 'string', description: '业务背景/痛点背景/适用场景' },
      symptom: { type: 'string', description: '[learnings专用] 报错指纹与原始日志' },
      root_cause: { type: 'string', description: '[learnings/decisions专用] 底层根因或选型裁决理由' },
      solution: { type: 'string', description: '正解代码、架构改动代码或标准模板代码' },
      // 高阶专有字段
      ineffective_attempts: { type: 'array', items: { type: 'string' } },
      prevention: { type: 'string' },
      impact: { type: 'string' },
      alternatives: { type: 'array', items: { type: 'string' } },
      migration: { type: 'string' },
      guardrails: { type: 'array', items: { type: 'string' } },
      prerequisites: { type: 'string' },
      mechanism: { type: 'string' },
      boundaries: { type: 'string' },
      verification: { type: 'string' },
      related_files: { type: 'array', items: { type: 'string' } },
      project: { type: 'string' },
      supersedes: { type: 'string' }
    },
    required: ['title', 'category', 'tags', 'context', 'solution']
  }
}
```

---

### 3.6 提炼引擎重构与 Truth Verification Gate (`src/pipeline/extractor.js`) (P2 修复)

1. **真实性门禁（Truth Gate）判定协议**：
   在会话末尾逆向扫描物理成功证据：
   - 包含退出码 0、测试绿灯（`Tests passed`、`0 failed`）、服务就绪日志、或用户确认语句（`可以了/生效了/解决了`）；
   - 若不存在任何成功证据，或者仅为普通业务 CRUD，直接返回 `{ has_value: false }`，终止提取，零垃圾生成。
2. **逆向追踪有效改动**：
   从成功节点逆向追踪最后一次生效的代码变更作为 `solution`，将此前报错的尝试作为 `ineffective_attempts`。
