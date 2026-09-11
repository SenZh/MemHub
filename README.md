# MemHub

> **面向 AI 编程与软件工程的长期记忆与暗知识调度中枢 (The Unified Long-term Memory & Knowledge Hub for AI Coding Agents)**  
> 一次踩坑、全局免疫、永不遗忘。支持 OpenCode、Cursor、Claude Code 等任意支持 MCP 的 Agent。

---

## 🌟 为什么需要 MemHub？

在当下使用 AI Agent 进行软件工程开发时，普遍存在**知识资产蒸发**与**反复踩坑**的痛点：
- **知识蒸发**：花了几个小时攻克隐蔽环境 Bug、版本断层或敲定复杂架构决策，Session 一关就彻底淹没在历史聊天中，下次切换工具或新会话 Agent 依然“失忆”；
- **操作流水账噪音**：市面上的记忆插件多侧重于记录无脑的工具调用片段（`Observation`），排查一次问题产生几十条命令垃圾，信息噪音极大且吃爆 Context Window；
- **缺乏因果与决策建模**：通用记忆库仅存离散事实，无法表达**排错因果链（现象 $\rightarrow$ 根因 $\rightarrow$ 验证正解）**与**架构权衡决策（ADR / 业务潜规则）**。

**MemHub 不做操作录音机，做开发者的“工程认知与实操随身锦囊”。**

---

## 🚀 核心特性

- 🧠 **借宿主算力提炼（零 API Key 依赖）**：利用原会话自身上下文与模型参数执行知识抽取，吃 Prompt Cache 近乎零额外费用。
- 🕒 **后台常驻记忆提炼守护 (`memhub daemon`)**：
  - 常驻进程 `setInterval` 自循环，支持优雅退出信号（SIGINT/SIGTERM）；
  - **统一会话筛选与 Subagent 拦截**：统一基于 `isSubagentSession` 排除所有 `parentID` 存在、子智能体角色（`review`/`explore` 等）、派生子会话与抽取 fork 副本，仅聚焦主任务，直接节省 60% 无效推理算力；
  - **fork 副本抽取（原会话零污染）**：动态扫描端口与鉴权直连 OpenCode HTTP 服务，先 `POST /session/:id/fork` 复制原会话上下文（继承前缀 Prompt Cache），再向副本注入复盘指令；全程不写原会话，**会话排序与缓存完全不受影响**，无论成败均在 `finally` 中删除副本，配合 `(fork #N)` 标题特征拦截彻底杜绝套娃循环；
  - **双重时间窗口与防重**：只扫描最近 7 天内更新（`windowDays: 7`）且距现在超过 120 分钟静默稳定（`idleMinutes: 120`）的冷态会话，本地 SQLite `session_tracking` 表权威防重；
  - **配置热重载**：daemon 每轮 tick 重新读取 `config.json`，修改配置无需重启进程即可生效；
  - **无价值坚决不沉淀**：严格门禁，日常闲聊、简单查文件或未验证成果直接回复“无需沉淀”，禁止写入数据库；
  - **彻底废除离线死模板假抽取**：纯离线不凭空捏造假卡，只允许真实 LLM 提炼。
- 🔄 **存储层 Upsert 原地覆盖与同会话多卡沉淀**：
  - 基于 `session_id + category + topic_fingerprint` 为覆盖定位键；
  - 同一会话多次重复抽取时**原地 UPDATE 覆盖**，不产生版本堆积；
  - 同一会话同时包含排错与架构决策时，自动拆分为多张卡片分别独立落盘。
- 🔎 **双路混合检索与 RRF 排名融合 (Hybrid Search，终结词汇鸿沟)**：
  - **第一路（字符精确匹配）**：SQLite FTS5 Trigram 字符倒排索引，对类名、报错码、路径 100% 精确穿透；
  - **第二路（意图语义泛化）**：本地 384 维稠密向量空间（零外部依赖、零 API Key、CPU 毫秒级运算），让自然语言同义词与抽象场景不再漏检；
  - **倒数排名融合 (RRF)**：基于经典公式 $Score(d) = \sum \frac{1}{60 + Rank_m(d)}$ 无偏平滑合并两路结果并智能重排；
  - **零漏检保底**：若两路无召回，自动降级为 SQL `LIKE` 模糊匹配。
