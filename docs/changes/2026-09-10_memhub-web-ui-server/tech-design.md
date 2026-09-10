# 技术方案设计：MemHub WebUI 与内置 HTTP 服务 (Technical Design - 修订版 v2)

## 1. 系统架构与模块划分

```
┌────────────────────────────────────────────────────────────┐
│                    User Browser (WebUI)                    │
│   • 态势看板  • 知识浏览 (L1/L2)  • 检索实验室  • 审计与运维  │
└─────────────────────────────┬──────────────────────────────┘
                              │ HTTP / JSON (REST API)
                              ▼
┌────────────────────────────────────────────────────────────┐
│              MemHub HTTP Server (src/server/index.js)       │
│  • 原生 node:http 轻量服务 (0 额外运行时依赖)                 │
│  • 安全沙箱与防护 (Path Traversal / CORS / CSRF / 1MB 熔断) │
│  • 路由分发器 (Router) + 静态资源伺服 (Static Handler)      │
│  • 参数校验、Controller Adapter 组装与统一 JSON 响应        │
└──────────────┬──────────────────────────────┬──────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────┐┌─────────────────────────────┐
│  src/storage.js             ││  src/config.js              │
│  • SQLite memory.db 内核    ││  • 端口与主机配置            │
│  • 混合检索 (透出 RRF 分值) ││  • 扫描与运行策略            │
│  • 状态过滤与分页 listRecent│└─────────────────────────────┘
│  • 审计流水与态势统计       │
└─────────────────────────────┘
```

---

## 2. 安全与网络边界设计 (Security & Boundaries)

针对 Review Subagent 提出的 3 项 P0 级风险，落实以下防线：

### 2.1 静态资源沙箱防护与路径规范化 (Path Traversal Protection)
- 根静态目录严格限定为：`publicDir = path.resolve(__dirname, 'public')`；
- 解析请求路径：`const safePath = path.resolve(publicDir, '.' + reqPath)`；
- **沙箱逃逸硬编码校验**：必须满足 `safePath.startsWith(publicDir)`，否则立即响应 HTTP 403 Forbidden；
- **扩展名白名单**：仅允许 `.html`, `.css`, `.js`, `.json`, `.svg`, `.png`, `.ico` 等白名单扩展名；
- 文件不存在时安全响应 HTTP 404 Not Found。

### 2.2 跨站与网络边界防护 (CORS & CSRF Defenses)
- **回环与 Origin 校验**：
  - 服务默认监听 `127.0.0.1`；
  - CORS 头检查：仅当请求的 `Origin` 为本地回环模式（如 `http://localhost:*`、`http://127.0.0.1:*`）时允许放行并回显对应 Origin，其余直接拒绝跨域读取；禁止使用 `Access-Control-Allow-Origin: *`。
- **CSRF 门禁防御**：
  - 对写操作（`POST /api/ops/*`），服务端严格验证请求头：
    1. `Content-Type: application/json`；
    2. 必须包含自定义请求头 `X-MemHub-Request: 1`；
  - 缺乏该自定义头的跨域请求会被现代浏览器预检机制（Preflight OPTIONS）直接拦截，阻止跨站表单盲打。

### 2.3 流量熔断与流式 Body 限额 (DDoS / OOM Protection)
- 请求体流式解析器（`readJsonBody`）设置最大上限：`MAX_BODY_SIZE = 1024 * 1024`（1MB）；
- 每次 `req.on('data', chunk)` 累加字节数，若超过 1MB 立即执行 `req.destroy()` 并响应 HTTP 413 Payload Too Large。

---

## 3. 存储层改造清单 (`src/storage.js`)

为满足 WebUI 综合得分透视与状态过滤需求，对底层数据层进行向后兼容的参数扩展：

### 3.1 混合检索透出综合得分 (`searchKnowledge`)
- 扩展参数：`searchKnowledge(query, options = {})` 支持 `options.includeScores = true`；
- 当 `includeScores === true` 时，`formatL1Result` 保留 `score` 字段；
- 若降级至 SQL LIKE 匹配，默认注入 `score: 0.1` 兜底；
- 保持存量 MCP / CLI 行为完全一致（默认 `includeScores` 为 false 或保持纯净对象）。

