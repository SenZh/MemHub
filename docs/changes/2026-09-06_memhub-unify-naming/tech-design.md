# 技术方案设计：MemHub 命名全面收敛 (修订版 v2)

## 1. 命名映射与改动点清单

### 1.1 `package.json` 清单
- `name`: `"memhub"`
- `bin`:
  - `"memhub": "./src/cli.js"` (标准主 CLI)
  - `"mem-hub": "./src/cli.js"` (连字符 CLI 别名)
  - `"memhub-mcp": "./src/index.js"` (标准 Stdio MCP 服务入口)
  - `"exobrain-mcp": "./src/index.js"` (兼容历史配置)
  - `"exo": "./src/cli.js"` (兼容历史 CLI)
  *(注：彻底移除 `memory-hub` 命令)*

### 1.2 `src/index.js` (MCP Server)
- 将 `serverInfo.name` 从 `"memory-hub"` 更改为严格的 `"memhub"`；
- 将 `src/index.js:40` 工具描述中“存入 Memory Hub”修改为“存入 MemHub”；
- 启动日志统一为 `[MemHub MCP Server] 已启动，正在通过 stdio 监听请求...`；
- 异常日志统一为 `[MemHub MCP Server] 启动失败:`。

### 1.3 `src/storage.js` (备份文件命名)
- 修改 `src/storage.js:405`：备份镜像文件名模板从 `memory_hub_backup_${timestamp}.db` 修改为标准的 `memhub_backup_${timestamp}.db`。

### 1.4 `src/config.js` (兼容性契约保护白名单)
- 仅作为历史受保护的读取降级白名单：
  1. 环境变量：`MEMHUB_HOME` > `MEMORY_HUB_HOME` > `EXOBRAIN_HOME`；
  2. 物理目录：`~/.memhub` > `~/.memory-hub` > `~/.exobrain`；
  3. 项目级配置：`.memhub/config.json` > `.memory-hub/config.json` > `.exobrain/config.json`。

### 1.5 `src/cli.js`
- 帮助信息、打印路径及描述统一显示为 **MemHub**。

---

## 2. 产出契约 (Contract)

| 场景 | 完成标准（可证伪） | 验证方式 |
| :--- | :--- | :--- |
| **主路径 1：MCP Server 命名** | 启动 MCP Server 执行 `initialize`，返回的 `serverInfo.name` 必须精确为 `"memhub"`。 | 运行 `node tests/test-mcp-protocol.js` 校验断言。 |
| **主路径 2：Bin 命令收敛** | `package.json` 的 `bin` 包含 `memhub`, `mem-hub`, `memhub-mcp`, `exo`，不含任何 `memory-hub` 与 `hub`。 | 运行 `node tests/test-cli.js` 校验断言。 |
| **主路径 3：CLI 与 Prompt 文本无残留** | 执行 `node src/cli.js` 及其帮助信息、MCP 工具描述中绝对不包含带空格的 `Memory Hub`。 | 正则断言检查输出文本。 |
| **主路径 4：备份文件名规范** | 调用 `backupDatabase()` 生成的备份文件名必须严格以 `memhub_backup_` 开头。 | 单元测试断言文件名格式。 |
| **边界与兼容：平滑数据兼容** | 仅配置旧路径时，系统可透明加载已有数据，不会报错崩溃。 | 单元测试构造兼容目录断言。 |