- ⚡ **单文件 SQLite 工业存储内核 + DDL 自愈**：
  - 核心数据存放在单文件 SQLite（`~/.memhub/memory.db`）中，自带 WAL 事务锁与 FTS5 倒排索引，杜绝多文件 I/O 碎片与并发写损坏；
  - 内置 DDL 热迁移自愈引擎，自动感知新字段与老库升级；
  - 原生支持 `VACUUM INTO` 无损热备份归档与一键导出 Obsidian 兼容的 Markdown 目录。
- 🧩 **三大纯中文核心资产分类与轻量自由正文**：
  - 彻底抛弃生硬死板的十几个碎字段表单，回归真实一线业务视角的三大核心支柱：
    - `排错避坑`（`learnings`）：线上/测试环境深层 Bug 排查因果链、推翻的误区与治本代码；
    - `业务知识`（`business`）：业务模块架构、状态机流转时序、计算口径与防资损红线；
    - `架构决策`（`decisions`）：技术选型对比、为什么选A放弃B (ADR)、系统重构与架构底线；
  - **轻量机读元数据 + 自由高密度 Markdown 正文**：结构化只保留标题、分类、标签与项目，正文 100% 自由展开（真实报错堆栈、推导逻辑、前后 Diff 代码、避坑红线），从物理根源上消灭“标准环境/结合业务评估”等假占位符八股文。
- 🎯 **工作区隔离与多标签交集检索**：
  - 支持 `(project = ? OR project = 'global')` 物理隔离无关项目，同时穿透全局通用经验；
  - 基于 SQLite 原生 `json_each` 实现标签多值交集（AND）参数化精准收窄。
- 🌙 **AI 做梦与记忆熔炼自省引擎 (`memhub dream`)**：
  - **离线睡眠反思**：由标准 5 段 Cron 表达式精确调度（默认每天凌晨 `0 3 * * *`），自动触发碎片交叉比对；内置**区间命中检测**，即使 daemon 轮询相位与整点错开也能可靠命中目标时刻；
  - **三维亲和度聚类**：融合 Tag Jaccard + File Overlap + 384 维向量余弦相似度，利用连通子图精准切分出 2~5 张卡片的高凝聚力做梦主题簇；
  - **架构师级提炼 Prompt**：指导宿主 LLM 抽象出通用因果律、识别设计冲突（Contradiction Radar），升华出工业级 L4 认知设计规约；
  - **状态机闭环与溯源防重**：落盘 L4 规约卡（`is_synthesized = 1`），原碎片卡自动原子标记为 `status = 'consolidated'` 封存归档，永久退出做梦候选池，杜绝套娃；同时写入 `knowledge_dream_history` 审计表，30 天内相同卡片组合绝对幂等拦截。
- 🤖 **极简动宾 MCP 协议与大模型认知读门禁**：
  - 核心工具升级为 `memhub_save`（存）、`memhub_search`（搜）、`memhub_get`（取）、`memhub_recent`（历）；
  - **破解“何时读、怎么读、能做什么”**：强化 Tool Description 显式注入 4 大调用时机（遇报错异常、动核心架构、定业务潜规则、方案选型），检索返回自带动态行动分支指引；
  - **端到端调用审计日志 (`mcp_audit_logs`)**：自动捕获工具调用流水、查询关键词、命中条数与毫秒级耗时，非阻塞无感落盘。
- 📊 **按 Project 项目维度分类大盘与效能度量 (`memhub stats`)**：
  - 多维透视全局资产与四大分类分布；
  - 自动按 Project 汇总排错、决策、模式与业务资产对比，量化估算规避试错节省的 Token 价值；
  - **做梦引擎成效透视**：独立统计 L4 升华卡片数、已封存碎片数、做梦熔炼轮次、待做梦候选池与失败冷却数。
