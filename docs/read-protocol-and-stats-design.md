# MemHub 认知读协议与研发态势大盘技术设计方案

> **模块定位**：解决 LLM 记忆读取盲区（读协议通道规范）与提供研发效能/代码踩坑热点度量（`memhub stats` 深度大盘）  
> **方案版本**：v1.0.0  
> **创建日期**：2026-09-09  
> **状态**：通过设计审校 (Approved)

---

## 一、 背景与核心问题

1. **痛点 1（LLM 不知何时读、怎么读、能做什么）**：
   - 目前 MCP 仅暴露出机械的 `memhub_search` 与 `memhub_get`，工具描述（Tool Description）过于简短抽象，LLM 缺乏触发契机感知；
   - LLM 习惯“直接动手猜代码”，报错后才被迫盲目改代码，缺少“动手前先查避坑与 ADR 决策”的纪律约束；
   - 缺少标准的系统级引导规则模板。
2. **痛点 2（缺乏研发态势与代码热点资产透视）**：
   - 现有的 `memhub stats` 只输出简单的分类条目统计和会话数，缺乏深度洞察；
   - 架构师和开发者无法得知：哪些源文件/模块频繁出 bug 踩坑（Code Hotspots）？哪些模块缺乏架构决策规约（风险盲区）？

---

## 二、 第一部分：认知读通道与触发规约增强设计

### 1. 能做什么（Identity & Capability Definition）
- **定性**：MemHub 是软件工程专用的“暗知识调度中枢”，涵盖排错因果链（Learnings）、架构权衡与红线（Decisions）、最佳实践配置模板（Patterns）以及业务隐性规则（Business）。

### 2. 什么时候读（Four Trigger Gates）
通过重塑 MCP 工具的 Tool Description，向 LLM 注入 4 大硬触发时机：
1. **Gate 1（动核心架构前）**：涉及鉴权、多租户、并发锁、分布式事务、数据库 DDL 改动前；
2. **Gate 2（遭遇报错时）**：控制台出现异常堆栈、测试挂掉、编译或打包失败时，严禁盲猜，必须先查堆栈与关键错误词；
3. **Gate 3（方案二选一时）**：在面临架构选型、接口重构时，查询历史 ADR 决策；
4. **Gate 4（复杂业务规则处理时）**：涉及支付、对账、设备状态等隐性业务流转逻辑时。

### 3. 怎么读（Two-Phase Progressive Disclosure）
- **第一阶段（Search 广撒网）**：调用 `memhub_search`，获取 30~50 Token 强指纹摘要。
- **第二阶段（Get 精准展开）**：根据摘要中的 `id`，调用 `memhub_get(ids=[...])` 拉取完整技术根因、架构红线与真实修复代码。

### 4. 落地载体
- 优化 `src/index.js` 中的 MCP 工具 schema 与描述，强化 `[前置必须/何时触发]` 的指令诱导；
- 在 `memhub_search` 返回结果中强化 `instruction` 动态引导提示；
- 提供标准化 `AGENTS.md` 记忆协议代码片段，方便植入各项目。

---

## 三、 第二部分：研发态势大盘 `memhub stats` 项目分类汇总设计

### 1. CLI 命令规范
- `memhub stats`：默认展示资产概览、全局分类占比、按 Project 项目维度分类汇总分布、会话状态流水；
- `memhub stats [project]` 或 `memhub stats --project <name>`：按指定项目过滤透视；
- `memhub stats --json`：输出结构化 JSON，供效能看板与报表集成。

### 2. 底层数据聚合模型 (`src/storage.js`)
扩展 `getStats({ project })`：
1. **基础统计**：
   - 知识卡片总数、四大基石分类分布（learnings/decisions/patterns/business）；
   - 扫描会话总数、状态分布（EXTRACTED/SKIPPED）；
2. **按 Project 项目维度分类总结矩阵（Projects Summary）**：
   - 多表 GROUP BY 聚合：按 `project` 和 `category` 交叉统计各项目沉淀的卡片数；
   - 展现每个项目的排错（learnings）、决策（decisions）、模式（patterns）、业务（business）明细条目与总数排行；
3. **投入度量与节省估算**：
   - 根据资产复用频次，估算为研发规避重复踩坑节省的 Token 配额总量。

### 3. 终端视觉排版
采用无外部依赖的 ASCII 条形图美化排版，直观对比各项目工程资产建设度。

---

## 四、 验证与自测方案
1. 编写单测 `tests/test-stats.js`，验证：
   - `getAssetStats` 多维聚合计算逻辑与热点文件排序算法；
   - 空库与单文件多卡片场景；
   - 风险盲区识别逻辑；
   - CLI 命令输出文本与 `--json` 格式断言；
2. 验证 MCP 工具描述与测试套件 `test-mcp-protocol.js` 兼容性；
3. 运行全量 `npm test` 确保 100% 绿灯。
