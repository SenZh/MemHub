# Phase 1 测试与验证充分性审查报告：OpenCode v1/v2 双版本适配 (Review - Test Sufficiency)

> **审查角色**：测试与验证充分性评审员（Testing & Verification Sufficiency Reviewer）
> **审查对象**：`tech-design.md`（v2 方案）、`verification.md`（真机证据 F-1~F-8）、`design-review.md`（v1 裁决）、`tests/test-host-client.js`、`tests/test-host-client-v2.js`、`tests/e2e.js`、`scripts/verify-opencode-v2.js`、`scripts/verify-opencode-v2-deep.js`、`scripts/verify-fork.js`、`src/host/opencode-client.js`（实现现状核对）
> **审查时间**：2026-09-24
> **审查轮次**：第二轮（v1 已 REJECTED；本轮重点：测试计划是否能证明修复有效、是否再度陷入「mock 自证」）
> **结论**：**REJECTED**

---

## 0. 前置事实澄清（结论的锚点）

已读完全部评审对象与真机证据，并核对了实际实现现状。**关键事实**：v2 文档是「待评审设计」，但**其声称的修复大部分尚未落地**——实测源码 `src/host/opencode-client.js`：`readAllMessages` / `order` / `cursor` / `outcome` 判定**零匹配**（grep 无结果），`getSessionStatus` 仍把「不在 active」返回 `'idle'`（:582），`waitForSessionIdle` 仍在 `status==='idle'` 秒短路（:670），`isSubagentSession` 仍用 agent 白名单而非黑名单（:395）。

因此本审查实质是评「**测试计划能否证明一套尚未存在的修复**」。

---

## 逐条审查

### 1. 测试计划是否具体到可执行 —— [P0] 仅一行目录级清单，无任何 mock 设计

**证据**：tech-design.md:140 全文为「补『秒短路回归』『分页 order/cursor』『idle 完成信号』『异常路径』用例」；§7（:158）为「待补 R1/R2 回归用例」。除此之外，全文无一处给出 mock 响应结构、断言列表、用例编号或预期失败路径。同目录仅有 `tech-design.md / verification.md / design-review.md` 三个文件，**不存在任何测试计划文档**。

**为什么漏检**：这句话界定了「要测什么主题」，但未界定「输入什么、断言什么、修复前应红/修复后应绿」。按此描述无法判断实现者是否真的验证了修复，也无法据此写出一条可失败（falsifiable）的用例。

**建议**：为非契约新增测试计划文件，每个用例给出 `{用例名, mock 桩数据, 调用, 断言, 修复前预期, 修复后预期}` 五元组。

---

### 2. 秒短路回归测试的 mock 设计 —— [P0] 文档未设计；且「回归测试」定位本身有陷阱

