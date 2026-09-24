# 破坏性与风险评审报告：OpenCode v1/v2 双版本适配方案 v2

> **评审角色**：破坏性与风险评审员（Adversarial & Risk Reviewer），立场为怀疑与挑刺
> **审查对象**：`docs/changes/2026-09-24_memhub-opencode-v1v2-adapter/tech-design.md`（v2 方案，第二轮）
> **关联依据**：`verification.md`（真机实测 OpenCode 2.0.15）、`design-review.md`（v1 裁决 REJECTED）、`src/host/opencode-client.js`、`src/daemon.js`、`src/dream/pipeline.js`、`tests/test-host-client.js`、`tests/test-host-client-v2.js`
> **审查轮次**：第二轮（v1 已 REJECTED，v2 基于真机实测重写）
> **审查时间**：2026-09-24
> **评审纪律**：已排除被真机证伪的旧假设（F-9 fork 改标题、F-2 V2 接受 Basic Auth、F-10 fork 不在 active）；聚焦「v2 的修复是否引入新破坏 / 修了 A 坏了 B」

---

## 审查结论

**结论**: **REJECTED（不通过）**

## 审查摘要

v2 是一次**方案文档**（"技术方案设计"），其核心修复方向（改用 idle 消息判完成、分页拉全、fork 字段兜底）在真机事实支撑下是**正确且必然**的。但 v2 **在关键处存在"修了 A 坏 B"的连锁风险，且方案粒度不足以证明不会引入新破坏**：最严重的是 §4.3 分页统一的实现细节**完全空白**，而真机事实与现有代码共同证明 V1（裸数组、无 cursor）与 V2（`{data,cursor}`）的翻页终止条件**语义相反**，方案未给出区分逻辑；其次 §4.2 的完成判定重写与 `waitForSessionIdle` 的**短路优先级/超时语义**之间存在未消解的冲突，可能把 R1 的"秒短路丢数据"改成"5 分钟拖死 fork 泄漏"。**方案层面即不可放行**——因为这两点决定了实现者会用猜测填空，而任何一个猜错都直接导致数据丢失或资源泄漏。

## 发现详情

| 严重 | 发现 | 类型 | 位置 | 证据 | 建议 |
|---|---|---|---|---|---|
| P0 | **V1 分页翻页无兼容逻辑，必然破坏 V1** | 设计回归 | tech-design.md:109-112 | v1 `/session/:id/message` 返回**裸数组**（test-host-client.js:65-69 mock、opencode-client.js:368 `Array.isArray(payload)`），无 `cursor` 字段；方案 §4.3 只说"循环 `cursor.next` 翻页" | 见下文专项分析，必须补 V1/V2 分支终止条件 |
| P0 | **完成判定重写与 waitForSessionIdle 短路语义冲突，超时兜底可能拖死/泄漏 fork** | 设计缺陷 | tech-design.md:95-107 vs opencode-client.js:670/daemon.js:459-461/490 | V2 下永不返回 `idle`（改判 `unknown`），只能走信号2或 300000ms 超时；超时后仍删 fork 但**已耗 5 分钟/会话** | 明确 V2 完成判定路径与超时值的耦合，给出死信处理 |
| P1 | **desc 顺序取错"最后一条"在 v2 方案中未显式要求 `order` 参数落地** | 设计遗漏 | tech-design.md:110 | F-6 确证默认 desc；方案写"显式 `order=asc`"但未规定**同时存在 `cursor` 时 asc 是否生效**（真机仅验证 asc/desc 各自，未验证 asc+cursor 组合） | 补：`order=asc` 与 `cursor` 组合行为需真机确认，否则"兼容未验证" |
| P1 | **信号2（assistant completed）在 V2 的 `getLastAssistantProgress` 仍保留 `streamed` OR 判定，v2 只要求"移除 streamed"却未落到 §4.4 的明确代码改动** | 设计不一致 | tech-design.md:102-105 vs opencode-client.js:625 | 方案 §4.2 说"移除 `time.streamed \|\|`"，但代码 :625 仍是 `completed \|\| streamed`；影响面表 :137 未单列该函数 | 在 §5 改动清单中点名 `getLastAssistantProgress` 的具体行 |
| P1 | **R8 安全项在 v2 中完全消失，未说明处置结论** | 安全遗漏 | tech-design.md 全文无 R8 | v1 裁决 R8 为 P1；v2 §6 风险表无凭据外发项 | 至少显式写"沿用既有设计 + 独立工单"，不可静默丢弃 |
| P2 | **`unknown` 语义在 V1 下已有"不短路保护"，但 V2 改判 `unknown` 后信号1（idle）**永久失效**，方案未说明 `waitForSessionIdle` 是否仍保留信号1短路** | 设计歧义 | tech-design.md:107 | 方案说"恢复不短路保护"，但未说 waitForSessionIdle 是否删除 `status==='idle'` 短路分支 | 明确 R1 修复点是对齐 `getSessionStatus` 返回值还是改 `waitForSessionIdle` |
| P2 | **dry-run 未探测时按 V1 展示 URL 的误导问题未处理** | 契约 | tech-design.md:126-127 | §4.6 原样保留，dry-run 走 `cached || V1`（opencode-client.js:749-750），V2 首次 dry-run 会展示 `/session/:id/prompt_async`（错误端点） | 显式承认"未探测时 URL 可能为 V1 形态"或增加提示 |
| P2 | **`listCandidateSessions` 翻页会造成每轮扫描额外请求** | 性能 | tech-design.md:112 | daemon 每轮 tick（每 30 分钟）调用 listCandidateSessions，V2 会话若多页则每轮多请求 | 评估并给出 limit/页数上限，确认可接受 |