### 3.2 知识列表支持状态过滤与分页 (`listRecent`)
- 扩展参数：`listRecent(options = {})` 支持：
  - `status`: 枚举 `'active'` | `'superseded'` | `'consolidated'` | `'all'`（默认 `'active'`）；
  - `offset`: 整数偏移量（默认 0）；
  - `limit`: 默认 50，上限 200。
- SQL 构建增加 `status` 分支判断，并在返回对象中附带 `consolidated_into` 等血缘追溯字段。

---

## 4. API 契约设计 (RESTful Contract)

所有 API 统一响应格式：`{ success: boolean, data?: any, error?: string }`。

### 4.1 态势看板接口 `GET /api/status`
- **Controller 职责**：调用 `storage.getStats()` 并结合 `fs.statSync(DB_PATH).size` 补齐物理存储信息。
- **出参**：
  ```json
  {
    "success": true,
    "data": {
      "dbPath": "C:\\Users\\...\\.memhub\\memory.db",
      "dbSizeBytes": 1048576,
      "stats": {
        "totalKnowledge": 42,
        "byCategory": { "learnings": 20, "decisions": 10, "patterns": 8, "business": 4 },
        "projectMatrix": [ { "project": "oms", "learnings": 5, "total": 12 } ],
        "dreaming": {
          "l4ConsolidatedCards": 3,
          "archivedFragments": 9,
          "fragmentConsolidationRatio": 0.21,
          "totalDreamRuns": 4
        },
        "sessions": { "extracted": 15, "skipped": 25, "total": 40 }
      }
    }
  }
  ```

### 4.2 知识列表与过滤接口 `GET /api/knowledge`
- **查询参数**：
  - `category`（可选）：四大分类
  - `project`（可选）：项目过滤（自动穿透 global）
  - `tag`（可选）：技术标签
  - `status`（可选）：`active` | `superseded` | `consolidated` | `all`（默认 `active`）
  - `limit`（可选，默认 50，上限 200）
  - `offset`（可选，默认 0）
- **出参**：
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "kb-c3ffcbe1",
          "title": "[Docker] 内存溢出排查 -> 调优 JVM 堆内存参数",
          "category": "learnings",
          "project": "oms",
          "tags": ["docker", "jvm"],
          "status": "active",
          "consolidated_into": null,
          "updated_at": "2026-09-08 12:00:00"
        }
      ],
      "total": 1,
      "limit": 50,
      "offset": 0
    }
  }
  ```

### 4.3 知识详情接口 `GET /api/knowledge/:id`
- **入参**：路径参数 `id`
- **出参**：返回该卡片的 L2 结构化字段，包含 `context_text`, `root_cause`, `solution_core`, `code_payload`, `extra_payload`, `supersedes`，并由服务端根据分类模板生成 Markdown 字段 `markdown_rendered`。

### 4.4 混合检索接口 `POST /api/search`
- **入参**：
  ```json
  {
    "query": "redis 锁 超时",
    "project": "oms",
    "category": "learnings",
    "limit": 10
  }
  ```
- **出参**：
  ```json
  {
    "success": true,
    "data": {
      "query": "redis 锁 超时",
      "duration_ms": 15,
      "items": [
        {
          "id": "kb-7d6f60b8",
          "title": "[Redis] 分布式锁续期 -> 引入 Redisson 看门狗",
          "category": "learnings",
          "project": "oms",
          "tags": ["redis", "lock"],
          "score": 0.032258
        }
      ]
    }
  }
  ```

### 4.5 MCP 审计流水接口 `GET /api/audit`
- **查询参数**：`tool`（可选）、`limit`（默认 50）、`offset`（默认 0）
- **出参**：返回审计日志条目列表及总量。

### 4.6 运维操作接口 `POST /api/ops/:action`
- **门禁校验**：校验 `X-MemHub-Request: 1`。
- **路径参数**：
  - `backup`：触发 `backupDatabase()`，返回生成的文件名和耗时；
  - `export`：触发 `exportToMarkdown()`，返回导出的文件夹路径。
- 非法 action 响应 HTTP 400 Bad Request。

---

## 5. WebUI 单文件架构设计 (`src/server/public/index.html`)

- **极简一体化**：采用 HTML + Tailwind CSS (CDN/内联) + 原生现代化 ES 脚本，零打包工具链。
- **四大核心工作区 Tab**：
  1. **态势看板 (Dashboard)**：
     - 4 大顶层指标：资产总数、L4 升华数、已萃取会话数、DB 存储大小；
     - 资产分类占比柱状图/进度条；
     - 项目资产矩阵明细表格；
     - 做梦熔炼成效卡片。
  2. **知识全景 (Explorer)**：
     - 顶部筛选栏：分类 Pill（全部/排错/决策/模板/业务）、状态 Pill（全部/活跃/已封存/已迭代）、项目下拉选择框、标签过滤；
     - 卡片列表：标题、分类徽标、项目 Badge、标签 Tag、生命周期状态灯；
     - 详情抽屉/Modal：渐进展开 L2 详情，结构化呈现“痛点与背景”、“技术根因”、“解决方案代码块”、“排错误区与架构红线”。
  3. **检索实验室 (Playground)**：
     - 搜索输入框 + 项目与分类收窄选择；
     - 实时检索结果列表，透出综合打分（Score）与单次检索耗时；
     - 空白引导态与未命中提示。
  4. **审计流水与运维 (Audit & Ops)**：
     - 工具调用审计列表（调用方、调用时间、工具名、查询文本、命中条数、耗时）；
     - 快捷运维按钮：「一键热备数据库」、「一键导出 Markdown 树」。

---

## 6. CLI、生命周期与伴生进程模型

### 6.1 `memhub ui` / `memhub web` 命令实现
- 选项支持：
  - `--port <number>`：指定端口（默认 3900）；
  - `--host <ip>`：指定监听主机（默认 `127.0.0.1`）；
  - `--no-open`：禁用自动打开浏览器。
- **端口占用容错**：
  - 捕获 `server.on('error', (err) => { if (err.code === 'EADDRINUSE') ... })`；
  - 友好提示用户端口已被占用，避免未经处理的未捕获异常 crash；
- **安全安全唤起浏览器**：
  - 根据 `process.platform` 分支执行安全命令：
    - `win32`: `cmd.exe /c start "" "${url}"`
    - `darwin`: `open "${url}"`
    - `linux`: `xdg-open "${url}"`
  - URL 严格由受控参数 `http://${safeHost}:${safePort}` 生成，杜绝用户外部参数拼接命令注入；
