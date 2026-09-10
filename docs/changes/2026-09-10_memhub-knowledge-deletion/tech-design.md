# 技术方案设计：支持手动删除记忆 (Technical Design - 修订版 v3)

## 1. 架构设计与改动面分析

```
┌────────────────────────────────────────────────────────────┐
│                    User Interface Layer                    │
│   • WebUI: 卡片外层补齐 data-card-id 属性                  │
│   • WebUI: Modal 危险操作区「🗑️ 删除」+ 动态标题二次确认     │
│   • WebUI: 成功后双视图联动 (列表与搜索卡片 DOM 即时移除)   │
│   • CLI: memhub delete / rm <id> [-y/--yes/--force]        │
└─────────────────────────────┬──────────────────────────────┘
                              │ HTTP DELETE / POST
                              ▼
┌────────────────────────────────────────────────────────────┐
│              Server Layer (src/server/index.js)             │
│  • DELETE /api/knowledge/:id (路径解析 + req.resume())      │
│  • POST /api/ops/delete (await readJsonBody 读取 { id })    │
│  • 重构全局 req.resume()，仅对无 Body 的 action 执行流排空  │
│  • 强制校验 X-MemHub-Request: 1 门禁与 CORS DELETE 方法     │
└─────────────────────────────┬──────────────────────────────┘
                              │ Native SQLite Transaction
                              ▼
┌────────────────────────────────────────────────────────────┐
│              Storage Layer (src/storage.js)                │
│  • deleteKnowledge(id): 原生 BEGIN IMMEDIATE 排他写事务     │
│    ├─ DELETE FROM knowledge_items (主表实体)               │
│    ├─ DELETE FROM knowledge_fts (FTS5 全文索引防幽灵命中)  │
│    └─ DELETE FROM knowledge_embeddings (384维特征向量)     │
│  • 任何环节异常立即 ROLLBACK 并打 log，绝不吞错             │
└────────────────────────────────────────────────────────────┘
```

---

## 2. 存储层原子级联清理算法 (`src/storage.js`)

采用原生 SQLite 事务语句，并在回滚时输出清晰日志：

```javascript
/**
 * 物理级联删除知识卡片（事务原子级清理：主表、FTS 倒排索引、特征向量）
 * 严格使用原生 SQLite BEGIN IMMEDIATE 排他事务，任一环节失败立即回滚
 */
export function deleteKnowledge(id) {
  const db = getDatabase();
  const existing = db.prepare('SELECT id, title FROM knowledge_items WHERE id = ?').get(id);
  if (!existing) {
    return { success: false, notFound: true, message: `知识卡片 [${id}] 不存在` };
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    // 1. 删除主表实体
    db.prepare('DELETE FROM knowledge_items WHERE id = ?').run(id);
    
    // 2. 清理 FTS5 倒排索引（严禁吞错，保证原子回滚）
    db.prepare('DELETE FROM knowledge_fts WHERE id = ?').run(id);

    // 3. 清理 384 维稠密特征向量（严禁吞错，保证原子回滚）
    db.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(id);

    db.exec('COMMIT;');
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (rbErr) {}
    console.error(`[storage] 删除卡片 [${id}] 级联事务异常回滚:`, err.message);
    throw new Error(`删除卡片 [${id}] 级联事务失败，已原子回滚: ${err.message}`);
  }

  return { 
    success: true, 
    id, 
    title: existing.title, 
    message: `知识卡片 [${id}] 已成功物理删除` 
  };
}
```

---

## 3. HTTP 契约与分流解析设计 (`src/server/index.js`)

针对 P1 指出的流排空与 Body 读取冲突，实行**严格分流**：

### 3.1 主路由：`DELETE /api/knowledge/:id`
- **路径传参**：从 `pathname` 提取 `id`；
- **流排空**：显式执行 `req.resume()` 排空可能携带的空 Body，保障 Keep-Alive 连接健康；
- **门禁校验**：校验 `req.headers['x-memhub-request'] === '1'`，不满足响应 403；
- **执行**：调用 `deleteKnowledge(id)`，根据结果响应 200 或 404。