---

## 逐条回答审查点（审查点 1-8）

### 审查点 1：V1 回归风险 —— P0（最严重）

**「误伤 V1」结论：是，方案文字层面必然误伤。**

**(a) §4.2 改 `unknown` 是否误伤 V1？**
不完全误伤，但**前提是改动仅落在 V2 分支**。`getSessionStatus`（opencode-client.js:579-587）已有 V1/V2 分支：V1 已是 `if (!st) return 'unknown'`（:586）。v2 方案仅改 V2 分支（:581-582）为 `unknown`，**V1 分支不受影响**。此项 ✅ 无新回归——**但前提是方案没被实现者误读成"统一改"**。

**(b) §4.3 分页翻页在 V1 下会不会出错？—— 这是真正的新风险，P0。**

证据链：
- V1 响应是**裸数组**（无信封）：test-host-client.js:65-69 mock 返回 `JSON.stringify(mockMessages)`（数组）；opencode-client.js:147-150 `unwrap` 对数组直接原样返回；:368 用 `Array.isArray(payload)` 判定 V1 形态。
- V2 响应是 `{data, cursor}` 信封（verification.md F-6，test-host-client-v2.js:65）。
- v2 方案 §4.3 只写"循环 `cursor.next` 翻页直至取完或达上限"。

**若实现者写"统一循环 cursor.next"**：
- V1 数组无 `cursor` → `cursor.next` 为 `undefined` → 循环**第一轮即终止**（被 `undefined` 兜住）。这种情况**碰巧不坏**——但依赖"undefined 恰好 falsy"这个隐式前提，不是设计保证。
- **更危险的写法**：若实现者按 V2 逻辑解析 `payload.data`/`payload.cursor`，V1 裸数组 `payload.data === undefined` → 解析出空列表 → **V1 消息全丢**（agent 恒 `hasReply:false` → 完成判定永不成立 → 全部超时 5 分钟 → fork 泄漏 + 抽取 0）。

方案**没有给 V1 的翻页终止条件**（"无 cursor 即单页取全"），也没有规定"V1 不传 `limit`/`order` 参数"（V1 是否接受/理解这些 query 参数**未验证**）。这正是 v2 引入的新回归面。**必须补：`readAllMessages` 按 version 分支；V1 直接一次性读取（现行行为保留），V2 才走 cursor 翻页。**