- 🖥️ **现代化 WebUI 可视化外脑看板与内置 HTTP 服务 (`memhub ui`)**：
  - **零外部运行时重型依赖**：服务端基于 Node.js 原生 `node:http` 模块，前端采用无构建单文件 SPA，开箱即用，秒级秒开；
  - **优雅护眼浅色工程主题**：清爽卡片布局，高对比度字体与分类徽标，彻底告别深色眩晕；
  - **四大交互工作区**：
    - 📊 **态势大盘**：4 大核心 KPI、分类占比、项目空间资产矩阵与做梦熔炼去重效益；
    - 📚 **知识全景**：多维参数收窄（分类/状态/项目/标签），L1 摘要卡片瀑布流，点击抽屉沉浸展开 L2 渲染 Markdown；
    - 🔬 **检索实验室**：支持自然语言与错误堆栈混合检索，实时透出 RRF 综合打分（Score）与检索耗时；
    - 📋 **审计流水与运维**：MCP 调用流水表格，一键触发 SQLite 原生 `VACUUM INTO` 热备与 Obsidian Markdown 目录树导出；
  - **纵深安全防御**：绝对路径规范化沙箱防穿越（Anti-Path Traversal）、本地 Origin 回环隔离、敏感写操作 CSRF 自定义头防御（`X-MemHub-Request: 1`）与 1MB 流式请求体超限熔断；
  - **独立与伴生双模**：支持 `memhub ui` 独立启动并自动唤起浏览器，亦支持 `memhub daemon --ui` 伴生脱机运行且异常绝对隔离。
- 🗑️ **手动删除记忆与三表级联原子清理 (`memhub delete`)**：
  - **事务级强一致性**：原生 SQLite `BEGIN IMMEDIATE` 排他写事务级联清理主表 `knowledge_items`、倒排虚表 `knowledge_fts` 与向量表 `knowledge_embeddings`，任一异常原子回滚，彻底杜绝“幽灵召回” (0 Ghost Hits)；
  - **防手滑二次确认**：WebUI 详情弹窗提供警示按钮，确认弹窗动态呈现卡片标题与 ID，删除成功后跨视图即时物理移除 DOM 节点；
  - **全链路命令支持**：CLI 提供 `memhub delete <id>` / `memhub rm <id>`，支持交互确认与 `-y/--yes` 静默模式。
- 🛡️ **物理终态成功证据门禁 (Truth Verification Gate)**：
  - 提炼引擎前置检验退出码 0、测试通过或服务就绪证据，严禁记录未经验证的猜测。
- 🔒 **敏感凭据深度递归脱敏 (Secret Scrubbing)**：
  - 入库前自动匹配清洗标量字段与多级数组要素中的 AK/SK、JWT、密码、私钥，替换为 `***REDACTED***`。

---

## 📦 架构全景

```text
                  AI Agent (OpenCode / Cursor / Claude Code)
                                      │
         ┌────────────────────────────┴────────────────────────────┐
         ▼ (交互式读写)                                             ▼ (后台定时守护)
   MCP 协议接口 (memhub-mcp)                               memhub daemon (常驻自循环)
   • memhub_search (L1 索引 ~50 tokens)                    • 动态发现 OpenCode HTTP 端口与鉴权
   • memhub_get (L2/L3 按需展开正文与代码)                  • 扫描最近 7 天更新 & 静默 >120 分钟冷态会话
   • memhub_save (主动结构化落盘 / 原地 Upsert)             • fork 副本抽取 → POST prompt_async → 抽完即删
   • memhub_recent (新会话破冰与历史轨迹速览)               • 每轮热重载配置 + Cron 做梦调度
         │                                                         │
         └────────────────────────────┬────────────────────────────┘
                                      ▼
                      【MemHub 核心单文件 SQLite 内核】
                         (~/.memhub/memory.db)
                      ┌────────────────────────────┐
                      │ • knowledge_items (物理分层)│
                      │ • knowledge_fts (Trigram)  │
                      │ • session_tracking (状态机)│
                      └─────────────┬──────────────┘
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
            VACUUM INTO 无损原子冷备      export 按需导出 Markdown
           (~/.memhub/backups/*.db)      (~/.memhub/vault/ 知识星空)
```