**真机锚点（F-10/F-11）**：fork 副本**不在** `/api/session/active` 集合，`getSessionStatus(fork) => idle`，`waitForSessionIdle(fork) => completed:true @1015ms`。这是**已实测**的事实，不是假设——因此复现它**不会**构成 v1 那种循环论证（v1 的问题是「标题必带 (fork #N)」是**未验证假设**却写进 mock）。判据：**mock 数据必须溯源到 verification.md 的某条 F，而非设计者想象**。

**具体 mock 设计（复现真机，合法）**：

```
用例 R1-1「fork 空副本不得被判完成」
  mock:
    GET /api/session/active           → { data: { '<源会话id>': { type:'running' } } }   // 集合内不含 fork.id（复刻 F-10）
    GET /api/session/<forkId>/message → { data: [], cursor:{next:null} }                 // 空会话（复刻 F-11 未注入 prompt）
  调用: waitForSessionIdle(baseUrl, forkId, { pollIntervalMs:100, maxWaitMs:800 })
  断言(修复后): completed === false 且 waitedMs >= maxWaitMs
  基线(修复前): completed === true  且 waitedMs < 500          ← 必须先跑出红，证明用例有判别力
```

**致命陷阱（必须指出）**：修复后 `getSessionStatus` 把「不在 active」映射为 `'unknown'`，`waitForSessionIdle` 只用 idle 消息判定——即**修复的方向是让 active 集合对完成判定彻底失效**。因此「active 不含 fork」这一条对修复后代码**不再有判别力**：即使实现把 fork 完全忽略也仍会返回 false。**真正能拦住回归的用例必须再加一条正向对照**：

```
用例 R1-2「fork 收到 idle 消息后必须判完成」
  mock:
    GET /api/session/active           → { data: {} }                    // 始终不在 active（复刻 F-12：idle 与 active 无关）
    GET /api/session/<forkId>/message → { data: [ {type:'idle', outcome:'succeeded'}, {type:'assistant', ...} ] }
  断言: completed === true
```

**两条用例互为反例**，才能同时证伪「秒短路（假阳性）」与「永不完成（假阴性）」。仅测 R1-1 = 又一轮「只证一个方向」的浅测。

**关系结论**：R1-1/R1-2 是「**复现真机**」，合法；若未标注溯源 F-10/F-11 就自行编造 active 行为，则退化为循环论证。

---

### 3. 分页测试的可证伪性 —— [P0] 只返回一页的 mock 无法发现「没翻页」bug，重蹈 v1 覆辙

**直接回答**：**不能**。若 mock 只返回一页（`cursor.next:null`），则「翻页」与「不翻页」两条实现路径**产生完全相同的可观测结果**，用例恒绿——这正是 v1「用假设构造 mock、再用 mock 证明假设」的同型错误。对比真机 F-6：实测 **67 条 / 5 页**，只有**多页**才暴露 R2。

**具体 mock 设计（断言必须落在「请求了什么」而非「结果对不对」）**：

```
用例 R2-1「必须带 order=asc 且游标翻页取全」
  mock（三页）:
    第1页 无 cursor → { data:[m1(created=100), m2(created=200)], cursor:{next:'c1'} }
    第2页 cursor=c1 → { data:[m3(created=300), m4(created=400)], cursor:{next:'c2'} }
    第3页 cursor=c2 → { data:[m5(created=500)],                cursor:{next:null} }
    服务器按 query 参数分流并记录每次请求的 `req.url`
  调用: readAllMessages(baseUrl, sid)
  断言A(结果): 返回 length === 5，且顺序为 100,200,300,400,500（升序）
  断言B(行为): received 中出现 3 次 /message 请求，URL 依次含 order=asc、cursor=c1、cursor=c2
  断言C(缺省值陷阱): 任一请求不得出现「无 limit/order 的裸 GET」
```

**第 2 页数据必须造成反向差异**：令「最后一条 assistant」**只在第 2/3 页**、第 1 页全为 user/idle。这样旧实现（不翻页）会读不到它 → `getLastAssistantProgress` 返回 `hasReply:false` → 用例红。**只有这种「关键数据落在第二页之后」的构造，才对 R2 有判别力。**

**另一个隐藏缺陷（文档未提）**：tech-design.md:110 说用 `order=asc` 让「最后一条」语义正确，但**没有说明 asc 下 `cursor` 是否可能造成首尾重复/漏项**（真机仅测过 limit=20 翻页，未见 order=asc+cursor 组合的 F 条目）。此组合**未验证**。测试须增加「跨页无重复、无缺号」断言（用 created 时间戳连续性校验），否则可能引入新 bug。

---

### 4. idle 完成信号的测试 —— [P0] 文档未给出；须覆盖三态 + 失败态不得判成功

**真机锚点（F-4/F-12）**：单会话 `{assistant:60,user:4,idle:3}`，多会话抽样全含 idle，`outcome:'succeeded'`。**注意**：outcome 的 `failed`/`interrupted` 取值在真机**未被观测到**（只有 succeeded 样本）——取值域来自 OpenAPI 规范，属「规范推断」，须标注。

**具体 mock 设计**：

```
用例 R11-1「idle+succeeded ⇒ 完成」
  mock message: [ {type:'idle', outcome:'succeeded'}, {type:'assistant', time:{completed:...}, content:[{type:'text',text:'x'}]} ]
  断言: completed === true
用例 R11-2「idle+failed ⇒ 必须视为已结束，但不得误判为成功抽取」
  mock: [ {type:'idle', outcome:'failed'} ]
  断言: (a) 轮询必须终止（不得死等至超时）; (b) 返回结构须能区分「结束」与「成功」
        —— 若 waitForSessionIdle 仅返回 {completed:boolean}，则当前签名**无法表达 failed**，
           须断言 completed===false 且 finalStatus 携带 'failed'，并反向要求 daemon.js:468 不得删 fork 前误标 EXTRACTED
用例 R11-3「idle+interrupted」同上
用例 R11-4「有 assistant 无 idle + 只有 streamed」⇒ 完成判定取决于实现（见下）
```

**R11-4 直击 v2 内部矛盾（[P0]）**：tech-design.md:100「信号1（主）：idle 存在且 outcome 落定（require outcome ∈ {succeeded,failed,interrupted}）」，但 :102「信号2（辅）：最后一条 assistant 的 `time.completed` 存在」——**完全没有说明两个信号的布尔关系**（信号1 存在但 outcome 不符时，信号2 是否还能独立判成功？AND 还是 OR？）。而源码 `:625` 现为 `time?.completed || time?.streamed`（OR）。若「辅助信号」被实现成 OR，R3（streamed 误判）**会原样复活**，而 tech-design.md:150 声称「已移除 streamed 判定，风险消解」将不成立。**这是纯静态可证的 v2 内部不一致**，必须先用 mock 把语义钉死：

```
用例 R3-1「仅有 streamed 无 completed ⇒ 不得判完成」（即 v1 遗留用例，现文档未列）
  断言: completed === false
用例 R3-2「idle 存在但 outcome 缺失 ⇒ 不得仅凭 assistant.completed 判成功」（若设计为 AND）
```

**结论**：idle 测试的核心风险不是「idle 写没写」，而是「idle 与 assistant.completed 的**组合逻辑**未定义」。不测 R3-1/R3-2 则 R3 无法证明被修复。

---

### 5. 真机与 mock 的边界 —— [P0] 文档无分工声明；且 fork 权威字段的新假设「真机未验 + mock 不可证」

**5a. 边界缺失**：tech-design.md 全文**无一句**说明「哪些必须真机、哪些可 mock」。design-review.md:56-63 第一轮明确列过 6 项「mock 不可替代」，v2 却把这条方法学要求**丢了**。verification.md 也没有「哪些结论不可 mock 替代」的对照表。

**5b. F 条目对 v2 假设的覆盖核查**（逐条比对）：

| v2 关键假设 | 真机 F 覆盖 | mock 可证 | 判定 |
|---|---|---|---|
| 版本探测判 V2 | F-1 ✅ | ✅ | 已覆盖 |
| V2 接受 Basic Auth | F-2 ✅ | ✅ | 已覆盖 |
| 不在 active 即秒短路 | F-10/F-11 ✅ | ✅(见2) | 已覆盖 |
| 默认 50/desc/cursor 翻页 | F-6 ✅ | ✅(见3) | 已覆盖 |
| idle 消息存在 | F-4/F-12 ✅ | ✅(见4) | 已覆盖 |
| **`Session.Info.fork` 字段作权威判定** | **✗ 未真机验证** | **✗ 不能** | **[P0] 缺口** |
| **`order=asc` + `cursor` 组合正确性** | **✗ 未验证** | 部分可证 | **[P0] 缺口** |
| **idle.outcome ∈ {failed, interrupted} 真实取值** | **✗ 未观测到** | 只能测容错，不能证取值 | **[P1] 缺口** |
| agent 黑名单（不误杀 plan） | **✗ 未验证宿主是否有 plan 会话** | ✗ 不能 | **[P1] 缺口** |
| V1 宿主 `/api/info` 行为 | ✗ 未验证（F-8 自认） | ✗ 不能 | 已知遗留，接受 |

**5c. 最危险项 —— fork 权威字段**：tech-design.md:115 明确要求 `if (session.fork?.sessionID) return true;`，但 verification.md **没有任何一条 F 验证过「fork 会话的列表返回体真的带 `fork.sessionID`」**。F-7 只观测了 fork 接口**返回体**带 fork，**没有验证 `GET /api/session` 列表里的元素也带 fork**。这两者不等价。而 `listCandidateSessions` 读的是**列表元素**（源码 :452 走 `ep.listSessions`）。**这是一个新引入的、结构级（非行为级）的假设，mock 只能复述假设本身（循环论证），真机又没验** → **无论如何现有测试都无法证明它成立**。若字段实际不存在于列表元素，`isSubagentSession` 的权威兜底**恒不触发**，且因它只是「加一条 or」不会报错——**静默失效**，测试恒绿。

**必须补真机**：`GET /api/session` 后逐条打印 `'fork' in s`，并确保列表里确有一份 fork 副本。

---

### 6. 测试入链（R4）—— [P0] 实测确认未入链；承诺仅一句话，非「已定义具体位置」

**证据**：`tests/e2e.js:20-36` 的 `suites` 数组实测 **15 项**，逐条核对**无 `test-host-client-v2.js`**（:29 只有 `test-host-client.js`）。故 `npm test` 对 v2 **0 覆盖**成立。

**额外发现（文档计数错误，[P1]）**：tech-design.md:157「V1 回归 14 项」正确（test-host-client.js 内部 14 条 console 编号一致），但 e2e `suites.length = 15`，二者数字不同；v2 文档 §7 把「V1 回归 14」与「套件 15」混述，**第一轮 R5「文档证据与实况对齐」未真正修复**——只是换了表述。`tests/` 实有 16 个 `test-*.js`（列名已核）。

**承诺是否足够**：**不够**。:141「**纳入** `e2e.js` suites（R4）」是「应做」陈述，未定义插入位置、套件名、顺序。可执行要求：

- 在 `suites` 数组显式追加 `{ name:'宿主驱动客户端 V2 双版本适配', cmd:'node tests/test-host-client-v2.js' }`；
- v2 套件须自身可独立 `node` 运行且退出码正确（现有 v2 测试用 `try/finally` 但无 `process.exit(1)`，断言失败靠 assert 抛错使 Node 退出码非 0——**这一点已核实成立**，见 :1 `import assert`，故退出码语义无隐患）；
- e2e 失败即 `process.exit(1)`（:48 已具备）。

---

### 7. 异常路径覆盖（R12）—— [P0] 只有设计意图，零具体断言

**证据**：tech-design.md:129-131 全文为「各 HTTP 调用对 401/404/500/非 JSON/超时给出明确错误与降级」+「显式实现 sawReply 语义」。**没有一条**说明「401 时返回什么、断言什么」。对照实测现状：

- `getSessionStatus` 非 ok → `throw new Error(...HTTP ${res.status})`（:576）→ 会被 `waitForSessionIdle:666-668` 吞掉转 `'unknown'` → 最终**静默走到超时**。401 在真机是**首要风险**（F-2 证明无凭据即 401），却无任何测试。
- `readSessionMessages`/`getLastAssistantProgress` 非 ok → 抛错（:365/:617）；401 会传染给调用方，但**无测试断言上层如何降级**。
- **sawReply 死字段未修**：实测 `:656/:685/:696` 仍只「设置并透传」，全仓库 `grep` 显示 `src/` 内**无任何消费者读 `waited.sawReply`**（仅 3 处，全在函数自身）。R9 **未闭环**，且 v2 未给测试用例。

**建议断言清单（逐码）**：

```
401 → getSessionStatus 返回 'unknown'（不抛）、waitForSessionIdle 到达超时返回 completed:false（不得崩溃/不得误判完成）
404 → readSessionMessages 明确抛 'HTTP 404'；listCandidateSessions 抛错且上层 daemon 不误标 EXTRACTED
500 → 同 404，且验证「重试 or 明确失败」二选一，禁止静默吞
非 JSON（HTML）→ detectApiVersion 不得判 V1/V2（返回 null → 上层 V1 兜底）；须构造 /api/info 返回 200+HTML 的 mock（复刻 F-2）
超时 → 每函数 AbortController 生效，断言耗时接近 timeoutMs±容差，而非无限挂起
```

---

### 8. 回归保护 —— [P0] 现有 14+12 项**拦不住** v2 的三处核心改动，且有一条测试会**直接报错**

**8a. 现有 v2 测试断言的是「旧行为」，与新设计冲突**：

- `test-host-client-v2.js:152` 断言 `getSessionStatus(baseUrl,'ses-idle') === 'idle'`，注释「不在 active 集合即为 idle」。v2 设计（:107）要求改为 `'unknown'`。**修复后此用例必然变红**，但**没人会改它**（v2 未列出对它的改动）→ 要么 CI 长期红，要么有人为「让 CI 绿」把语义改回旧行为，**回归被反向固化**。
- `:198-199` 断言 `waited.completed === true, finalStatus === 'idle'`（依赖秒短路路径），同样与新设计冲突。
- **结论**：v2 对既有测试的**兼容改动**未做任何说明（哪些用例要改写、哪些要删除）。这是「设计→测试」对齐的缺口。

**8b. 三处核心改动的拦截面**：

| 改动 | 现有测试能否拦住回归 | 漏检点 |
|---|---|---|
| `getSessionStatus` 语义（idle→unknown） | ✗ | 无「不在集合 ⇒ unknown」的正向断言；反被 :152 固化为 idle |
| 消息读取加 `order`+翻页 | ✗ | 现有 mock `cursor:{next:null}`（:65）**恒单页**，翻页代码写错也全绿 |
| 完成判定改 idle+outcome | ✗ | 现有 mock **从不含 `type:'idle'`**（:122-129 只有 user/assistant），新判定路径**一次都没被执行** |

**8c. 会漏掉什么（最高危）**：**完成判定改动的回归完全无覆盖**——新逻辑的主路径（idle）在全部 26 项测试中**零次触发**。若实现把 `outcome` 字段名写错（如读 `status`）、或把 idle 过滤条件写反，**全部现有测试仍绿**，而真机将表现为「永不完成 → 300s 超时 → daemon 仍删 fork（设计需明确超时时是否标 EXTRACTED）」。

**8d. 附带事实**：v1 的 `test-host-client.js` §12（:296-302）测的是 v1 状态机 `{type:'busy'|'idle'}`，与 v2 active 语义不同，**不能作为 v2 回归防线**；但它验证了 v1 `unknown` 语义（:297）——可作为 v2 `unknown` 对齐的**参照**，不能替代。

---

## 裁决

**REJECTED**

严重度汇总：**P0 × 8**（第 1、2、3、4、5、6、7、8 条各含 P0）／**P1 × 3**（e2e 计数与实况对齐；idle.outcome 取值域未验；agent 黑名单未验）／P2 若干。

**放行前必须补齐的测试（按优先级）**：

1. **新增测试计划文件**（测试缺口：无五元组）——每用例必须写明 `mock 桩数据 / 断言 / 修复前预期红 / 修复后预期绿`，且每条 mock 桩标注溯源 `F-编号`；无溯源标「假设」并降级为不可信。
2. **完成判定语义先钉死**（测试缺口：信号1/信号2 布尔关系未定义）——用例 R3-1「仅 streamed ⇒ 不完成」、R3-2「idle 无 outcome ⇒ 不得仅凭 assistant.completed 判成功」；并消除 tech-design.md:100 与 :102 的内部矛盾。
3. **秒短路回归成对用例**（R1-1 反例 + R1-2 正例）——单条无判别力。
4. **分页多页用例**（关键数据落在第 2/3 页 + 断言 `order=asc` + `cursor` 逐次出现 + 无重复漏项）。
5. **idle 三态用例**（succeeded / failed / interrupted）——若 `waitForSessionIdle` 签名无法表达 failed，**须先改签名与 `daemon.js:468` 的上层判定**，再补断言。
6. **异常路径逐码断言**（401/404/500/非 JSON/超时），其中「非 JSON」用 `200+HTML` mock 复刻 F-2。
7. **真机补验 `fork.sessionID` 是否出现在 `GET /api/session` 列表元素**（不可 mock，见第 5c）——未验前 `isSubagentSession` 的权威兜底应标「未生效」。
8. **纳入 e2e 并改写冲突用例**：`suites` 追加 v2 套件；同时改写 `test-host-client-v2.js:152`、`:198-199` 以对齐新语义；修正 tech-design.md:157 的套件计数（15 而非 14）。

**未验证项（如实标注）**：`Session.Info.fork` 字段在列表返回体中的存在性、`order=asc` 与 `cursor` 组合的正确性、`idle.outcome` 的 `failed/interrupted` 真实取值、V1 宿主 `/api/info` 行为——以上**既未真机证实，也无法由 mock 证明**，不得在验收声明中计入「已验证」。
