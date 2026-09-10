# 交付总结：MemHub WebUI 与内置 HTTP 服务端 (Release Summary)

## 1. 版本定位与目标
- **版本号**：v0.1.4 (WebUI Visual Dashboard & Zero-Dependency HTTP Server Release)
- **核心价值**：为 MemHub 工程暗知识中枢赋予直观的可视化“外脑工程资产驾驶舱（Brain Dashboard）”，彻底终结 Agent 记忆与沉淀的黑盒状态。
- **零负担理念**：服务端基于 Node.js 原生 `node:http` 模块（0 外部 Web 框架依赖），前端采用无构建单文件 SPA（0 打包工具链依赖），开箱即用、轻盈敏捷。

---

## 2. 交付核心能力概览

### 2.1 现代化交互工作台 (WebUI SPA)
1. **态势与资产大盘 (Dashboard)**：
   - 四大顶层核心 KPI：长效资产总量、做梦 L4 升华沉淀数、会话萃取漏斗转化数、SQLite 数据库单文件物理体积；
   - 四大约束分类（Learnings / Decisions / Patterns / Business）占比柱状分布；
   - 做梦引擎离线自省成效透视（已封存碎片数、碎片封存率、熔炼总轮次、当前候选池水位）；
   - MCP 工具调用热度分布与已规避 Token 估算；
   - 项目维度资产矩阵分布表格（可直观查看每个项目的排错、决策、模板、业务明细）。
2. **知识全景浏览器 (Knowledge Explorer)**：
   - 多维参数收窄：分类 Pill 切换、生命周期状态收窄（活跃 / 已熔炼 / 已废弃 / 全部）、项目过滤、技术标签收窄；
   - 两阶段渐进式展开：默认卡片仅展示 L1 强指纹摘要（单卡消耗低），点击即刻弹出抽屉沉浸展开 L2 全量结构化详情（技术根因、正解代码、排错误区、架构红线）与高亮渲染的 Markdown 正文。
3. **混合检索实验室 (Search Playground)**：
   - 交互式 Query 调试：支持自然语言与报错堆栈输入；
   - 双路融合透视：毫秒级展示检索耗时，并在卡片上透出经 RRF 倒数排名融合后的综合打分（Score），直观排查语义相关度。
4. **MCP 审计流水与运维控制台 (Audit & Ops)**：
   - 审计流水表格：时序记录外部 Agent（OpenCode / Cursor / Claude Code 等）调用 `memhub_search`、`get`、`save` 的耗时、Query 与命中条数；
   - 一键运维操作：Web 端安全触发 SQLite 原生 `VACUUM INTO` 热备份与一键全量导出为标准 Obsidian Markdown 文件树。

### 2.2 服务端架构与安全沙箱防线
- **安全沙箱 (Anti-Path Traversal)**：
  - 绝对路径规范化校验 `safePath === PUBLIC_DIR || safePath.startsWith(PUBLIC_DIR + path.sep)`；
  - 扩展名静态 MIME 白名单过滤，彻底阻断跳出沙箱读取源码或配置文件的漏洞。
- **网络边界与跨站防御 (CORS & CSRF)**：
  - 默认仅绑定本地回环地址 `127.0.0.1`；
  - 严格校验本地 Origin，严禁通配符 `*`；
  - 敏感写操作强制校验自定义请求头 `X-MemHub-Request: 1`，利用浏览器预检机制全面阻断 CSRF。
- **流量熔断与流式 Body 限额**：
  - 流式请求体设置硬编码上限 `MAX_BODY_SIZE = 1MB`，超出立即触发熔断并安全关闭 TCP socket。
- **伴生脱机与异常绝对隔离**：
  - 支持 `memhub ui` / `web` 独立启动并自动唤起默认浏览器；
  - 支持 `memhub daemon --ui` 伴生脱机运行，Web 服务异常被绝对隔离，绝不影响后台会话定时提炼主循环。

---

## 3. 质量门禁与测试数据
- **单元与安全测试**：`tests/test-web-server.js` 包含 9 大用例（含路径穿越、CSRF拦截、1MB熔断反例），100% 通过；
- **端到端测试**：`tests/e2e.js` 统一调度 14 大测试套件，全部 100% 绿灯通过；
- **向后兼容性**：存储层契约无破坏性变更，存量 CLI 与 MCP 协议 100% 保持原有表现。
