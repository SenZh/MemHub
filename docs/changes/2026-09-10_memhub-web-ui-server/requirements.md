# 需求规格说明书：MemHub WebUI 与内置 HTTP 服务 (Requirements - 修订版 v2)

## 1. 业务背景与痛点
MemHub 目前已具备工业级单文件 SQLite 内核、极简动宾 MCP 协议、384 维向量混合检索、后台常驻提炼守护与离线闲时做梦熔炼等能力。
然而，开发者当前只能通过终端命令行（CLI）或等待 AI Agent 自动调用 MCP 工具与 MemHub 交互，存在以下痛点：
1. **暗箱不可见**：人类工程师无法直观感知 Agent 在后台沉淀了哪些架构决策与排错因果链，也无法可视化审阅知识质量；
2. **检索难以调试**：无法直观比对 FTS5 文本精确匹配与 384 维向量语义检索的双路召回分值及 RRF 融合效果；
3. **态势缺乏全局大盘**：缺乏可视化的研发态势看板、资产分类比例与做梦熔炼去重收益；
4. **运维干预成本高**：查看 MCP 调用审计、触发做梦熔炼、触发扫描等操作高度依赖终端手工输命令，缺乏一键可视化的操作中心。

因此，需要在 MemHub 中内置轻量化 HTTP Server 与开箱即用的现代化 WebUI（工程资产驾驶舱）。

---

## 2. 核心功能需求 (Functional Requirements)

### 2.1 知识全景浏览与多维过滤 (Knowledge Explorer)
- **FR-1.1 分类与项目收窄**：支持按四大核心分类（`learnings` 排错避坑、`decisions` 架构决策、`patterns` 代码模板、`business` 业务潜规则）与项目维度（`project`，包含全局通用资产穿透）进行多维筛选。
- **FR-1.2 状态过滤与分页机制**：支持按状态收窄（`status`: `active` 有效、`superseded` 已迭代废弃、`consolidated` 已熔炼封存、`all` 全部）；支持 `limit` 与 `offset` 分页机制。
- **FR-1.3 两阶段渐进式展开**：
  - 默认列表仅展示 L1 强指纹摘要（标题、分类、项目、标签、关联文件、更新时间、生命周期状态与融合目标 `consolidated_into`）；
  - 点击卡片支持渐进展开 L2 详情（背景痛点、技术根因、正解代码/配置、无效尝试/架构红线/评估备选，以及服务端渲染完成的 Markdown）。
- **FR-1.4 版本迭代与做梦溯源**：在界面可视化标记 `supersedes` 历史替代链与 `consolidated_into` 熔炼归属。

### 2.2 混合检索实验室 (Search Playground)
- **FR-2.1 混合搜索调试**：输入检索词（Query），触发 FTS5 + 384 维向量 + RRF 倒数排名融合检索。
- **FR-2.2 综合得分与耗时透视**：展示单次检索总耗时 `duration_ms`，并透出各条目的 RRF 综合打分（`score`），帮助排查检索效果与词汇鸿沟泛化能力。

### 2.3 研发态势与服务看板 (Status Dashboard)
- **FR-3.1 资产分布概览**：展示各分类卡片总数、项目资产分布矩阵。
- **FR-3.2 做梦熔炼成效透视**：透视当前 L4 升华沉淀数、已封存碎片数、碎片封存率与做梦轮次。
- **FR-3.3 守护状态与存储指标**：展示当前 DB 物理路径、数据库物理文件大小（Bytes）、已萃取会话数与跳过会话数。

### 2.4 MCP 审计流水与运行日志 (Audit Logs)
- **FR-4.1 MCP 工具调用审计流**：按时间倒序展示 `mcp_audit_logs` 数据，包含调用工具（`memhub_search`/`get`/`save`/`recent`）、耗时、Query 关键词、命中条数、客户端 Caller 标识。
- **FR-4.2 多维筛选与分页**：支持按工具名与关键词筛选审计记录，支持 `limit` 分页。

### 2.5 手动运维与快捷操作 (Ops Center)
- **FR-5.1 数据库一键冷备**：提供一键调用 SQLite 原生 `VACUUM INTO` 备份接口，生成热备副本并返回生成路径与耗时。
- **FR-5.2 知识 Markdown 导出**：支持一键触发全量 Markdown 导出，返回导出目标目录。

---

## 3. 非功能性需求与安全边界 (Non-Functional Requirements & Security Boundaries)
- **NFR-1 极简依赖与原生架构**：服务端基于 Node.js 原生 `node:http` 模块实现，严禁引入额外重型 Web 框架或膨胀依赖。
- **NFR-2 零构建开箱即用**：WebUI 采用无构建单文件 SPA，内嵌于源码，用户无需安装任何前端构建工具链即可直连访问。
- **NFR-3 安全沙箱与目录穿越防护**：静态资源文件读取必须强制进行绝对路径规范化校验（`path.resolve` + `startsWith(publicDir)`）与合法 MIME 白名单限定，严防任何沙箱逃逸与任意文件读取。
- **NFR-4 跨站防御与网络边界隔离**：
  - 默认仅绑定本地回环地址 `127.0.0.1`；
  - 严格限制 CORS 来源为本地回环或同源；
  - 对敏感写操作（`POST /api/ops/*`）强制校验请求头（`Content-Type: application/json` 与 `X-MemHub-Request: 1`），利用浏览器预检拦截 CSRF。
- **NFR-5 流量限额与内存保护**：服务端流式解析 Body 设置硬编码上限（`MAX_BODY_SIZE = 1MB`），超限立即熔断返回 413 Payload Too Large。
- **NFR-6 优雅启停与伴生容错**：
  - 端口冲突（`EADDRINUSE`）友好拦截与清晰提示；
  - 捕获 `SIGINT`/`SIGTERM` 实现 `server.close()` 句柄安全释放；
  - `memhub daemon --ui` 伴生时实现参数完整透传，挂载独立异常隔离，保障 WebUI 故障绝不中断后台核心提炼进程。
- **NFR-7 原生浏览器安全调起**：基于操作系统分支执行调起命令，URL 采用受控拼接，防范命令注入。