---

### 审查点 2：完成判定替换的连带影响 —— P0

**`waitForSessionIdle` 返回值 `{completed, finalStatus}` 语义是否变化？**
- 上层 `daemon.js:468` 只读 `waited.completed` 与 `:471 waited.finalStatus`；`pipeline.js:232` 连返回值都不接。**签名未变，但语义从"status idle 即算完成"变成"idle 消息出现才算完成"**。
- V2 下 `getSessionStatus` 恒返回 `running`/`unknown`，**永不返回 `idle`** → `opencode-client.js:670` 短路失效 → 只能靠信号2 + 300000ms 超时。

**超时→fork 泄漏风险：确认存在，但结论是"拖慢"而非"泄漏"**：
- daemon.js:487-493 `finally` 无条件删 fork，即使超时也会删。所以**不泄漏**，但**已完成抽取的 fork 会白等满 5 分钟**（300000ms），期间 `session_tracking` 一直是 `EXTRACTING`，且 `tick` 有 `running` 重入锁（daemon.js:344），**这 5 分钟会阻塞整个 daemon 的下一轮调度**。
- 更糟：每轮最多 `limit`（默认 5）个候选，若每个都超时 5 分钟，一轮可达 **25 分钟**，超过 `intervalMinutes=30` 的调度周期，多轮叠加会出现"永远追不上"的退化。**v2 方案 §6 只提"超时兜底"，完全没量化这个 5 分钟×N 的级联。**

---

### 审查点 3：分页翻页的性能与死循环 —— P1

- **死循环**：若 `cursor.next` 返回**不推进**的值（如服务端返回相同 cursor），朴素 `while(cursor)` 会死循环。方案 :110 说了"设页数/条数上限"，✅ 有防护意识，**但没给上限具体值**，实现者可能设成 1000 页 → 实际变成"很久才停"。
- **每轮额外请求**：`listCandidateSessions` V2 若分页，每轮 tick 多 N 次请求。真机 F-4 显示候选 3 个，会话列表量级未知。**建议：会话列表用大 `limit` 单页（真机 `?limit=8` 可用），仅消息做翻页**。

---

### 审查点 4：`unknown` 语义的连带 —— P1

- V2 下确实**永远不返回 idle** → 完全走信号2 + 超时。**这条路径在真机是否走得通？**
  - 真机 F-12 证明：注入 prompt 后 assistant 消息会带 `time.completed`，信号2 **可行**。
  - 但 **F-8 明确标注"仅有 streamed 无 completed 的中间态未抓到"** → 信号2 的"完成"判据在流式中是否稳定**未验证**。若流式中短暂出现 `completed` 但 `content` 为空，`partsCount>0` 二次确认（opencode-client.js:677-683）可挡住；但**若 content 先写入后 completed 未及时落**，判定会滞后到下一轮（3s），可接受。
- **daemon 超时 = 300000ms（5 分钟）**（daemon.js:461）。**V2 抽取若耗时 >5 分钟 → 判超时 → 但 fork 仍被删**（daemon.js:490 无条件）→ 相当于**大会话的抽取被静默腰斩**（LLM 还在干活，fork 就被删了）。v2 §6 用了"保留现 maxWaitMs 语义"一笔带过，**没评估 V2 抽取（含 fork 全量上下文）是否普遍超 5 分钟**。风险真机未验证。

---

### 审查点 5：idle 消息可达性 —— P1

- 真机 F-4/F-7 样本的 idle 均来自**已完成会话**。**未验证**：LLM 抽取中途失败/中断时是否产 idle（`outcome` 可能为 `failed`/`interrupted`，方案 §4.2 :101 已把这两个纳入"已落定"，✅ 有覆盖意识）。
- **但**：若宿主**完全不产 idle**（如 OpenCode 某些版本/错误路径），方案 §6 :148 说"真机已证实 idle 必现"——**这是对单版本 6 个样本的过强归纳**（F-7 只抽样 6 个已 successful 的会话，样本选择偏差）。此时判定只能超时 → 见审查点 4 级联。
- **fork 泄漏**：不泄漏（finally 删），但**数据丢失**（超时即算 EXTRACTED 并删 fork，见 daemon.js:475-479——**注意：超时也会把 status 置 EXTRACTED**，这是现码就有的"超时即成功"逻辑，v2 未纠正）。

