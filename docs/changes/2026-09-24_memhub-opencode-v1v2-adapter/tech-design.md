# 技术方案设计：OpenCode v1/v2 双版本 API 自动适配 (Technical Design - 修订版 v2)

> 变更编号：2026-09-24_memhub-opencode-v1v2-adapter
> 状态：待评审（Phase 1 设计评审第二轮）
> 修订原因：v1 方案经 3 视角评审 REJECTED，且真机实测（OpenCode 2.0.15）证实 R1/R2 为真实事故、推翻 R10 假设。
> 事实依据：`verification.md`（真机实测，非假设）、`design-review.md`（评审裁决）

## 0. v1 → v2 修订摘要（先说改了什么）

| 项 | v1 设计（已被证伪/否决） | **v2 设计（基于真机事实）** |
|---|---|---|
| 完成判定 | 依赖 `/api/session/active` + `time.completed\|\|streamed` | **改用以 `type:'idle'` 消息 + `outcome` 为主的完成信号** |
| 分页 | 未处理（裸 GET） | **显式 `order` + `cursor` 翻页拉全** |
| `/api/session/active` | 用作「idle/running」判定 | **降级为辅助信号**（真机证实：它只表示「有活跃任务」，与 forked 会话的存在/完成无关） |
| 认证 | 存疑（R10） | **确认 V2 接受 Basic Auth，无需改动** |
| fork 识别 | 仅标题正则 | 标题正则真机有效；**补 `Session.Info.fork` 字段判定作为权威兜底** |
| 测试 | V2 测试未入 CI | **纳入 `e2e.js` suites** |

## 1. 背景与问题（不变）

MemHub 通过主动调用 OpenCode HTTP Server 注入沉淀指令，由宿主 LLM 调 `memhub_save` 完成记忆抽取。调用集中在 `src/host/opencode-client.js`，被 `daemon.js`（定时抽取）、`dream/pipeline.js`（做梦）复用。

OpenCode 2 对服务端 API 做了刻意破坏性变更，v1 调用在 v2 宿主上失效。

## 2. 真机事实基础（v2 方案的唯一依据）

> 全部来自 `verification.md`，在运行中的 **OpenCode 2.0.15** 上实测，非推断。

### F-1 版本探测 ✅ 可用
- `GET /api/info`（带 Basic Auth）→ `{"version":"2.0.15","pid":7692,...}`
- `GET /global/health` → **200 + SPA HTML**（非 404）。靠 `JSON.parse` 失败排除，判定仍正确。
- `detectApiVersion` 真机判为 **V2**（正确）。

### F-2 认证 ✅ V2 接受 Basic Auth
- 无凭据 `/api/info` → 401 + `WWW-Authenticate: Basic`
- 带凭据 → 200。**R10 风险消除**。

### F-3 会话对象字段 ✅ 归一化生效
- `location.directory`、`time.{created,updated,idle}` 真实存在；`parentID` 对 root 会话为空（与 v1 一致）。
- `listCandidateSessions` 端到端返回候选，`directory` 正确。

### F-4 🔴 `type:'idle'` 消息真实存在，是权威完成信号
- 单会话类型分布：`{assistant:60, user:4, idle:3}`；6 会话抽样全部含 `idle`。
- `Session.Info.outcome` = `succeeded`。
- **用途**：作为 V2 完成判定主信号。

### F-5 🔴 fork 副本**不在** `/api/session/active`，导致秒短路（R1 确证）
```
fork 空会话 → getSessionStatus(fork) => idle
            → waitForSessionIdle => completed=true（1015ms）
```
- 因果链：不在 active → 判 idle → `waitForSessionIdle` 首轮短路 → `daemon.js:490` 删 fork → **抽取 100% 丢失**。
- 注入 prompt 后 fork **才**进入 active（`inActive=true at t=1.5s`）。
- **结论**：`/api/session/active` 只表达「是否有活跃任务」，**不能**用于判断「会话是否存在/是否完成」。

### F-6 🔴 消息接口默认 50 条 + 默认 desc（R2 确证）
- `GET /api/session/:id/message`（裸）→ 50 条、倒序（新→旧）、`cursor.next` 非空（实测某会话 67 条 / 5 页）。
- 现码 `arr[arr.length-1]` 取到的是**最旧**消息 → 完成度判定错位。

### F-7 fork 标题真机追加 `(fork #N)`，且返回体带权威 `fork` 字段
```
title="opencode1 与 opencode2 接口兼容性分析 (fork #1)"
fork={"sessionID":"...","boundary":{"type":"through","messageID":"..."}}
```
- 标题正则真机有效；`fork` 字段可作权威兜底。

### F-8 未验证项（如实保留）
- 「流式中仅有 `streamed` 无 `completed`」：未抓到中间态。
- V1 宿主是否存在 `/api/info`：本机仅 V2。

## 3. 目标与非目标