---

## 🛠️ 安装与配置

### 1. 全局配置至 OpenCode

在 OpenCode 的全局配置文件（`~/.config/opencode/opencode.json`）中添加 MCP Server：

```json
{
  "mcp": {
    "memhub": {
      "type": "local",
      "command": [
        "node",
        "/path/to/MemHub/src/index.js"
      ],
      "enabled": true
    }
  }
}
```

验证连接状态：
```bash
opencode mcp list
# 应显示：✓ memhub connected
```

---

## 💻 命令行 CLI 用法 (`memhub` / `mem-hub`)

### 1. 后台常驻定时守护 (`memhub daemon`)

```bash
# 启动后台常驻守护（默认每 30 分钟轮询，扫描最近 7 天更新且静默超过 120 分钟的冷态会话）
memhub daemon

# 伴生拉起 WebUI 看板服务
memhub daemon start --ui

# 自定义轮询参数与静默时间
memhub daemon --interval 60 --window-days 7 --idle 120 --limit 5

# 单轮调试运行（真发）
memhub daemon --once --limit 1

# 单轮测试桩运行（仅观察候选集与生成指令，不真发 HTTP 请求）
memhub daemon --once --dry-run
```

### 2. 知识检索与日常维护

```bash
# 全域盲查（最常用，0 门槛）
memhub find "Alpine glibc"

# 多维高级检索：限定工作区(项目) + 过滤标签 + 指定分类
memhub find "批量锁" --project pay-center --tag redisson --category learnings

# 查看某张卡片的完整代码与分类专属详情 (L2 级展开)
memhub get kb-c3ffcbe1

# 查看最近沉淀的知识索引（支持按项目与标签过滤）
memhub list

# 查看项目维度的研发态势大盘与知识资产统计（支持 --json, --detailed, --project <name>）
memhub stats

# 查看 MCP 工具调用审计流水与检索追踪（支持 --tool <name>, --project <name>, --json）
memhub audit 20

# 执行离线做梦记忆熔炼与碎片聚类（支持 --dry-run, --affinity <0.0~1.0>, --project <name>）
memhub dream --dry-run

# 离线扫描已结束（超过静默时间）的历史会话状态
memhub scan

# 执行 SQLite 原生 VACUUM INTO 原子无损热备份冷备
memhub backup

# 将 SQLite 知识库无损导出为人类友好的 Markdown 目录树 (Obsidian兼容)
memhub export

# 启动 WebUI 视觉外脑看板（默认监听 127.0.0.1:3900 并自动打开浏览器）
memhub ui

# 指定端口启动 WebUI 并禁止自动打开浏览器
memhub ui --port 3905 --no-open

# 物理删除指定的知识卡片与索引（支持 -y/--yes 静默免确认）
memhub delete kb-c3ffcbe1 --yes
# 或别名:
memhub rm kb-c3ffcbe1 -y

# 全量/增量为已有知识计算 384 维语义向量并持久化
memhub embed

# 打印当前知识库物理文件路径
memhub path
```

---

## 🤖 MCP 工具与大模型自主认知契约

MemHub 遵循“渐进式披露 (Progressive Disclosure)”与“自解释认知契约”，向大模型暴露 4 个标准 MCP 工具（以 `memhub_*` 为标准命名空间，并完全向下兼容 `hub_*` 与 `exo_*`）：

