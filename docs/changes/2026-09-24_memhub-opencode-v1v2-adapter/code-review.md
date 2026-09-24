# 代码审查报告：OpenCode v1/v2 双版本适配修复实现

> 变更编号：2026-09-24_memhub-opencode-v1v2-adapter
> 审查类型：场景 B（代码审查）+ 场景 A（竞态/状态机设计审查）
> 审查对象：`src/host/opencode-client.js`（全文）、`src/daemon.js`（fork 流程）、`tests/test-host-client-v2.js`、`tests/test-host-client.js`
> 审查方式：静态逐行 + 受控 mock 复现（真实 HTTP mock server，非纸面推理）
> 审查基线：`fix-delivery.md`、`tech-design.md` §4.2/4.2.1/4.3、`verification.md` F1–F20

## 审查结论

**结论：不通过（REJECTED）**

## 审查摘要

本次修复整体方向正确：5 条 P0 的落点均真实存在，`readAllMessages` 版本分流、`getLastAssistantProgress` 三态化、`daemon.js` 失败态置 FAILED、探测安全顺序均已在代码中落地，且 `tests/test-host-client-v2.js` 17 项在本机实测 EXIT=0 通过（`e2e.js` 也确认为 16 套件）。

但存在 **2 个 P0 阻塞项**：其一，`snapshotForkBaseline` 的 1.5s 固定等待窗口与真机 F16-b 自证「复制约 6s 才稳定」**直接矛盾**，竞态窗口内插入的继承 idle 会被当作新增完成信号，**F16 的秒短路只是被推迟、未被消灭**（`verification.md` F16 同句已将「6s 稳定」与「ID 快照」并列记录，却选用 1.5s）；其二，`readAllMessages` 的 400 降级只降一次且用同一 cursor 重试同页，**若服务端上限低于 50，全部消息读取直接抛错 → `waitForSessionIdle` 吞错 → 必然超时 → 数据丢失**，与 F17 描述的失效模式完全一致，且无任何测试覆盖该路径。

另有 4 个 P1（竞态窗口同源问题、V2 全对象 `lastIdle` 实现与设计「末条」语义偏斜、V1 `getSessionStatus` 抛错导致 V1 秒短路回归风险、文案/计数未对齐），以及 P2/P3 若干。

---

## 发现详情

