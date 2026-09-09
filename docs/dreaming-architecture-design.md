# MemHub AI 做梦引擎（Dreaming & Memory Consolidation）顶层架构设计

> **模块定位**：面向 AI Coding Agent 的离线认知反思、记忆熔炼升华与架构自省引擎  
> **设计版本**：v1.0.0 (规划于 v0.2.0 发布)  
> **创建日期**：2026-09-09  
> **状态**：已落盘设计 (Approved for Roadmap)

---

## 一、 5W2H 顶层设计矩阵

### 1. WHY（为什么做？—— 核心痛点与业务驱动）
1. **记忆碎片化与信息孤岛**：排查偶发问题沉淀的都是点状单卡（创可贴式记录），跨会话后无法形成系统性架构认知；
2. **规则腐化与静默冲突**：早期决策与后期优化在知识库中并存（如“查从库”与“查主库”冲突），导致 Agent 产生认知精神分裂；
3. **检索噪音与上下文膨胀**：低密度细节稀释 Top-K 召回精度，浪费上下文 Token 预算；
4. **预期收益**：通过离线熔炼，将 3~5 张零散排错/决策卡升华为高阶设计规约（L4 认知层），压缩检索 Token 消耗 **40% 以上**，实现架构矛盾主动预警。

### 2. WHAT（做什么？—— 核心功能矩阵）
* **Consolidation Engine（记忆熔炼）**：同模块、同技术栈碎片交叉比对，提炼高阶 SOP 与思维模型；
* **Contradiction Radar（矛盾雷达）**：跨时间扫描冲突决策，主动产生架构警告卡；
* **Incremental Absorption（增量吸收）**：新碎片与现有高阶规约比对，原地丰富边界而非盲目新建；
* **Pruning & Decay（剪枝降权）**：对单次偶发噪音卡进行半衰期软归档（`status = 'archived'`）。

### 3. WHO（谁参与？—— 角色分工与权限）
* **MemHub Daemon（调度中枢）**：充当生物钟，监控 Agent 活跃度与空闲窗口，分发做梦任务；
* **Host LLM（宿主算力）**：充当大脑皮层，0 外部 API，复用 OpenCode/Cursor 本地已就绪的模型进行深度语义推理；
* **SQLite 内核（真理源）**：维护事务一致性、`supersedes` 演化拓扑、向量增量刷新与审计台账；
* **人类架构师**：作为最高裁决官，对做梦发现的严重“架构冲突”进行一键确认或修正。

### 4. WHEN（何时触发？—— 调度窗口与生命周期）
* **闲时触发**：宿主 Agent 连续无交互超过 `idleThreshold`（默认 120 分钟），或深夜时段（02:00-05:00）；
* **定量触发**：未熔炼碎片累计达到阈值（如新增活跃碎片 $\ge 5$ 张）；
* **显式指令**：开发者或 CI 执行 `memhub dream --deep` 主动触发；
* **即时退避（Preemption）**：一旦宿主接收到人类新指令，做梦进程 **50ms 内立即挂起退避**，零抢占业务算力。

### 5. WHERE（在哪发生？—— 隔离拓扑与存储）
* **单项目空间**：限定在代码仓库目录，处理项目业务潜规则、模块解耦与本地排错；
* **全局通用空间**：仅处理通用技术栈填坑（Docker、Spring、React 底层并发等），严禁项目业务泄漏至全局；
* **物理存储**：复用单文件 `memory.db`，主表 `knowledge_items` 新增 `is_synthesized` 与状态标记，伴生 `knowledge_dream_history` 审计表。

### 6. HOW（如何实现？—— 四步闭环流水线）
* **Step 1 拓扑关联初筛**：通过硬隔离 + Tag/File/向量三维评分聚类为 2~5 张卡片的主题簇；
* **Step 2 宿主做梦反思**：注入严谨复盘 Prompt，由宿主 LLM 判断能否抽象出统一规范；
* **Step 3 质量门禁**：必须满足真实因果链、排除环境偶然性、至少消减 1 张冗余卡；
* **Step 4 事务提交与落盘**：原卡标记 `consolidated`，新生成 L4 卡片，重新计算 384 维向量。