### 3.2 兼容路由：`POST /api/ops/delete`
- **重构现有全局排空**：移除 `src/server/index.js` 在 `/api/ops/` 入口处无差别的 `req.resume()`，改为仅在无 Body 的 `backup` / `export` 分支中按需执行 `req.resume()`；
- **门禁校验**：校验 `req.headers['x-memhub-request'] === '1'`，不满足响应 403；
- **Body 解析**：调用 `const body = await readJsonBody(req)` 读取 `{ id }`；
- **缺参防御**：若 `!body.id`，直接响应 HTTP 400 `{ success: false, error: "Missing knowledge ID in body" }`；
- **执行**：调用 `deleteKnowledge(body.id)`，根据结果响应 200 或 404。

### 3.3 CORS 预检
在 `setCorsHeaders` 中将 `Access-Control-Allow-Methods` 声明为：
`res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');`

---

## 4. WebUI 前端防误触与双视图 DOM 联动 (`src/server/public/index.html`)

### 4.1 渲染模板补充 `data-card-id`
在 `loadKnowledge()` 与 `doSearch()` 的卡片渲染模板中，统一将外层 `<div>` 挂载属性：
`data-card-id="${item.id}"`

### 4.2 弹窗上下文保存与动态标题二次确认
- 在 `openDetail(id)` 函数中，将详情对象缓存至全局变量 `currentDetailItem = item`；
- 弹窗底部左侧危险按钮：
  `<button onclick="handleDeleteCurrent()" class="px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium transition flex items-center space-x-1"><span>🗑️ 删除记忆</span></button>`
- `handleDeleteCurrent()` 实现：
  ```javascript
  if (!currentDetailItem) return;
  const confirmed = confirm(`⚠️ 危险操作：确定要彻底物理删除卡片「${currentDetailItem.title}」(${currentDetailItem.id}) 吗？\n\n此操作将同时清理全文倒排索引与语义向量，且无法撤销！`);
  if (!confirmed) return;
  // 发起 DELETE 请求
  ```

### 4.3 双视图即时 DOM 清理
- 请求成功后：
  1. 显示绿色 Toast；
  2. 调用 `closeModal()`；
  3. 执行 `document.querySelectorAll(`[data-card-id="${currentDetailItem.id}"]`).forEach(el => el.remove());`，即时从知识全景列表与检索实验室列表中物理移除 DOM 元素；
  4. 异步调用 `loadStats()` 刷新资产总数与大盘统计。

---

## 5. CLI 命令行设计 (`src/cli.js`)

- **命令分支**：`case 'delete': case 'rm':`
- **缺参防呆**：
  若未提供 `<id>`，输出用法提示：
  `用法: memhub delete <id> [--yes/-y]` 并以状态码 `process.exit(1)` 退出；
- **交互与确认**：
  - 检测命令行参数包含 `--yes`、`-y`、`--force` 则跳过确认；
  - 否则通过 `readline` 输出 `⚠️ 确认要物理删除知识卡片 [${id}] 吗？(y/N): ` 等待输入；
  - 输入 `n` 或非 `y`，输出 `ℹ️ 已取消删除操作。` 并以 `process.exit(0)` 退出；
- **执行与退出码**：
  - 调用 `deleteKnowledge(id)`；
  - 若不存在，输出错误并以 `process.exit(1)` 退出；
  - 成功输出绿色完成信息，并以 `process.exit(0)` 退出；
- **帮助文档同步**：
  在 `printHelp()` 中增加：
  `memhub delete / rm <id> [选项] 物理删除指定的知识卡片与索引 (支持 -y/--yes)`。

---

## 6. 测试与验证计划 (`tests/test-deletion.js`)

1. **三表级联原子删除断言**：
   - 插入测试数据并同步向量，验证三表均有该记录；
   - 调用 `deleteKnowledge(id)`，验证三表中数据完全消失；
   - 调用 `searchKnowledge`，断言 0 命中（杜绝幽灵命中）；
2. **事务回滚防线断言**：
   - 模拟事务内错误，验证原子回滚与主表完好；
3. **HTTP 主路由与兼容路由双向测试**：
   - 无 CSRF 头的 `DELETE` 与 `POST /api/ops/delete` 被 403 拦截；
   - 合法 `DELETE /api/knowledge/:id` 返回 200；
   - 合法 `POST /api/ops/delete` 携带 `{ id }` 返回 200；
   - 不存在的 ID 返回 404；
4. **全量 E2E 回归测试**。
