# 需求规格：MemHub 全局统一命名收敛

## 1. 用户原始需求全文
> "统一命名，MemHub，不是memory-hub"

## 2. 需求拆解与量化目标

### 目标 1：全系统命名严格收敛为 MemHub
- **官方标识**：唯一名称统一为 **MemHub**（代码标识统一为 `memhub`）；
- **彻底剔除**：彻底移除所有带短横线的 `memory-hub` 痕迹，统一归一化；
- **MCP 服务标识**：`src/index.js` 中的 Server Name 严格为 `memhub`；
- **CLI 命令映射 (`package.json`)**：
  ```json
  {
    "bin": {
      "memhub": "./src/cli.js",
      "mem-hub": "./src/cli.js",
      "memhub-mcp": "./src/index.js",
      "exobrain-mcp": "./src/index.js",
      "exo": "./src/cli.js"
    }
  }
  ```
  *(注：`memory-hub` 全面更名为 `memhub`，MCP 入口收敛为 `memhub-mcp`)*
- **配置与环境变量**：统一为 `MEMHUB_HOME` 与 `MEMHUB_IDLE_MINUTES`。

## 3. 验收完成标准
1. 全局搜索 `memory-hub`，除为了防止用户已有老数据丢失保留的平滑迁移读取兼容层外，所有对外暴露的命令、Server Name、帮助信息、文档 100% 替换为 **MemHub** / **`memhub`**；
2. 执行 `node src/index.js` Stdio 初始化，返回的 `serverInfo.name` 必须为 `"memhub"`；
3. `package.json` 的 `bin` 严格对齐 `memhub`, `mem-hub`, `memhub-mcp`, `exo`；
4. 全套单元测试与端到端测试 100% 绿灯通过；
5. 全程遵守 Phase 1~3 工作流双审要求。