| 严重 | 发现 | 类型 | 位置 | 证据 | 建议 |
|------|------|------|------|------|------|
| P0 | `settleMs=1500` 是竞态根因：真机自证复制约 6s 才稳定，1.5s 快照会漏掉随后插入的继承历史（含 idle）→ 秒短路未被消灭，只被推迟 | 正确性/竞态 | `opencode-client.js:735-737`、`daemon.js:447` | 见 §1 | 改为「消息集稳定后才快照」或 `settleMs>=6000`；并加继承 idle 二次确认 |
| P0 | 400 降级只降一次且重试同一 cursor；若服务端上限 < 50，`degraded` 已 true 走 `!res.ok` 抛错 → V2 全部消息读取失败 → `waitForSessionIdle` 吞错 → 必然 timeout → 数据丢失 | 正确性/异常路径 | `opencode-client.js:443-449`、`958-971` | 受控 mock 实测：上限 1 → `THREW: 读取会话消息失败 HTTP 400`；F17 原文即描述此失效 | 循环降级至成功或达下限（如 5）；或降级后失败即抛明确错误并让上层区分；补 400 路径测试 |
| P1 | 降级后 `pageLimit` 是循环外变量，被后续所有页复用 → 若服务端 cursor 跨度与 limit 相关且降级前后不一致，可能漏读/重复 | 正确性/边界 | `opencode-client.js:431/444-448/459-462` | 未验证（服务端 cursor 语义未知）；mock 下两种模型均未复现，但代码未做防御 | 降级后重置 cursor 重新从头翻，或对已收集 ID 去重 |
| P1 | `waitForSessionIdle` V2 分支吞掉 `getSessionStatus` 任何异常（含 401/500）；`daemon.js` 亦不探测，用户凭据错误将表现为「静默 timeout」而非明确错误 | 可维护性/异常 | `opencode-client.js:935-939`、`969-971` | 受控 mock 实测：active 500 → `getSessionStatus` 抛错被吞 → `timeout`；消息 500 → 同样吞 → `timeout` | 401 应显式区分并上报；至少 `daemon.js` 在版本探测阶段对 401 报警 |
| P1 | `lastIdle` 取「任意 baseline 外 idle 的最后一条」而非设计 §4.2「末条 idle 消息」；若继承 idle 与新增 idle 并存，一旦有 fail 态历史 idle 出现在新增 idle 之后（按序）会误判 failed | 设计对齐 | `opencode-client.js:858-864/866-877` vs `tech-design.md:812` | 代码事实：`lastIdle` 为 `scoped` 全量遍历结果，非「按时间末条」语义 | 明确取「时间序最后一条 idle」或改为「只要有 baseline 外 succeeded 即成功」并文档化 |
| P1 | V1 `getSessionStatus` 在 `/session/status` 非 200 时抛错（`:769`），`waitForSessionIdle` V1 分支仅吞错转 unknown，**丢失 V1 idle 短路** → 消息层若无 `time.completed` 则永远 timeout（V1 回归语义变化） | 回归风险 | `opencode-client.js:757-788`、`941-943` | 静态确认：V1 无 `idle` 消息类型（`parse` 仅认 v1 `info.role`），仅靠 `info.time.completed` 兜底 | V1 路径保持与改动前一致的状态读取健壮性；或补 V1 状态端点异常用例确认可接受 |
| P1 | 文案/计数未与实现对齐：`tech-design.md:178/196` 仍写「16 项」，实现与 `fix-delivery.md` 为 17 项；F16-c 结论段仍主张用 `boundary.messageID` 作锚点，与同段 F16-b 的「不可行」自相矛盾 | 一致性/文档 | `tech-design.md:178,196`；`verification.md:230-241` | 实测 `test-host-client-v2.js` 17 项；`verification.md:216-224` 与 `:239-241` 互斥 | 修正计数；删除/改写 F16-c 末段矛盾措辞 |
| P2 | `detectApiVersion` 裸探 200 即短路，逻辑正确；但 `looksLikeOpenCode` 中的 `naked.status === HTTP_OK` 分支在 200 时永不可达（前面已 return），属死条件 | 可维护性 | `opencode-client.js:96-104` | 静态确认：`naked.status===200` 已在 `:96` 处理并 return | 清理死条件，仅保留 401 判定 |
| P2 | `getLastAssistantProgress` 中变量 `t`（`:776`）遮蔽外层 AbortController 的 `t`，虽 `finally` 在 `:785` 已 clearTimeout 故无实际泄漏，但可读性差 | 可维护性 | `opencode-client.js:776`、`785` | 静态确认 | 重命名局部变量 |
| P3 | `verification.md` 第 240 行「只认可出 boundary 之后的消息」与实现（ID 差集）不一致，属残留旧表述 | 文档 | `verification.md:239-241` | 与 `:216-228` 对照 | 清理 |
| P3 | `daemon.js` `tick` 每轮会先调 `maybeRunDream`，再做会话抽取；若 dream 阻塞会顺延抽取，属既有行为非本次改动 | 信息 | `daemon.js:356` | 静态确认 | 无需处理（本次非目标） |

---

## 逐条审查（对应必审 10 项）

### 1. `snapshotForkBaseline` 的竞态 —— [P0]

**现象**：`settleMs` 默认 1500（`opencode-client.js:735`），`daemon.js:447` 显式传 `settleMs: 1500`。而 `verification.md:226 (F16-b)` 明确记录「**副本复制约 6s 后稳定**」，`verification.md:254 (F18)` 更进一步记录「同源两次 fork，一次立即 100 条、**另一次 20s 内 0 条**」。

**触发条件**：fork 后 1.5s 快照时复制尚未完成 → 快照漏掉后续插入的继承消息。若后续插入的消息中**含继承 idle**（源会话每条历史都以 idle 收尾，真机 F4/F16 证实「每个会话末尾都有 idle」「副本 immediate 读到 idle 5 条」），则这些 idle 不在 baseline 内 → 被认定为「新增」→ `getLastAssistantProgress` 命中信号 1 → `completed=true` → `waitForSessionIdle` 返回 success → `daemon.js:486-491` 置 EXTRACTED → **抽取 100% 丢失，且状态是假的成功**。

