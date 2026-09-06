# 测试方案设计 (Test Plan) (修订版 v2)

## 1. 验证范围与策略
1. `tests/test-cli.js`：更新断言，验证 `package.json` 的 `bin` 严格对齐 `memhub`, `mem-hub`, `memhub-mcp`，不含 `memory-hub` 与 `hub`，且输出文本彻底不含 `Memory Hub`；
2. `tests/test-mcp-protocol.js`：更新断言，验证 `initialize` 响应中的 `serverInfo.name === 'memhub'`，且 MCP 工具描述不含 `Memory Hub`；
3. `tests/test-storage.js`：断言 `backupDatabase()` 生成的文件名必须以 `memhub_backup_` 开头；
4. `tests/test-config.js`：测试兼容白名单降级（物理目录与环境变量优先序）；
5. `npm test`：7 大测试套件全量跑通。

---

## 2. 细化测试用例清单矩阵 (6 大核心场景)

| 用例编号 | 测试模块 | 场景说明 | 预期结果 |
| :--- | :--- | :--- | :--- |
| **TC-NAME-01** | MCP Protocol | 初始化 Server Name 验证 | `initRes.result.serverInfo.name === 'memhub'` |
| **TC-NAME-02** | Package Bin | 命令收敛严格匹配 | `bin` 含有 `memhub`, `mem-hub`, `memhub-mcp`, 不含 `memory-hub` / `hub` |
| **TC-NAME-03** | CLI Text | CLI 文本防反弹扫描 | `node src/cli.js` 输出不含 `Memory Hub` |
| **TC-NAME-04** | Storage Backup | 备份文件命名规范 | `backupDatabase()` 产物以 `memhub_backup_` 开头 |
| **TC-NAME-05** | MCP Tools | 工具描述文本防反弹 | `tools/list` 所有工具描述中不得残留 `Memory Hub` |
| **TC-NAME-06** | Config Compat | 历史环境变量兼容降级 | 仅配置 `EXOBRAIN_HOME` 时系统正常识别并加载 |
