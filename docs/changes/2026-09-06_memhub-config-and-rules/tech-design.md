# 技术方案设计：MemHub 配置扩展与路径过滤引擎 (修订版 v2)

## 1. 命名与命令体系 (Naming Convention)

### 1.1 项目命名与 Package
- 项目名：`memhub`（版本升级至 `0.2.1`）
- 官方品牌显示名：**MemHub**
- CLI 映射配置 (`package.json`):
  ```json
  {
    "bin": {
      "memhub": "./src/cli.js",
      "mem-hub": "./src/cli.js",
      "memory-hub": "./src/index.js",
      "exobrain-mcp": "./src/index.js",
      "exo": "./src/cli.js"
    }
  }
  ```
  *(注：既彻底移除了通用冲突的 `hub` 命令，又完整保留了全称 `memory-hub` 作为 MCP 入口，向后兼容 `exo`)*

### 1.2 配置目录分层与优先级
- 优先级 1：环境变量 `MEMHUB_HOME`；
- 优先级 2：若存在旧目录 `~/.memhub/`，优先使用；
- 优先级 3：若不存在则平滑迁移兼容读取 `~/.memory-hub/` 或 `~/.exobrain/`。

---

## 2. 配置文件规范 (`config.json`)

在 `~/.memhub/config.json`（全局）或当前工程 `.memhub/config.json`（项目级）中支持如下配置：

```json
{
  "version": "1.0",
  "idleMinutes": 120,
  "scanRules": {
    "watchDirectories": [
      "D:/workspace"
    ],
    "include": [
      "**/my-important-project/**",
      "**/prod-service-*"
    ],
    "exclude": [
      "**/tmp/**",
      "**/scratchpad/**",
      "**/node_modules/**",
      "**/*demo*"
    ]
  }
}
```
*(环境变量 `MEMHUB_IDLE_MINUTES` 可直接覆盖 `idleMinutes`)*

---

## 3. 过滤引擎设计 (PathFilter 类)

在 `src/path-filter.js` 中实现 `PathFilter` 类，实例化时预编译正则表达式，避免高频匹配下的重复解析开销：

### 3.1 路径标准化算法
1. 统一转为 POSIX 风格正斜杠：`p.replace(/\\/g, '/')`；
2. 去除末尾多余斜杠：`p.replace(/\/+$/, '')`；
3. Windows 环境（`process.platform === 'win32'`）统一转小写，避免盘符及目录大小写误判。

### 3.2 安全 Glob 编译算法 (防时序踩踏与正则注入)
为防止 `**` 与 `*` 替换时产生互相踩踏，且防止特殊字符未转义引发崩溃，编译流水线严格执行：
1. **基础字符转义**：对除 `*`、`?` 以外的正则特殊字符（`[.+^${}()|[\]\\]`）进行转义：`\$&`；
2. **安全占位符替换**：
   - 将 `**` 替换为不可见安全占位符 `__GLOB_DOUBLE_STAR__`；
   - 将 `*` 替换为目录内匹配 `[^/]*`；
   - 将 `?` 替换为单个字符匹配 `[^/]`；
   - 将 `__GLOB_DOUBLE_STAR__` 最终置换为跨目录匹配 `.*`；
3. **首尾边界锚定**：
   - 若模式以 `/` 开头或带有绝对路径，则严格从头匹配 `^`；否则允许部分包含；
   - 构造出完整的 `new RegExp(pattern, 'i')`。

### 3.3 判定流序逻辑
对传入的会话路径 `sessionDirectory`：
1. **边界防御**：若路径为空或未定义（无工程绑定的临时会话），默认返回 `false`（安全排除）；
2. **第一道关卡：`watchDirectories` 根目录校验**：
   - 若未配置 `watchDirectories` 或为空数组，默认放行全库；
   - 若配置了 `watchDirectories`，则 `sessionDirectory` 必须位于至少一个被监听的根目录下（前缀匹配），否则立即拦截返回 `false`；
3. **第二道关卡：`exclude` 黑名单拦截**：
   - 若命中 `exclude` 中任意一项，立即返回 `false`（最高优先级拦截）；
4. **第三道关卡：`include` 白名单确认**：
   - 若 `include` 为空或未指定，默认返回 `true`（放行）；
   - 若指定了 `include`，则必须至少命中一项才返回 `true`，未命中返回 `false`。

---

## 4. 调用链路打通与适配器防卫设计

### 4.1 `ScannerService` 配置统一加载与透传
在 `src/pipeline/scanner-service.js` 中：
- 构造方法或 `scanAndProcess` 中统一调用 `getConfig()` 加载全局/局部配置；
- 支持从外部 options 接收覆盖参数（如 CLI 传入的 `--idle`、`--include` 等）；
- 调用适配器时透传：
  ```javascript
  this.adapter.scanCandidateSessions({
    limit,
    excludeIds,
    idleMinutes: mergedConfig.idleMinutes,
    scanRules: mergedConfig.scanRules,
    force: options.force
  });
  ```

### 4.2 `OpenCodeAdapter` SQL 防卫与过滤闭环
在 `src/adapters/opencode.js` 中：
1. **SQL 时间与自循环防卫**：
   ```sql
   SELECT id, title, directory, time_created, time_updated, model
   FROM session
   WHERE parent_id IS NULL
     AND title NOT LIKE '[ExoBrain]%'
     AND title NOT LIKE '[MemoryHub]%'
     AND title NOT LIKE '[MemHub]%'
     AND (time_updated < (? - ?) OR ? = 1)
   ORDER BY time_updated DESC
   LIMIT ?
   ```
   - 补充 `[MemHub]%` 前缀排除，杜绝萃取自循环；
   - 动态传入截止时间 `idleMs = idleMinutes * 60 * 1000`；
2. **实例过滤**：
   - 实例化 `const filter = new PathFilter(options.scanRules);`
   - 对 SQL 查询出的每个 candidate 校验 `if (!filter.isMatch(c.directory)) continue;`
   - 仅返回符合安全边界的会话。