**代码路径**：`getLastAssistantProgress:851-856` 的 `scoped = ordered.filter(e => e.id && !set.has(e.id))` 对差集**不做时间过滤**（此点本身正确，若加 `created>快照时间` 反而能缓解）。故唯一防线就是「快照时刻足够晚」。1.5s < 6s，防线不成立。

**关键自证**：`verification.md` 同一句（`:226`）同时写下「复制约 6s 后稳定」与「用 ID 快照」两个事实，`tech-design.md:125` 的实现说明亦只写「默认 1.5s」未给依据。**文档已给出反证，实现却取了更短的 1.5s。**

**影响**：P0，与 F16 修复目标（消灭秒短路）直接冲突。方向没变，只是把「1 秒秒短路」推后到「1.5~6s 之间的窗口」，在慢复制（F18 的 20s 案例）下窗口更大。

**建议**：
1. 最小修复：`settleMs` 提到 ≥ 6000，或改为**轮询到消息集稳定**（连续 2 次采样首/末 ID 与总数不变才结束）。`scripts/verify-baseline-snapshot.js:29-37` 已写过稳定判定逻辑，可直接复用进生产代码。
2. 加固：`waitForSessionIdle` 对「首次轮询即判完成」保持怀疑——既然已有二次确认（`:958-967`），建议二次确认的间隔拉长或要求「连续 N 次观测到同一条新增 idle 且总数不再增长」才判成功。

### 2. `getLastAssistantProgress` 的 baseline 语义（ID 稳定性）—— ✅ 无问题（就本方案而言）

**结论**：差集法在「ID 于快照前后**稳定**」的前提下成立。真机 F16-b 只证明**同一条逻辑消息在 fork 副本中的 ID 相对源会话被重写**（`_1416` 后缀），**未证明同一条副本消息在多次读取之间会漂移**。差集比较的正是「副本自身的 ID」，只要副本内 ID 在快照后不再变，方案即成立。

**证据**：`scripts/verify-baseline-snapshot.js:32` 的稳定判定正是用 `cur[0] === prev[0] && cur[last] === prev[last]` 比较 ID——该脚本能写出此判据，说明作者当时就以「ID 在副本内稳定」为假设；`verification.md:230-238 (F16-c)` 亦记录「快照后新增消息清晰可辨」。

**未验证**：无真机日志逐字证明「同一副本消息 ID 跨两次读取恒等」。若该假设不成立（每次读取重建 ID），则差集法**完全失效**（所有消息都成了「新增」）。建议把这一假设显式写进 `tech-design.md` 并保留一条真机断言。

**注意**：本条「无问题」指方案自洽，**不豁免第 1 条的竞态问题**——竞态是「快照时刻太早」，不是「ID 漂移」。

### 3. `waitForSessionIdle` 的失败态语义 —— ✅ 无问题（路径可达）

**结论**：`prog.outcome` **只可能来自 idle 消息**。`getLastAssistantProgress` 中 `parse` 仅在 `entry.type === 'idle'` 时返回 `outcome`（`:831`）；`lastIdle` 非空时返回 `outcome`（`:874`）；信号 2 回退（`:880-888`）与未完成态（`:890-896`）均硬编码 `outcome: null`。故 `waitForSessionIdle:951` 的 `prog.outcome === 'failed' || 'interrupted'` **只在存在 idle 消息时可达**，failed 判定路径真实可达。

**真机印证**：`verification.md:264-268 (F20)` 观测到 1 个 `outcome=failed` 会话被正确判为 `status='failed'`。

**残留（P3）**：`interrupted` 取值真机未观测（`fix-delivery.md:56` 已如实标注），按规范处理，风险可接受。

### 4. `readAllMessages` 的 400 降级 —— [P0]（降级不足）+ [P1]（pageLimit 复用）

**(a) 同页重试与二次 400**
`continue` 后回到 `do` 顶部，`cursor` 未变 → **确实重试同一 cursor 页**（首次 cursor 为 null，即重试第一页），确认无误。
第二次仍 400 时（服务端上限 < 50），`degraded=true` → 跳过降级分支 → `:449 if (!res.ok) throw` → **抛错**。