**目标**
- v1 / v2 宿主上都能完成「发现 → 列候选 → fork → 注入 → **可靠判定完成** → 清理」全链路。
- 上层调用签名零改动。
- 完成判定**必须可靠**（杜绝秒短路丢数据）。

**非目标**
- 不迁移配置/AGENTS.md/skills（官方承诺兼容）。
- 不引入 TS SDK。

## 4. 方案设计（v2）

### 4.1 版本探测（保留，真机验证通过）
```
detectApiVersion(baseUrl):
  1. GET /api/info → 200 且 JSON 含 ServerInfo 特征字段 → V2
  2. GET /global/health → 200 且 JSON 含 healthy/version → V1
  3. 都不通 → null（上层按 V1 兜底）
```
- **收紧判据**：`/api/info` 判定要求 `version && pid !== undefined && urls !== undefined && paths?.tmp !== undefined`（对齐 ServerInfo 四必填字段），避免「任意含 version 的 JSON」误判（R7）。
- **依赖 JSON 解析排除 SPA HTML 兜底**（F-1），代码显式注释说明该隐式保护。
- 按 `baseUrl` 缓存（`clearApiVersionCache()` 供 server 重启时清）。

### 4.2 完成判定（核心重写，替代 v1 的 active + streamed）—— ✅ 已实现

**新的完成判定优先级（与 `getLastAssistantProgress` 实现一致）**：
```
判定会话是否抽取完成（按版本分流）：
  信号1（权威，仅看 baseline 之外的新增消息）：存在 type:'idle' 消息
              - outcome === 'succeeded'          -> completed=true  (status='success')
              - outcome ∈ {failed, interrupted}  -> completed=false (status='failed')  立即结束，交上层置 FAILED
  信号2（回退）：baseline 之外末条 assistant 的 time.completed 存在 && content 非空 -> completed=true
  信号3（兜底）：超时 -> completed=false (status='timeout')，上层置 FAILED 可重试
```
- **移除**：`time.streamed ||` 的 OR 判定（R3）。
- **移除**：以 `/api/session/active` 作为「idle」短路依据（真机 F10/F11 证其不表示完成）。
- `getSessionStatus` 在 V2 下**不再**把「不在 active」映射为 `idle`；改为：在集合 → `running`；不在集合 → `unknown`。
- **V1/V2 分流**：V1 保留 `status==='idle'` 短路（V1 语义有效）；V2 不走 status 短路，主路径为消息层判定。
- **布尔关系裁决（消解"信号1 vs 信号2"歧义）**：信号1 一旦存在（idle 消息）即**优先且独占**判定权
  （succeeded 即成功、failed/interrupted 即失败）；信号2 仅在**无 idle 消息**时作回退。二者**非 OR 叠加**。

#### 4.2.1 🔴 关键：fork 副本继承历史 idle 的隔离（真机 F16/F16-b/F16-c）

**真机暴露的问题**：`fork` 出的副本**继承源会话全部历史消息**（含多条 `idle`+`succeeded`），
直接取「末条 idle」会把**继承的历史 idle** 误当本次抽取完成 → 刚 fork 就秒判完成（实测 2121ms）。

**锚点选择（两次修正）**：
| 方案 | 真机结果 |
|---|---|
| ① 用 `fork.boundary.messageID` 定位 | ❌ **不可行**：副本消息 ID 被整体重写、且 boundary 不在副本中 |
| ② **fork 后对副本消息 ID 快照，只认不在快照中的新增消息** | ✅ **可行**（真机双向验证通过） |

**实现**：
- 新增导出 `snapshotForkBaseline(baseUrl, forkId, { settleMs })`：等待副本复制稳定（默认 1.5s）后
  翻页读取副本全部消息，返回**消息 ID 的 Set 快照**。
- `getLastAssistantProgress(..., { baselineIds })` / `waitForSessionIdle(..., { baselineIds })`：
  只考量 `!baselineIds.has(id)` 的消息。
- `daemon.js`：fork 后立即 `snapshotForkBaseline`，把结果传给 `waitForSessionIdle`。
- **为何用「ID 差集」而非「数量变化」**：真机副本**始终只保留最近 100 条**（旧消息被挤出），
  总消息数恒定不变 → 只有 ID 差集能识别新增。

### 4.3 分页拉全（修复 R2）—— ✅ 已实现（真机 F13 修正）

> **重要修正**：v2 初稿写的「显式 `order=asc` + 循环 `cursor.next`」**被真机 F13 证伪**：
> `?order=asc&cursor=<c>` → **400 `InvalidCursorError: "Cursor cannot be combined with order"`**。
> `order` 与 `cursor` **不可组合**。

**实际实现（`readAllMessages`）**：
- **V1**：`/session/:id/message` 返回**裸数组**，无分页概念 → 一次性读取，**不传** `limit`/`order`。
- **V2**：`{data,cursor}` 信封，默认仅 50 条且默认 desc → **只带 `cursor` 翻页**（绝不同时带 `order`）；
  全程顺序恒为 **desc（新→旧）**，故「最新一条」= 数组**首元素**（`getLastAssistantProgress` 内部
  对 V2 数组 `reverse()` 后按升序统一处理）。
