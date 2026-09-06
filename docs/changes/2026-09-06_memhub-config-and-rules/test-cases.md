# 测试用例清单 (Test Cases) (全量回归版)

## 1. 真实执行用例矩阵

| 用例ID | 场景 | 类别 | 前置条件 | 测试步骤 | 预期结果 | 关联契约 | 结果 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-CLI-01** | bin 映射规范 | 契约 | 读取 `package.json` | 检查 bin 包含 `memhub`, `mem-hub`, `memory-hub`, `exo` | 彻底不含 `hub` | 主路径 1 | ✅ 通过 |
| **TC-CLI-02** | CLI 运行与帮助 | 正常 | 执行 `node src/cli.js` | 捕获 stdout 帮助信息 | 包含 `MemHub` 且退出码 0 | 主路径 1 | ✅ 通过 |
| **TC-PF-01** | Exclude 黑名单拦截 | 正常 | 构造 `PathFilter({ exclude: ['**/tmp/**', '**/node_modules/**'] })` | 传入 `D:/workspace/tmp/my-proj` 与 `.../tmp` | 返回 `false` | 主路径 3 | ✅ 通过 |
| **TC-PF-02** | Windows 反斜杠与大小写归一 | 正常 | 构造 `PathFilter({ exclude: ['**/my-secret-project/**'] })` | 传入 `D:\Workspace\MY-SECRET-PROJECT` | 返回 `false` | 主路径 3 | ✅ 通过 |
| **TC-PF-03** | Include 白名单正常放行 | 正常 | 构造 `PathFilter({ include: ['**/target-proj/**'] })` | 传入 `D:/workspace/target-proj` 及其子路径 | 返回 `true`，其他返回 `false` | 主路径 4 | ✅ 通过 |
| **TC-PF-04** | Exclude 严格优先于 Include | 边界 | 包含 `target-proj` 但排除 `private` | 传入 `D:/workspace/target-proj/private/keys` | 返回 `false` | 主路径 3 | ✅ 通过 |
| **TC-PF-05** | 特殊正则字符安全转义 | 边界 | 模式包含 `v0.2.1-beta+test` 与括号 | 传入同名路径与不带符号的干扰路径 | 精确匹配无报错，不通配干扰项 | 边界/异常 | ✅ 通过 |
| **TC-PF-06** | watchDirectories 根目录限制 | 正常 | 设置根目录 `D:/workspace/allowed-root` | 传入同盘非根目录及异盘路径 | 非目标根目录下 100% 返回 `false` | 主路径 5 | ✅ 通过 |
| **TC-PF-07** | 空值与非法参数防御 | 异常 | 传入 `null`, `undefined`, `""` | 调用 `isMatch` | 100% 返回 `false` 不崩溃 | 边界/异常 | ✅ 通过 |
| **TC-PF-08** | 前缀边界防误杀 | 边界 | exclude 设置 `**/tmp` | 传入 `D:/workspace/tmp-data` | 返回 `true`，杜绝前缀误杀 | 边界/异常 | ✅ 通过 |
| **TC-CFG-01** | 默认配置兜底 | 正常 | 无配置文件环境 | 调用 `getConfig()` | `idleMinutes === 120`，数组完整 | 边界/异常 | ✅ 通过 |
| **TC-CFG-02** | 环境变量与非法值防腐 | 异常 | 设置 `MEMHUB_IDLE_MINUTES="-10"` 或 `"abc"` | 调用 `getConfig()` | 安全纠偏回默认 `120` | 边界/异常 | ✅ 通过 |
| **TC-ADPT-01** | 动态静默时间阈值过滤 | 契约 | 插入 10 分钟热会话与 45 分钟冷会话，指定 `idleMinutes: 30` | 调用 `scanCandidateSessions` | 热会话被过滤，冷会话被召回 | 主路径 2 | ✅ 通过 |
| **TC-ADPT-02** | 自循环防卫 SQL 排除 | 契约 | 插入含 `[MemHub]` 与 `[MemoryHub]` 标题的会话 | 调用 `scanCandidateSessions` | 100% 不在候选结果中出现 | 主路径 6 | ✅ 通过 |
| **TC-ADPT-03** | 适配器 scanRules 路径拦截 | 集成 | 注入 exclude `['**/tmp/**']` | 调用 `scanCandidateSessions` | 命中 tmp 目录的冷会话被拦截 | 主路径 3 | ✅ 通过 |