**受控 mock 实测**（服务端对任意 limit 均返回 400）：
```
ALWAYS400 THREW: 读取会话消息失败 HTTP 400
reqs = ["/api/session/ses-x/message?limit=100","/api/session/ses-x/message?limit=50"]
```
即只降级一次后即失败。由于 `daemon.js` 从不传 `pageLimit`（`readAllMessages:431` 走 `MESSAGE_PAGE_LIMIT=100`），若某 OpenCode 版本上限为 10/20/50 中的任意值，**所有消息读取都抛错**。抛错后：
- `getLastAssistantProgress` 抛 → `waitForSessionIdle:969-971 catch{}` 吞掉 → 继续轮询 → 直至 `maxWaitMs=300000` 超时 → `status:'timeout'` → `daemon.js:492-497` 置 FAILED。
- F18 的「fork 后 20s 内 0 条」场景还会叠加：即使不抛错，判据也无数据可用。

**这正是 F17 描述的失效模式**（`verification.md:249-250`：「若某版本上限更低，则所有消息读取 400 → 判定永不完成 → 静默走超时 → 数据丢失」），**修复只覆盖了「上限在 50~200 之间」的窄区间**。

**测试缺口**：`test-host-client-v2.js` 无任何 400 用例（第 15 项 T4 只测正常翻页）；`test-host-client.js` 亦无。该 P0 路径**零覆盖**。

**影响**：P0（数据静默丢失 + 假 FAILED 状态反复重试）。

**建议**：把降级改为循环——`while (pageLimit > 5) { pageLimit = floor(pageLimit/2); 重试同页; }`，或降级失败时抛出**可区分**的错误（如 `ERR_PAGE_LIMIT`），由 `daemon.js` 显式告警而非静默 timeout。并补 400 降级用例（含「上限=1 也必须能读到数据」）。

**(b) 降级后 pageLimit 对已翻页部分的影响**
`pageLimit` 在循环外声明（`:431`），降级后**被后续所有页复用**。若服务端 cursor 的跨度与请求 limit 绑定（如 cursor 编码 `offset + limit`），降级前后 limit 变化可能导致窗口重叠或跳跃。

**受控 mock 实测两种模型**（offset 型、窗口型）均**未复现**丢消息/重复（300 条全取回、去重后仍 300）。故**无法判定为确定的缺陷**，标 P1 防御性建议：降级后重置 cursor 从头翻页，或在 `scoped` 阶段按 ID 去重。**此项为「未验证风险」，非已证缺陷。**

### 5. `readAllMessages` 的翻页方向 —— ✅ 无问题（裁剪场景成立），[P2] 中间断裂无成功路径

**结论**：
- 「只剩一页」：`arr` 即该页，`reverse()` 后为首旧尾新，「最后一条 = 最新」**正确**。分页裁剪不改变该页内 desc 序。
- 「cursor 中间断裂」：`:449` 直接 `throw`，**不存在静默返回不完整数组的路径**（`all` 不会被 return；只有 `break` 的两种情况——`!next || next===cursor`（正常到底/不推进）与页数/条数上限——会返回累积结果）。故「断裂后 reverse 出错」的担忧**不成立**。

**残留（P2）**：`MESSAGE_MAX_PAGES=100` 或 `MESSAGE_MAX_ITEMS=10000` 触发 `break` 时，返回的是**不完全**的 desc 前缀（最新 10000 条），调用方无从得知被截断。对 >10000 条的超大会话，`reverse()` 后「末条」仍是截断范围内最新，判定仍偏保守正确；但 `readSessionMessages` 会静默返回部分数据。建议返回 `{items, truncated}` 或记日志。

### 6. `getSessionStatus` V2 返回值改动 —— ✅ 无问题

**结论**：
- 集合内返回 `payload[sessionId]?.type`（`:775-777`），真机 F5 该字段为 `'running'`；非字符串时兜底 `'running'`。不在集合返回 `'unknown'`（`:779`）。
- `waitForSessionIdle` V2 分支**不使用 status 作完成信号**（`:941` 的短路被 `!isV2` 守卫），status 仅用于 `onWait` 展示与超时 `finalStatus`。**不会误判、不会死循环**（循环上界由 `maxWaitMs` 硬控）。
- `daemon.js` 不直接消费 `getSessionStatus`，仅从 `waited.status` 分流：`completed` → EXTRACTED；`'failed'` → FAILED；其余（含 `'timeout'`）→ FAILED。与 `waitForSessionIdle` 的返回契约一致。

### 7. V1 回归 —— [P1]（V1 状态端点异常路径语义变化）