### 7. HOW MUCH（成本与边界控制）
* **Token 配额**：单次做梦严格限制在 8K Tokens 内，每日做梦上限不超过 2 次；
* **可逆性底线**：**永不物理硬删除**，所有被合并卡片保留版本链与溯源 ID，支持一键还原；
* **非侵入性**：做梦仅重构 MemHub 自身知识图谱，绝不未经允许私自改动项目源码。

---

## 二、 聚类维度与判定公式

聚类严格按照四步漏斗进行，拒绝单点模糊匹配：

```
[待熔炼候选池: status='active' 且 is_synthesized=0]
                      │
                      ▼
【Gate 1: 硬隔离】 同 project 或 global 通用空间
                      │
                      ▼
【Gate 2: 综合亲和度打分】 S = 0.35 * Jaccard(Tags) + 0.30 * Overlap(Files) + 0.35 * CosineSim(Vectors)
                      │
                      ▼
【Gate 3: 连通子图切分】 满足 S >= 0.70 且 CosineSim >= 0.65 的卡片聚类为簇（2~5 张）
                      │
                      ▼
【Gate 4: 宿主 LLM 终审】 语义校验是否具备共同深层根因。若通过则熔炼，否则打标退出。
```

---

## 三、 防重机制与卡片流转状态机

### 1. 碎片 1 参与流转规约（杜绝重复与套娃）
* 碎片 1、2、3 熔炼为新 L4 卡片后，状态立即变更为 `status = 'consolidated'`，并记录 `consolidated_into = 'kb-l4-new'`；
* **碎片 1 永久退出后续常规做梦池**，不再参与下一轮同级合并；
* **新碎片增量吸收机制**：未来产生新碎片 4 时，只能与已存在的 L4 卡片做**增量吸收（Incremental Enrichment）**，更新 L4 边界，严禁倒退回去重拉碎片 1~3。

### 2. 幂等指纹与失败冷却
* **哈希指纹去重**：维护 `cluster_fingerprint = SHA256(sort(id1, id2, ...))`，任何组合一旦记录在案，30 天内禁止再次组合询问；
* **渐进式冷却退避**：LLM 判定“场景特异，不可合并”的卡片，标记 `dream_skip_until = now() + 7天`，避免反复唤醒。

---

## 四、 存储层物理 DDL 扩展

无损升级单文件 SQLite 内核，保持 100% 存量兼容：

```sql
-- 主表扩展字段 (DDL 自动热自愈迁移)
ALTER TABLE knowledge_items ADD COLUMN is_synthesized INTEGER DEFAULT 0;
ALTER TABLE knowledge_items ADD COLUMN status TEXT DEFAULT 'active'; -- 'active', 'consolidated', 'archived'
ALTER TABLE knowledge_items ADD COLUMN consolidated_into TEXT;
ALTER TABLE knowledge_items ADD COLUMN dream_attempts INTEGER DEFAULT 0;
ALTER TABLE knowledge_items ADD COLUMN dream_skip_until INTEGER DEFAULT 0;

-- 梦境审计与幂等防重表
CREATE TABLE IF NOT EXISTS knowledge_dream_history (
    id TEXT PRIMARY KEY,
    cluster_fingerprint TEXT UNIQUE NOT NULL,
    source_ids TEXT NOT NULL,
    outcome TEXT NOT NULL, -- 'CONSOLIDATED' | 'REJECTED' | 'NO_CONSENSUS'
    synthesized_id TEXT,
    created_at INTEGER NOT NULL
);
```

---

## 五、 消费与检索链路差异

1. **RRF 混合检索加权与折叠**：
   * 检索时，对 `is_synthesized = 1` 的 L4 记忆赋予 **1.5x 排名加权**；
   * 命中 L4 卡后，被其吸纳的底层子卡（记录在 `supersedes` 中）自动从候选列表折叠隐藏，避免噪音；
2. **开局知识地图优先注入**：
   * `memhub map` 生成 `<500 tokens` 的 `AGENTS.md` 时，优先选取高置信度 L4 做梦资产；
3. **证据链反向追溯**：
   * L4 卡正文底部自带反向溯源标记：`[来源溯源] 由做梦引擎融合自 [kb-001], [kb-002]，点击可追溯原始排错堆栈与真实代码提交`。