---

### 审查点 6：dry-run 契约 —— P2 ✅ 基本成立

- §4.6 "只用已缓存版本推断 URL，绝不发请求"——与 opencode-client.js:748-752 现实现一致，零请求成立。test-host-client.js:151、test-host-client-v2.js:189 均有断言。**✅ 无回归。**
- **遗留误导**：未探测时 `cached || V1`（opencode-client.js:750），V2 首次 dry-run 展示 `/session/:id/prompt_async`（V1 端点，实际 V2 应为 `/api/session/:id/prompt`）。**v2 方案未处理此点**，属方案粒度遗漏（P2）。

---

### 审查点 7：安全（R8）—— P1 遗漏

- **v2 全文未提 R8**，是**遗漏**而非有意（§6 风险表无此项）。
- **「V2 需凭据，探测时必须带凭据吗？」**：`/api/info` 无凭据返回 **401 + WWW-Authenticate**（F-1/F-2），有凭据 200。探测逻辑（opencode-client.js:77-91）已实现"先带 auth 再不带"的**双尝试**——即**先带凭据探，401 时再裸探**。这恰恰与建议的"先裸探、401 再带"**相反**，凭据会先发给任意被扫描端口（netstat 枚举的所有本地监听端口，:316-329）。
- **改进**：`/api/info` 若裸探返回 401 也是**强特征**（证明是 OpenCode），可"先裸探，200 或 401 即命中，仅在确认后才带凭据"——避免向无关本地服务首发凭据。**v2 必须表态**：是继续沿用（记债）还是修。

---

### 审查点 8：未覆盖项（R1–R13 在 v2 的处置对照）

| 编号 | 级别 | v2 处置 | 评价 |
|---|---|---|---|
| R1 | P0 | §4.2 改判 `unknown` + §4.2 移除 active 短路 | **方向对，但 §4.2 只改 `getSessionStatus` 返回值，未明确 `waitForSessionIdle:670` 的 `status==='idle'` 短路分支是否保留/删除** → 语义冲突未完全消解（见 P0-2） |
| R2 | P0 | §4.3 显式 order+cursor | **未覆盖 V1 分支** → 引入新回归（见 P0-1） |
| R3 | P0 | §4.2 "移除 `time.streamed \|\|`" | ⚠️ 仅文档声明，§5 改动清单未点名 `getLastAssistantProgress`，且**"仅 streamed 无 completed"中间态仍未验证**（F-8 自认） |
| R4 | P0 | §0/§5 "纳入 e2e.js suites" | ✅ 有明确处置，**但 v2 尚未落地**（e2e.js 现未含 v2，需核） |
| R5 | P0 | 未提 | **未明确处置**——v2 未再声明测试通过数，但也没说明如何避免重蹈"14/15 数字不符" |
| R6 | P1 | §4.4 fork 字段 + agent 黑名单 | ✅ 有明确处置 |
| R7 | P0(原P1) | §4.1 收紧四字段 | ✅ 有明确处置 |
| R8 | P1 | **完全未提** | ❌ 遗漏 |
| R9 | P1 | §4.7 "显式实现 sawReply 语义" | ✅ 有处置，但**未说明 sawReply 如何参与判定**（死字段复活为"参与"还是"删除"？仍模糊） |
| R10 | P1 | §0/§2 确认消除 | ✅ |
| R11 | P1 | §4.2 作为主信号 | ✅ |
| R12 | P1 | §4.7 异常路径 | ✅ 有原则，无细化 |
| R13 | P2 | 未提 | ❌ 未提及（可接受为"既有债延后"，但未标注） |

