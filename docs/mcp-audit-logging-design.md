# MemHub MCP 工具调用审计日志技术设计 (MCP Audit Logging)

> **模块定位**：提供 MCP 端点（save / search / get / recent）调用访问流水台账、性能度量与 Agent 检索行为追踪  
> **方案版本**：v1.0.0  
> **创建日期**：2026-09-09  
> **状态**：通过设计 (Approved)

---

## 一、 背景与业务价值

### 1. 核心痛点
- 过去 MCP 工具作为 stdio 协议运行，LLM 何时调用了 `memhub_search`？搜索了什么关键词？命中了多少条？调用了什么 ID 的正文？沉淀了什么标题？外界完全是个“黑盒”；
- 缺少调用耗时与频次度量，无法评估检索响应性能，也无法量化“Agent 到底有没有遵从规范先查后写”。

### 2. 业务收益
- **行为全景可追溯**：精确记录 Agent 每次搜索的 `query`、工作区 `project`、命中条数 `hits_count` 以及详细参数；
- **沉淀审计留痕**：每次 `memhub_save` 记录操作者（session/project）、生成的 `id` 及是否为重复/更新；
- **效能大盘透视**：在 `memhub stats` 与 `memhub audit` 中直观展示 MCP 工具调用频率与热点搜索词。

---

## 二、 存储与 DDL 架构设计 (`src/storage.js`)

在单文件 SQLite `memory.db` 中通过 DDL 热自愈自动创建 `mcp_audit_logs` 表：

```sql
CREATE TABLE IF NOT EXISTS mcp_audit_logs (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,       -- 'memhub_search', 'memhub_get', 'memhub_save', 'memhub_recent'
    project TEXT,                  -- 请求中携带的 project 或默认工作区
    session_id TEXT,               -- 若入参包含 session_id 则提取
    query_summary TEXT,            -- search 的 query / get 的 ids / save 的 title
    input_payload TEXT,            -- 原始入参 JSON 序列化 (敏感字段脱敏)
    hits_count INTEGER DEFAULT 0,  -- 命中结果条数 (search/get/recent 为实际返回数，save 为 1 或 0)
    duration_ms INTEGER DEFAULT 0, -- 接口端到端执行耗时 (毫秒)
    status TEXT NOT NULL,          -- 'SUCCESS' | 'ERROR'
    error_message TEXT,            -- 若失败则记录异常描述
    created_at INTEGER NOT NULL    -- 毫秒时间戳
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_tool ON mcp_audit_logs(tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_created ON mcp_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_project ON mcp_audit_logs(project);
```

---

## 三、 MCP 切面插桩机制 (`src/index.js`)

在 `server.setRequestHandler(CallToolRequestSchema, async (request) => { ... })` 中，以 AOP 切面环绕式包裹工具调用：

1. **时钟启动**：`const startMs = Date.now();`
2. **入参感知与提取**：
   - 工具名称标准化：归一化为 `memhub_save` / `memhub_search` / `memhub_get` / `memhub_recent`；
   - 摘要生成：
     - `search` $\rightarrow$ `args.query`
     - `get` $\rightarrow$ `args.ids || [args.id]`
     - `save` $\rightarrow$ `args.title`
     - `recent` $\rightarrow$ `limit=${args.limit || 10}`
3. **执行与耗时捕获**：
   - 记录 `duration_ms = Date.now() - startMs;`
   - 记录 `hits_count`（搜索命中数、获取卡片数、保存结果）；
4. **异步非阻塞落盘**：
   - 调用 `logMcpAccess(...)` 写入数据库，**绝不阻断工具本身的返回值**，即使审计日志写入出现偶发异常，也仅在 stderr 打印警告，保障 MCP 主通道 100% 健壮。

---

## 四、 消费通道：CLI 审计与统计

1. **`memhub audit [条数]`**：
   - 快速展示最近 N 条 MCP 工具调用日志流水（时间、工具名、项目、查询内容、命中数、耗时）；
   - 支持 `--tool <name>` 按工具过滤，支持 `--json` 输出。
2. **`memhub stats` 深度集成**：
   - 在大盘底部增加 **【⚡ MCP 工具调用与检索频次】**：
     - 各工具调用总量（search/get/save/recent）；
     - 近期调用趋势。
