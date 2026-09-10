# Phase 1 设计审查报告 (Design Review) (已通过)

## 1. 阶段概述
针对 MemHub 新增 WebUI 与内置 HTTP 服务的架构设计方案（`requirements.md` 与 `tech-design.md`），执行了主 Agent 与 Review Subagent 双审流程。

---

## 2. 审查与整改历程

### 轮次一：初审发现与整改要求 (REJECTED)
- **Review Subagent 发现的关键问题**：
  1. **[P0 阻塞] 原生静态资源伺服缺乏路径穿越（Path Traversal）与沙箱逃逸防护**；
  2. **[P0 阻塞] 混合检索实验室 API 契约与底层数据层断层，RRF 综合得分丢失**；
  3. **[P0 阻塞] 未定义跨域资源共享（CORS）与跨站伪造（CSRF）防护**；
  4. **[P1 重要] 知识浏览接口未提供状态过滤与分页**；
  5. **[P1 重要] 缺少端口冲突容错机制与优雅退出（Graceful Shutdown）闭环**；
  6. **[P1 重要] `memhub daemon --ui` 伴生模型未做参数透传与异常隔离**；
  7. **[P1 重要] 原生浏览器调起方案及命令注入防范缺失**；
  8. **[P1 重要] 原生 HTTP 请求体（Body）未设字节上限存在 OOM 拒绝服务隐患**；
  9. **[P2/P3] 关键安全边界测试用例遗漏与 Controller 物理指标组装未明确**。

### 轮次二：全面整改与复审裁决 (APPROVED)
- **主 Agent 落实修订方案**：
  1. **安全沙箱**：制定 `path.resolve(publicDir, '.' + reqPath)` 绝对路径归一化，硬编码 `safePath.startsWith(publicDir)` 边界校验，限定 `.html`, `.css`, `.js`, `.json`, `.svg`, `.png` 扩展名白名单；
  2. **混合检索得分打通**：在 `src/storage.js` 的 `searchKnowledge` 扩展 `options.includeScores = true` 参数，保持存量 CLI/MCP 纯净兼容的同时，向 Web 端透出真实 RRF 得分与耗时；
  3. **CORS 与 CSRF 防护**：严格回环 Origin 校验（仅允许 `localhost` / `127.0.0.1`，严禁通配符 `*`）；敏感写操作强制校验 `Content-Type: application/json` 与自定义请求头 `X-MemHub-Request: 1` 触发浏览器预检；
  4. **状态过滤与分页**：扩展 `storage.listRecent` 支持 `status`（`active` / `superseded` / `consolidated` / `all`）、`offset` 与 `limit`（上限 200）；
  5. **端口冲突与优雅退出**：捕获 `EADDRINUSE` 友好告警，挂载 `SIGINT/SIGTERM` 执行 `server.close()`；
  6. **伴生模型健全**：在 `daemon.js:startDaemonBackground` 派生子进程中透传 `--ui`，HTTP 服务挂载独立未捕获异常隔离，保障 Web 故障不影响定时提炼主循环；
  7. **安全浏览器拉起**：按操作系统分支安全调用原生命令（Windows / macOS / Linux），URL 采用受控参数硬编码拼接；
  8. **1MB Body 熔断**：流式解析器硬编码 `MAX_BODY_SIZE = 1MB`，超限即时销毁流并响应 HTTP 413 Payload Too Large；
  9. **测试用例扩充**：测试计划补齐路径穿越防御、1MB 熔断、CSRF 头校验、非法 Action 校验用例。
- **Review Subagent 复审结论**：**APPROVED（设计通过）**。

---

## 3. 裁决结论
Phase 1 设计双审流程正式闭环，准予进入 Phase 2 代码实现与测试验证阶段。
