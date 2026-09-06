# 测试执行结果报告 (Test Results) (全量回归版)

## 1. 测试套件执行汇总

| 测试套件 (Suite) | 执行脚本 | 用例数 | 通过数 | 失败数 | 通过率 | 覆盖主要标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Suite 1: CLI 命令规范与 bin 映射** | `node tests/test-cli.js` | 2 | 2 | 0 | 100% | 契约主路径 1 |
| **Suite 2: PathFilter 路径过滤引擎** | `node tests/test-path-filter.js` | 8 | 8 | 0 | 100% | 契约主路径 3, 4, 5 及特殊正则字符转义 |
| **Suite 3: Config 动态配置与防腐** | `node tests/test-config.js` | 2 | 2 | 0 | 100% | 环境变量覆盖与默认兜底 |
| **Suite 4: 基础设施与 SQLite 内核** | `node tests/test-storage.js` | 5 | 5 | 0 | 100% | 字段分层、查重防线、VACUUM 热备 |
| **Suite 5: 适配器层与真实防卫测试** | `node tests/test-adapters.js` | 5 | 5 | 0 | 100% | 契约主路径 2 (时间过滤), 主路径 6 (自循环) |
| **Suite 6: 知识提炼与状态机** | `node tests/test-extractor.js` | 2 | 2 | 0 | 100% | 闲聊过滤与启发式提炼 |
| **Suite 7: Stdio MCP 协议与渐进式** | `node tests/test-mcp-protocol.js` | 6 | 6 | 0 | 100% | 两阶段渐进披露与双命名空间 |
| **总计** | `npm test` (全量调度) | **30** | **30** | **0** | **100%** | **契约 100% 覆盖** |

---

## 2. 宿主集成与环境兼容
- OpenCode MCP 热连通探测通过；
- Windows 平台文件锁定问题通过适配器 `close()` 机制彻底规避。