- 硬上限：`MESSAGE_MAX_PAGES=50` 页 / `MESSAGE_MAX_ITEMS=10000` 条；cursor 不推进即终止（防死循环）。
- `readSessionMessages` 与 `getLastAssistantProgress` 统一走 `readAllMessages`。
- `listCandidateSessions` 走 `listAllSessions`（V1 裸数组一次性；V2 cursor 翻页，`SESSION_MAX_PAGES=20`）。

### 4.4 fork 识别加固（R6）—— ✅ 已实现
- `isSubagentSession` 增加权威判定：`if (session.fork?.sessionID) return true;`（真机 F14 已证列表元素携带该字段）。
- 保留标题正则作兜底（真机 F9 证 fork 确实追加 `(fork #N)`）。
- `agent` 白名单改**黑名单**式（`SUBAGENT_AGENTS = {review, explore, general, image-reader, subagent}`），
  未知 agent（如 `plan`）默认放行，避免误杀新主模式（R6b）。
- **DB 路径差异**：`adapters/opencode.js` 走 SQLite，无 `fork` 字段，仍靠标题正则兜底。

### 4.5 请求体映射（保留，真机验证通过）
| 函数 | V1 | V2 |
|---|---|---|
| 建会话 | `{title, directory}` | `{title, location:{directory}}` |
| fork | `{messageID}` | `{before}` |
| prompt | `{noReply,parts:[...]}` | `{text}` |

### 4.6 dry-run 零请求契约（保留）—— ✅ 已实现
- dry-run 分支只用**已缓存**版本推断 URL，绝不发起网络请求（含探测）。
- **已知局限（P1 记录）**：首次 dry-run 时缓存为空，会按 V1 兜底展示 URL；此为「零请求契约」的必然取舍，接受。

### 4.7 异常路径与超时上限（补 R12）—— ✅ 已实现
- 各 HTTP 调用对 401/404/500/非 JSON/超时给出明确错误与降级；`waitForSessionIdle` 中
  status/消息读取异常不致命（转 unknown / 跳过），最终以 `status:'timeout'` 收尾，**绝不误判成功**。
- `sawReply` 已闭环：作为返回值字段透出（`waitForSessionIdle` 返回），供上层观测是否见过 assistant 回复。

## 5. 影响面分析（已落地）

| 文件 | 改动 |
|---|---|
| `src/host/opencode-client.js` | 探测加固（安全顺序）；`readAllMessages`/`listAllSessions` 分页；`getLastAssistantProgress` 三态；`waitForSessionIdle` 版本分流；`getSessionStatus` V2 改 unknown；`isSubagentSession` 加 fork 权威字段 + agent 黑名单 |
| `src/daemon.js` | **超时/失败置 FAILED 而非 EXTRACTED**（P0-3 静默腰斩修复），成功才置 EXTRACTED |
| `src/dream/pipeline.js` | 无签名改动（消息读取自动走翻页版；**新建会话无历史消息，故不需要 baseline**——无继承 idle 风险） |
| `tests/test-host-client-v2.js` | 重写：16 项（含 T1 秒短路成对 / T2 V1 裸数组回归 / T3 failed 三态 / T4 分页 / R3 streamed） |
| `tests/e2e.js` | **纳入 v2 套件**（R4）——suites 由 15 项增至 16 项 |
| `docs/.../tech-design.md` | 本文件（已按实现与真机对齐） |

## 6. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 宿主不产 idle 消息 | 中 | 保留 assistant.completed 回退 + 超时兜底（置 FAILED 可重试）；真机已证 idle 必现 |
| 翻页引入额外请求/延迟 | 低 | 显式 limit=200 + 页数/条数硬上限；抽取场景消息量可控 |
| 「流式中仅 streamed」中间态未验证 | 低 | 已移除 `streamed` 判定（只用 completed），此路径不再影响判定 |
| V1 宿主是否存在 `/api/info`（跨版本误判） | 低 | 判定需 JSON + ServerInfo 特征字段，误命中概率极低 |
| 真机仅覆盖 V2.0.15 单一版本 | 中 | 探测层按需重探；文档标注适配基线版本 2.0.15 |

## 7. 验证证据

- 真机实测：`verification.md`（F-1~F-15）
- V1 回归：`tests/test-host-client.js` **14 项 PASS**
- V2 适配 + 回归：`tests/test-host-client-v2.js` **16 项 PASS**（含 R1/R2/R3/R11 回归）
- 测试入链：`tests/e2e.js` suites 现含 v2 套件（共 **16** 个套件）
- 复现脚本：`scripts/verify-opencode-v2.js`、`verify-opencode-v2-deep.js`、`verify-fork.js`、`verify-order-cursor.js`、`verify-fork-field.js`