- **优雅退出 (Graceful Shutdown)**：
  - 监听 `SIGINT` 和 `SIGTERM`，执行 `server.close(() => process.exit(0))`。

### 6.2 `memhub daemon --ui` 伴生模型与进程隔离
- **参数透传**：在 `src/daemon.js` 中的 `startDaemonBackground` 派生参数 `childArgs` 中显式补齐 `--ui`；
- **同进程异常隔离**：
  - 在守护进程常驻循环启动 HTTP Server 时，对 HTTP Server 挂载独立 error 监听与请求 try-catch；
  - HTTP 服务的偶发性异常仅记录错误日志，严禁抛出至顶层导致核心提炼守护主循环退出。

---

## 7. 测试方案与用例设计 (`tests/test-web-server.js`)

包含全部正向与反向安全边界测试：
1. **基础路由与静态资源测试**：
   - `GET /` 响应 200，Content-Type 为 `text/html`；
   - 路径穿越防护测试：`GET /../../package.json` 响应 403 或 404，绝不泄露敏感文件；
2. **态势与知识接口测试**：
   - `GET /api/status` 响应 200，字段包含 `dbPath`, `dbSizeBytes`, `stats.totalKnowledge` 等；
   - `GET /api/knowledge?status=all` 验证状态过滤与分页返回值；
   - `GET /api/knowledge/:id` 验证已知卡片详情与 404 不存在卡片；
3. **混合检索与得分透视测试**：
   - `POST /api/search` 验证混合检索返回条目包含 `score` 且返回 `duration_ms`；
4. **安全与限制测试**：
   - 1MB 超大 Body 熔断测试：发送 > 1MB 的 POST 请求体，断言收到 413 Payload Too Large；
   - CSRF 防御测试：未带 `X-MemHub-Request` 头的 `POST /api/ops/backup` 被拒绝；带头时正常执行；
   - 非法运维 Action 测试：`POST /api/ops/invalid` 响应 400；
5. **端口冲突与优雅退出测试**：
   - 验证 `server.close()` 正常释放网络句柄。
