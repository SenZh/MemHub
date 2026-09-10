# 交付总结：支持手动删除记忆 (Release Summary)

## 1. 版本定位与目标
- **版本号**：v0.1.5 (Manual Knowledge Deletion & Cascade Atomic Purge Release)
- **核心价值**：为开发者提供安全、便捷、彻底的手动知识治理手段，支持从 WebUI 界面或 CLI 终端物理删除失效、测试或敏感卡片。
- **架构保障**：原生 SQLite `BEGIN IMMEDIATE` 排他事务级联清理主表、FTS5 全文倒排索引与 384 维特征向量，彻底消灭幽灵召回 (0 Ghost Hits)。

---

## 2. 交付核心能力概览

### 2.1 存储层：三表原子级联物理清理 (`src/storage.js`)
- 导出 `deleteKnowledge(id)`；
- 开启排他写事务，原子级联执行：
  1. `DELETE FROM knowledge_items WHERE id = ?`
  2. `DELETE FROM knowledge_fts WHERE id = ?`
  3. `DELETE FROM knowledge_embeddings WHERE id = ?`
- 异常时自动 ROLLBACK 并输出错误日志，避免孤儿索引；
- 不存在或已被删除的卡片返回 `notFound: true`，具备幂等性。

### 2.2 HTTP 服务端：双路由支持与 CSRF 门禁 (`src/server/index.js`)
- **主路由**：`DELETE /api/knowledge/:id`（路径传参，显式 `req.resume()` 排空连接）；
- **兼容路由**：`POST /api/ops/delete`（Body 传参 `{ id }`，异步读取 Body 流）；
- **安全防线**：
  - 强制校验 `X-MemHub-Request: 1` 自定义请求头，阻断跨站 CSRF 恶意删除；
  - CORS 响应头开放 `DELETE` 方法声明；
  - 缺参返回 400，不存在返回 404，成功返回 200。

### 2.3 WebUI 前端：防误触二次确认与跨视图联动 (`src/server/public/index.html`)
- **卡片标记**：全景列表与检索实验室卡片容器外层统一补齐 `data-card-id="${item.id}"`；
- **防手滑确认**：在 L2 详情抽屉底部新增红色警示按钮「🗑️ 删除记忆」，点击后动态呈现被删卡片的真实标题与 ID，提醒“此操作无法撤销”；
- **双视图 DOM 物理移除**：确认删除后通过 `querySelectorAll` 同步清理主列表与搜索结果列表中的对应卡片节点，并异步刷新态势大盘资产总数。

### 2.4 CLI 终端快捷删除 (`src/cli.js`)
- 支持 `memhub delete <id>` 与 `memhub rm <id>`；
- 未传 ID 输出标准用法并以状态码 1 退出；
- 默认交互流提示 `⚠️ 确认要彻底物理删除知识卡片 [${id}] 吗？(y/N): `；
- 支持 `-y` / `--yes` / `--force` 免确认静默删除，适合批处理脚本；
- 帮助菜单 `printHelp()` 同步补全。

---

## 3. 质量门禁数据
- 自动化测试套件扩充为 **15 大测试套件**；
- 专项测试 `tests/test-deletion.js` 与全量回归 `tests/e2e.js` 均 100% 绿灯通过。