- **`readAllMessages` V1 分支**（`:412-424`）：不传 limit/order，裸 GET，`res.ok` 才解析，`Array.isArray` 兜底空数组。`test-host-client.js` 第 14 项（`:323-351`）走 V1 status + 消息完成度，**语义一致**；`test-host-client-v2.js` 第 16 项 T2（`:308-346`）也验证了 V1 裸数组路径独立分支。✅
- **`waitForSessionIdle` V1 短路**（`:941-943`）：`if (!isV2 && status === 'idle')` 保留短路，`finalStatus:'idle'`，与 `test-host-client.js:302-303` 断言一致（V1 mock 返回 `{type:'idle'}`）。✅
- **风险**：`getSessionStatus:769` 在 `/session/status` 非 200 时抛错；V1 分支无 `unknown` 兜底以外的手段，异常被 `:937` 吞为 `unknown` → **V1 短路失效** → 退化为纯消息层判定。V1 消息层**不认 `idle` 消息**（`:831` 仅 V2 `type:'idle'`），只认 `info.time.completed`（`:840`）。若 V1 宿主某些会话末条 assistant 未写 `completed`，则**修复后 V1 会从「立即成功」变成「必然 timeout」**。改动前 `getSessionStatus` 是否同样抛错需与旧版对照——若旧版一致，则非本次引入（标 P1 观察项）；若旧版更宽松，则为回归。

### 8. `isSubagentSession` 黑名单化 —— ✅ 无问题（在本方案内）

- `SUBAGENT_AGENTS = {review, explore, general, image-reader, subagent}`（`:485`），未知 agent 放行（`:511`）。测试第 11 项覆盖 `plan` 不误杀、`review` 拦截。
- **fork 副本识别**：真机 F7/F14 证实列表元素带 `fork = {sessionID, boundary}`，`:505-507` 的 `session.fork?.sessionID` 权威判定**在 HTTP 列表路径可用**。即使副本 agent 是 `build`（不在黑名单），第 2 条已先行拦截。**不会漏放。**
- 标题正则 `\(fork #\d+\)$`（`:529`）作为 DB 路径兜底，真机 F9 证实 V2 fork 确实追加该后缀。
- 结论：三重防护（fork 字段 + agent 黑名单 + 标题正则）足够。

### 9. `detectApiVersion` 探测顺序改造 —— ✅ 无问题（无多余请求、无 HTML 误判）

**裸探 200 短路**：受控 mock 实测（server 无需鉴权、返回 JSON，且设置 `OPENCODE_SERVER_PASSWORD` 制造「本应带凭据」场景）：
```
detect = 2  hits = ["/api/info|auth=false"]
```
→ **仅打 1 次请求，未发起带凭据请求**，短路正确。✅

**裸探 200 但返回 HTML（SPA 兜底）**：受控 mock 实测：
```
SPA-detect = null
```
→ `JSON.parse` 失败 → 返回 `null` → 不判 V1；随后探 `/global/health` 同样 HTML → `null` → `resolveVersion` 兜底 V1。对真机 F2（V2 未匹配路径返回 SPA HTML）**不会误判为 V1**。✅

**P2 死条件**：`:103` 的 `naked && (naked.status === HTTP_OK || naked.status === HTTP_UNAUTHORIZED)` 中 `HTTP_OK` 分支永不可达（200 已在 `:96-102` 处理并 return）。逻辑无害，建议清理。

**残留**：V1 宿主是否响应 `/api/info` 未验证（`fix-delivery.md:55` 已标注）。若 V1 返回含 `version` 字段的 JSON，会被判 V2 → 后续全走 `/api/...` 端点 → 全部 404。判定要求 `info.version !== undefined || info.pid !== undefined || info.urls !== undefined`（`:119` 为 **OR** 而非设计 §4.1 的 **AND 四字段**），**判据比设计更宽松**，跨版本误判概率高于设计预期。标 **P2**（真机仅 V2，无法验证），建议按设计收紧为 AND。

### 10. `daemon.js` 的状态机 —— ✅ 无问题（无死循环；重复重试属既有设计）

