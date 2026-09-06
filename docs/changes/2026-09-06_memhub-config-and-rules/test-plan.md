# 测试方案设计 (Test Plan) (修订版 v2)

## 1. 测试范围与覆盖策略
本次验证建立分层测试网：
1. **单元测试 (`tests/test-path-filter.js`)**：全面测试 `PathFilter` 的模式编译、Windows 盘符、反斜杠归一、正则特殊字符转义、根目录监听、黑白名单优先级及空路径异常防御；
2. **配置测试 (`tests/test-config.js`)**：测试 `getConfig()` 的动态读取、环境变量覆盖、默认兜底与非法值纠偏；
3. **集成测试 (`tests/test-adapters.js` & `tests/test-storage.js`)**：验证 `OpenCodeAdapter` 真实根据 `scanRules` 与 `idleMinutes` 过滤候选会话，且排除自循环 `[MemHub]` 标题；
4. **端到端测试 (`tests/e2e.js`)**：确保 Stdio MCP、CLI 启动以及跨层调用 100% 绿灯。

---

## 2. 细化测试用例清单矩阵 (10 个核心场景)

| 用例编号 | 测试模块 | 场景说明 | 输入数据 | 预期结果 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-PF-01** | PathFilter | 正常排除 (Exclude) | 目录 `D:/workspace/tmp/test-proj`，exclude `["**/tmp/**"]` | 返回 `false` (拦截) |
| **TC-PF-02** | PathFilter | Windows 反斜杠与大小写归一 | 目录 `D:\Workspace\MyProj`，exclude `["**/myproj/**"]` | 返回 `false` (统一小写匹配拦截) |
| **TC-PF-03** | PathFilter | 正常包含 (Include) | 目录 `D:/workspace/target-proj`，include `["**/target-proj/**"]` | 返回 `true` (放行) |
| **TC-PF-04** | PathFilter | 排除覆盖包含 (Priority) | 目录 `D:/workspace/target/tmp`，include `["**/target/**"]`, exclude `["**/tmp/**"]` | 返回 `false` (Exclude 优先) |
| **TC-PF-05** | PathFilter | 特殊正则字符安全转义 | 目录 `D:/workspace/v0.2.1-beta+test`，include `["**/v0.2.1-beta+test/**"]` | 正则无报错且返回 `true` |
| **TC-PF-06** | PathFilter | 监听根目录 (WatchDirectories) 限制 | 目录 `C:/other/proj`，watchDirectories `["D:/workspace"]` | 返回 `false` (不在目标根目录下) |
| **TC-PF-07** | PathFilter | 空路径边界防御 | 目录 `null` / `undefined` / `""` | 返回 `false` (安全排除不崩溃) |
| **TC-CFG-01** | Config | 默认配置兜底 | 不传任何配置文件 | `idleMinutes === 120`，scanRules 为空 |
| **TC-CFG-02** | Config | 环境变量与非法值防腐 | 环境变量 `MEMHUB_IDLE_MINUTES="abc"` 或 `"-10"` | 安全回退到默认 `120` |
| **TC-ADPT-01** | Adapter | 会话防自循环排除 | 标题为 `[MemHub] 自动萃取` 的会话记录 | 不在候选列表中返回 |