**未明确处置**：R5、R8、R13；**处置模糊**：R1（短路分支归属）、R3（未点名文件）、R9（sawReply 语义）。

---

## 两条 P0 的完整论证

### P0-1：V1 分页回归（v2 引入的最大新风险）

**触发条件**：实现者按 §4.3 字面实现"统一走 cursor 翻页版"，在 V1 宿主（`/session/:id/message` 返回裸数组）上调用 `readAllMessages` / `readSessionMessages` / `getLastAssistantProgress`。

**具体后果**：
- 最佳情况：V1 裸数组无 `cursor` 属性 → `cursor.next === undefined` → 循环首轮终止 → **碰巧可用**，但这是隐式巧合不是设计保证。
- 最坏情况：实现者按 V2 信封解析 `payload.data`（V1 下为 `undefined`）→ 解析出空数组 → **V1 消息读取全空** → `getLastAssistantProgress` 恒 `hasReply:false` → `waitForSessionIdle` 信号2 永不成立 → 每个 V1 会话都干等满 300000ms 超时 → 超时仍置 EXTRACTED 并删 fork（daemon.js:475-479 + :490）→ **V1 抽取 100% 静默丢失，且每会话多耗 5 分钟**。

**证据**：
- 代码：`opencode-client.js:146-151` `unwrap()` 对数组直接原样返回；`:368` 以 `Array.isArray(payload)` 判定 V1 形态；`tests/test-host-client.js:65-69` V1 mock 返回裸数组 `JSON.stringify(mockMessages)`；`test-host-client.js:323-349`（第 14 项）明确走 V1 消息完成度路径，是必须保绿的回归基线。
- 方案：`tech-design.md:109-112` §4.3 全文只有"显式 `order=asc` + 循环 `cursor.next` 翻页直至取完或达上限"，**未出现"V1 分支"字样**，未规定 V1 不传 `limit`/`order`。
- 真机：`verification.md` F-6 只证明 **V2** 有 `{data,cursor}` 与分页；**V1 是否分页、是否认识 `limit`/`order` 参数未做真机验证**（verification.md 第 161-162 行"尚未验证"列表亦未列此项，属真机盲区）。

**建议**：`readAllMessages(baseUrl, sessionId)` 内部按 `resolveVersion` 分流：V1 → 单次 GET（现行为），不传 `limit`/`order`，直接返回归一化数组；V2 → `order=asc` + 循环 `cursor.next`，设页数/条数硬上限（如 50 页 / 5000 条）。**并在 `tests/e2e.js` 与 `test-host-client.js` 第 14 项上回归验证 V1 路径不变。**

---

### P0-2：完成判定与超时语义冲突（超时级联 + 静默腰斩）

**触发条件**：V2 宿主运行 `daemon.js` 抽取流程（fork → inject → `waitForSessionIdle(maxWaitMs=300000)`）。

**具体后果**：
1. 语义冲突未消解：§4.2 要求 V2 的 `getSessionStatus` 在"不在 active"时返回 `unknown`（:107），但未明确 `waitForSessionIdle:670` 的 `if (status === 'idle') return {completed:true}` 短路分支是否删除。若**保留**分支：V2 永远等不到 `idle`，分支成为死代码，主路径只剩信号2/超时（等效于删了但没写清）；若**删除**分支：V1 也一并失去"status idle 短路"这一快速信号（V1 `getSessionStatus` 能返回 `idle`，属有效信号），**V1 完成判定被无谓劣化**。两难，方案未裁决。
2. 超时级联：V2 主路径退化为"信号2 或 300000ms 超时"。每会话最坏 5 分钟；`limit` 默认 5（daemon.js:376/opencode-client.js:438）→ 单轮最坏 25 分钟，逼近甚至超过 `intervalMinutes=30` 调度周期，叠加 `running` 重入锁（daemon.js:344）→ 调度拥塞、会话积压。
3. 静默腰斩：`daemon.js:475-479` 在 `waited.completed === false`（超时）时**仍把 tracking 置 EXTRACTED**，`:490` 无条件删 fork → 耗时 >5 分钟的抽取被删除且标记为"已完成"，**既丢数据又留下"已处理"假状态，永不重试**。