- `waited.completed` → EXTRACTED（`:486-491`）；`status==='failed'` 与 `'timeout'` 均 → FAILED（`:492-497`）。
- `finally` 无条件删 fork（`:506-512`）：**无论成败都清理**，符合「防残留 + 防套娃」目标。
- **FAILED 会话下次 tick 会重试吗**：`getProcessedSessionIds()` 只排除 `EXTRACTED`/`SKIPPED`（`:255-262`），FAILED **不在排除集** → 下轮会重新进入候选 → 重新 fork → **会重试**。
- **是否死循环**：**不会**。候选过滤要求 `age >= idleMinutes`（默认 120 分钟，`:643`）且 `age <= windowDays`（7 天，`:641`）。抽取失败会写 `session_tracking` 并更新 `updated_at`（`:495`），但 `age` 用的是**宿主会话的 `time.updated`**（非 tracking 时间），宿主会话被重新 prompt 后其 `time.updated` 不必然变化。因此一个**永久失败**的会话理论上会每轮（`intervalMinutes=30`）重试一次，直到超出 7 天窗口自然退出。这是**有界重试 + 明确退出条件**，非死循环。
- **残留（P2）**：无重试次数上限与退避。`attempts` 列已自增（`:405`）但**未被消费**，永久失败的会话会在 7 天窗口内每 30 分钟重复 fork/删除，造成宿主编译/资源浪费与日志噪声（真机 F16 曾观测到 20s 才可见消息，重复 fork 会放大该延迟）。建议：`attempts >= N` 后置 SKIPPED 或引入指数退避。

---

## 汇总

- P0（阻塞）: **2** 个
  1. `snapshotForkBaseline` settleMs=1500 vs 真机「约 6s 稳定」→ F16 秒短路窗口未闭合
  2. `readAllMessages` 400 降级只降一次 → 服务端上限 < 50 时消息读取全失败 → 静默 timeout 丢数据（F17 失效模式未闭合）
- P1（重要）: 4 个（降级后 pageLimit 复用、异常静默吞错、`lastIdle` 语义与设计偏斜、V1 状态端点异常路径语义变化）
- P2（讨论）: 4 个
- P3（信息）: 2 个

## 补充：已通过验证的部分（无问题项证据）

| 检查项 | 实测/证据 | 结论 |
|---|---|---|
| `test-host-client-v2.js` 17 项 | `node tests/test-host-client-v2.js` → EXIT=0，17 项全绿 | ✅ |
| `e2e.js` 套件数 | 实测 `[SUITE 1/16]`，`suites` 数组 16 项（含 v2） | ✅ 与 `fix-delivery.md` 一致 |
| 空 fork 不秒短路（V2） | T1-a 通过；`verification.md:233-235` 真机 timeout/5448ms | ✅ |
| idle succeeded → 成功 | T1-b 通过；真机 F20 / F16-c 正向 8s | ✅ |
| idle failed → 失败（不当成功） | T3 通过；真机 F20 | ✅ |
| 多页翻页取全 + 全程不带 order | T4 通过（3 页断言）；真机 F19 读取 111 条 | ✅ |
| V1 裸数组路径未被破坏 | T2 通过 | ✅ |
| baselineIds 隔离继承 idle | T5 通过 | ✅ |
| 探测无凭据外发 / SPA HTML 不误判 | 受控 mock 实测：1 次裸探、SPA→null | ✅ |
| 401 探测顺序安全化 | `detectApiVersion` 裸探 401 后才带凭据 | ✅ |

## 裁决

**REJECTED**

阻塞项（必须修复后方可放行）：

1. **[P0-1] `snapshotForkBaseline` 竞态窗口**：`settleMs=1500` 与真机「复制约 6s 稳定」（`verification.md:226`）矛盾，且 F18 记录存在 20s 不可见案例。必须改为「消息集稳定判定」或 `settleMs>=6000`，否则 F16 的秒短路在慢复制场景下**仍然会发生**（表现为假成功 + 数据丢失 + 状态错标 EXTRACTED）。

2. **[P0-2] 400 降级不充分**：降级仅一次且无下限重试，服务端上限 < 50 时**全部消息读取失败**，被 `waitForSessionIdle` 静默吞错 → 必然 timeout → 数据丢失。这正是 F17 描述的失效场景，修复未闭合，且**无任何测试覆盖**（T4 只测正常翻页）。必须改为循环降级至下限，或降级失败时上抛可区分错误 + 补测试。

建议（非阻塞但强烈建议在本次一并处理）：P1-1（降级后 pageLimit 复用）与 P1-2（异常静默吞错、401 无告警）属于同一「异常路径」主题，与 P0-4 的修复目标（异常路径不得误判）同源，建议合并处理。
