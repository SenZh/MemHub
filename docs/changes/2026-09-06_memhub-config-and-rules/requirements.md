# 需求规格：MemHub 命名统一与会话采集过滤治理

## 1. 用户原始需求全文
> "是叫MEM hub还是叫memory hub?你的 CLI 不要叫 hub 吧，应该叫 mem hub 或者是全称的 memory hub。你这个 hub 命令有点太通用了。而且，你需要把“两个小时”这个时间做成通用配置，支持用户自行配置。同时，还需要支持用户配置指定目录下的 session，使其支持自动采集，并且该自动采集功能需支持 include 和 exclude 两种方式。哥，我问你一下，你有完全按照我们的工作流去执行吗？方案设计、测试方案编写、代码编写，每一步都执行了双审吗？"
> "叫MemHub"
> "按照工作流执行"

## 2. 需求拆解与实现目标（可量化）

### 目标 1：统一命名为 MemHub，规范 CLI 命令
- 项目与品牌全称统一为 **MemHub**（npm package: `memhub`）；
- CLI 命令绑定为 `memhub` 与 `mem-hub`（彻底移除通用的 `hub`，保留 `exo` 作为向后兼容别名）；
- 配置目录收敛为 `~/.memhub/`（平滑兼容现存 `~/.memory-hub/` 与 `~/.exobrain/`）。

### 目标 2：静默完成态时间全面可配置（拒绝硬编码 2 小时）
- 支持在 `config.json`（全局或项目级）或环境变量 `MEMHUB_IDLE_MINUTES` 中配置 `idleMinutes`（默认 120 分钟）；
- 扫描器根据动态传入或配置的时间阈值判断会话是否达到静默完成态。

### 目标 3：指定目录扫描与 include / exclude 过滤规则引擎
- 支持配置扫描目标根目录 `watchDirectories`（默认扫 OpenCode 全库或指定目录列表）；
- 支持 `include` 规则（glob 模式或路径前缀数组）：仅采集命中包含模式的工程目录；
- 支持 `exclude` 规则（glob 模式或路径前缀数组）：排除临时目录、私有测试目录、忽略目录（例如 `**/tmp/**`, `**/scratch/**`, `**/node_modules/**`）；
- 规则优先级：`exclude` 具有最高优先级，命中 exclude 即刻跳过，哪怕满足 include。

## 3. 验收完成标准
1. CLI 命令 `memhub --help` 和 `mem-hub --help` 均可正常输出命令帮助；
2. 当配置 `idleMinutes: 30` 时，仅筛选更新时间在 30 分钟前的已结束会话；
3. 当配置 `scanRules: { exclude: ["**/ignore-demo/**"] }` 时，任何位于 `ignore-demo` 目录下的会话 100% 被过滤跳过；
4. 当配置 `scanRules: { include: ["**/target-proj/**"] }` 时，非目标路径会话 100% 被过滤跳过；
5. 全流程遵守工作流管道双审规范（设计、代码、测试三阶段双审全部落盘）。
