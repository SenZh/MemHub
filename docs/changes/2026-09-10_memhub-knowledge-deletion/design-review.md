# Phase 1 设计审查报告：支持手动删除记忆 (Design Review) (已通过)

## 1. 阶段概述
针对 MemHub 新增“手动删除记忆”功能的需求与技术方案（`requirements.md` 与 `tech-design.md`），执行了主 Agent 与 Review Subagent 多轮双审流程。

---

## 2. 审查与整改历程

### 轮次一：初审发现与整改要求 (REJECTED)
- **Review Subagent 发现的关键缺陷**：
  1. **[P0 阻塞] 误用未定义的 `db.transaction()` API**：`node:sqlite` 原生 `DatabaseSync` 无此方法（此为 `better-sqlite3` 专属），运行时会直接抛出 `TypeError` 崩溃；
  2. **[P0 阻塞] try-catch 吞没 FTS/向量错误违背事务原子回滚**：使用内部空 `try-catch` 会导致失败时不回滚直接 COMMIT，产生孤儿索引与幽灵召回；
  3. **[P1 重要] 遗漏 `POST /api/ops/delete` 兼容路由设计**；
  4. **[P1 重要] WebUI 确认弹窗未展示卡片标题**；
  5. **[P1 重要] CLI 缺参及取消流、退出码未定义**；
  6. **[P2/P3] DOM 视图联动与流排空问题**。

### 轮次二：复审整改与流冲突发现 (REJECTED)
- **整改落实**：
  - 采用原生 SQLite `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 显式事务，消除内部空 try-catch；
  - 补齐确认弹窗标题与 CLI 参数流。
- **复审新发现**：
  - **[P1 逻辑冲突] `POST /api/ops/delete` 兼容路由与 `req.resume()` 存在数据流冲突**：全局无差别 `req.resume()` 会导致 Body 被提前排空，无法读取 `{ id }`；
  - **[P2 前端契约] 现有卡片 DOM 未挂载 `data-card-id` 属性**，导致即时清理 DOM 无法生效。

### 轮次三：全面分流重构与终审通过 (APPROVED)
- **终审整改落实**：
  1. **严格流分流**：重构服务端逻辑，移除 `/api/ops/` 前置全局 `req.resume()`，仅对无 Body 的 `backup` / `export` 分支按需执行；`DELETE` 路由显式 `req.resume()`；`POST /api/ops/delete` 路由调用 `await readJsonBody(req)` 安全读取 `{ id }` 并做缺参防呆；
  2. **前端 DOM 补齐**：全景列表与检索实验室卡片外层 `<div>` 均补齐 `data-card-id="${item.id}"`；
  3. **弹窗上下文变量**：`openDetail` 缓存 `currentDetailItem`，二次确认弹窗动态呈现标题与 ID；
  4. **日志加固**：事务回滚追加 `console.error` 详细堆栈。
- **终审结论**：**APPROVED（通过）**。

---

## 3. 裁决结论
Phase 1 设计双审流程闭环，准予进入 Phase 2 代码实现与测试验证。