| 标准 MCP 工具名 | 角色与认知定位 | 大模型何时调用？怎么用？ |
|:---|:---|:---|
| **`memhub_search`** | **渐进式检索 - 阶段一**<br>(~50 Tokens 超轻量探测) | **【必须前置触发】** 动代码/排错前必调。4大触发时机：①遇报错堆栈与测试失败时；②改鉴权/事务/锁等核心架构前；③处理复杂业务潜规则前；④方案选型二选一时。返回极简指纹摘要，自动记录审计日志。 |
| **`memhub_get`** | **渐进式检索 - 阶段二**<br>(确定性高清 Markdown) | **【按需高清展开】** 比对命中吻合后再调。传入 `ids: ["kb-xxx"]` 展开完整卡片（含深层技术根因、验证正解、已排除误区、架构红线与可运行代码块）。 |
| **`memhub_save`** | **主动长效资产沉淀**<br>(工程认知持久化 / 原地 Upsert) | **攻克排错(learnings)、敲定决策(decisions)、写出模板(patterns)、提炼业务(business)后调用**。传入 `session_id` 与 `topic_fingerprint` 自动原地更新覆盖，防止重复落库。 |
| **`memhub_recent`** | **最近记忆轨迹速览**<br>(新会话破冰) | **新开会话、接手新项目时调用**。快速拉取最近演进，支持按 `project`（自动穿透 global 资产）和 `tags` 过滤。 |

---

## ⚙️ 配置文件说明 (`~/.memhub/config.json`)

```json
{
  "version": "1.0",
  "idleMinutes": 120,
  "daemon": {
    "intervalMinutes": 30,
    "windowDays": 7,
    "idleMinutes": 120
  },
  "dream": {
    "enabled": true,
    "cron": "0 3 * * *",
    "minAffinity": 0.55,
    "maxClusterSize": 5
  },
  "scanRules": {
    "watchDirectories": [
      "D:/workspace"
    ],
    "include": [
      "**/my-important-project/**"
    ],
    "exclude": [
      "**/tmp/**",
      "**/scratchpad/**",
      "**/node_modules/**",
      "**/*demo*"
    ]
  }
}
```

- **`daemon`**：常驻定时提炼参数块，支持环境变量覆盖（`MEMHUB_DAEMON_INTERVAL`, `MEMHUB_DAEMON_WINDOW_DAYS`, `MEMHUB_DAEMON_IDLE_MINUTES`, `MEMHUB_OPENCODE_URL`）；
- **`dream`**：夜间做梦自省参数块，`cron` 为标准 5 段式表达式（默认每天凌晨 3 点 `0 3 * * *`，真正生效并支持区间命中），另含亲和度初筛阈值与单簇卡片上限；无有效 cron 时回退 `intervalMinutes` 间隔兜底。支持环境变量覆盖（`MEMHUB_DREAM_ENABLED`, `MEMHUB_DREAM_CRON`, `MEMHUB_DREAM_AFFINITY`, `MEMHUB_DREAM_INTERVAL`）；
- **`idleMinutes`**：判定会话进入已结束完成态的静默分钟数（默认 120，支持环境变量 `MEMHUB_IDLE_MINUTES` 覆盖）；
- **`watchDirectories`**：限制扫描的物理根目录数组（默认空表示全库扫描）；
- **`exclude`**：黑名单通配符规则，**最高优先级**，命中立即跳过；
- **`include`**：白名单通配符规则，未配置默认全部放行。

---

## 🧪 测试与质量保障

MemHub 拥有完整的分层自动化测试矩阵（涵盖 CLI 契约、路径过滤引擎、动态配置防腐、分层存储内核、混合向量 RRF 检索、适配器动态过滤、管道提炼、Stdio MCP 渐进披露、宿主客户端探测与 fork 抽取、按 Project 态势大盘、MCP 调用审计、做梦亲和度聚类、做梦调度管道及 Cron 定时引擎）：

```bash
npm test
# 13 大测试套件 100% 自动化全绿灯通过
```

---

## 📄 开源许可证

[MIT License](LICENSE)