**证据**：
- 代码：`opencode-client.js:651-697`（`waitForSessionIdle` 全貌，:670 为 idle 短路、:653 默认 `maxWaitMs=300000`）；`daemon.js:459-461`（显式 `maxWaitMs:300000`）；`daemon.js:468-479`（超时分支置 EXTRACTED）；`daemon.js:487-493`（finally 无条件删 fork）；`daemon.js:343-345`（tick 重入锁）。
- 方案：`tech-design.md:95-107` §4.2 与 `:129-131` §4.7 均未量化超时级联，亦未纠正"超时即 EXTRACTED"。
- 真机：`verification.md` F-11 证明旧逻辑 1015ms 秒短路（R1）；F-12 证明注入后 assistant 带 `time.completed`（信号2 可用）；但 **F-8 自认流式中间态未抓到**，"信号2 的完成判据在流式中是否稳定"仍属**未验证**。

**建议**：
1. §4.2 显式裁决 `waitForSessionIdle` 短路分支归属（推荐：按 version 分流——V1 保留 `idle` 短路，V2 改用"idle 消息 + 信号2"）。
2. §6 量化"5 分钟 × 候选数"级联，或下调 `maxWaitMs`、或改为并发/自适应。
3. 纠正 `daemon.js:475-479`：超时应置 `FAILED` 而非 `EXTRACTED`，使超时会话可重试，杜绝静默腰斩。
4. 补真机验证：流式中间态（有 streamed 无 completed），关闭 F-8 未验证缺口。

---

## 汇总

- P0（阻塞）: **2 个**
  1. V1 分页翻页无兼容分支 → 破坏回归基线 14 项（尤其 test 14 的 V1 消息路径）
  2. 完成判定重写与 `waitForSessionIdle` 短路/超时语义冲突未消解，5 分钟×N 的超时级联未量化，且"超时即置 EXTRACTED 并删 fork"的现码逻辑会静默腰斩大会话抽取
- P1（重要）: **5 个**（asc+cursor 组合未验证、R3 未落文件、R8 遗漏、unknown 下信号1 归属、idle 可达性过强归纳/样本偏差）
- P2（讨论）: **3 个**（dry-run 误导 URL、listCandidate 翻页开销、sawReply 语义模糊）
- P3（信息）: 0

## 最终裁决

**REJECTED**

**阻塞项（放行门槛）**：
1. **V1/V2 分页分流**：`readAllMessages` 必须按 version 分支——V1 保持"裸数组一次性读取"，V2 才走 `order=asc + cursor` 翻页；方案需写明 V1 不传 `limit/order`（V1 是否理解这些参数**未验证**）。**举证：现有 tests/test-host-client.js 14 项必须全绿，其中第 14 项走 V1 消息路径。**
2. **完成判定闭环**：明确 V2 下 `waitForSessionIdle` 的判定路径（是否保留 `status==='idle'` 短路、信号2 如何成为主路径）、量化 5 分钟×候选数的级联影响，并纠正"超时即 EXTRACTED"的静默丢失语义（超时应置 FAILED 而非 EXTRACTED，或至少告警）。

**复审前置条件**：
- 补齐 R5、R8、R13 的明确处置（处置=修 / 记债，不能静默丢）
- 真机补验两项未验证项：`order=asc` + `cursor` 组合行为、流式中间态（有 streamed 无 completed）
- 明确 `getLastAssistantProgress`/`sawReply` 的具体改动行，纳入 §5 影响面

> 附注（不构成裁决）：v2 的**修复方向本身正确**，真机证据链（F-1~F-12）扎实，R1/R2/R10 的证伪与确证符合证据诚信要求。否决的是"方案粒度不足以落地且引入了未评估的 V1 回归面与超时级联"。补齐上述 2 项阻塞 + 3 项未处置，即可望转为 APPROVED。
