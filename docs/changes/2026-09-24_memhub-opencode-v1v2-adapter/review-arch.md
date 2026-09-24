# 架构正确性审查报告：OpenCode v1/v2 双版本适配方案 v2（Review - Architecture Correctness）

> **审查角色**：架构正确性评审员（Architecture Correctness Reviewer）
> **审查对象**：`tech-design.md`（OpenCode v1/v2 双版本 API 自动适配 技术方案设计 修订版 v2）
> **审查依据**：`verification.md`（真机实测证据 F-1~F-12）、`design-review.md`（v1 评审裁决 R1~R13）、`src/host/opencode-client.js`（现有实现）、`src/daemon.js`、`src/dream/pipeline.js`、权威事实源 `https://opencode.ai/v2/openapi.json`（实核对）
> **审查轮次**：第二轮（v1 方案已 REJECTED，本方案基于真机 2.0.15 实测重写）
> **审查时间**：2026-09-24

---

## 审查结论

**结论**: **REJECTED（不通过）**

## 审查摘要

本次为 v2 方案的第二轮独立架构审查。v2 确实基于真机事实修正了 v1 的多数缺陷（R1 短路机制确证、R2 分页确证、R10 消除），方向正确。但审查发现 **3 个 P0 级设计缺陷**：(1) §4.2 核心设计「信号1=idle 消息」**在代码路径中无落地点**，与 `waitForSessionIdle` 现有结构脱节，且把 V2 信号1 判据改成 `unknown` 后信号1 对 V2 **永久失效**，完成判定实际退化为「仅靠 assistant.completed + 超时」，方案自洽性不成立；(2) `failed`/`interrupted` 两种 outcome 的**语义处置完全缺失**，存在把失败判为成功的风险；(3) §4.3 分页设计**违背 OpenAPI 明示契约**（`cursor` 与 `order` 互斥），且 `order=asc` 与 cursor 组合的正确性未经验证。

---

## 发现详情

| 严重 | 发现 | 类型 | 位置 | 证据 | 建议 |
|---|---|---|---|---|---|
| **P0-A** | **§4.2「信号1=idle 消息」无落地位置，方案与代码结构脱节** | 设计完整性/自洽性 | `tech-design.md:99-104` vs `opencode-client.js:674-688` | §4.2 声明信号1为「读取会话消息，最后一条 `type:idle` 消息存在且 outcome 落定」；但代码中 `waitForSessionIdle` 信号1 实为 `getSessionStatus`（:665）+ `if(status===idle)`（:670），信号2 实为 `getLastAssistantProgress`（:676），后者只识别 `entry.type===assistant`（:623），**完全不解析 idle 消息**。设计未说明 idle 判定接入哪个函数、替换哪段逻辑。 | 明确写清：`getLastAssistantProgress`（或新增函数）如何返回 `{idleOutcome}`；`waitForSessionIdle` 信号1 如何改为「读取末条 idle 消息判定」。否则实现者无法据此编码。 |
| **P0-B** | **`failed`/`interrupted` outcome 处置缺失，存在误判成功** | 功能正确性 | `tech-design.md:100-101` | OpenAPI 已证 `Session.Message.Idle.outcome` **required**，enum = `{succeeded, failed, interrupted}`。§4.2 仅写「require outcome ∈ {succeeded, failed, interrupted}」——把三者**等价**用于「完成」，未区分。若宿主 LLM 任务失败产出 `outcome:failed`，方案会判为「抽取成功」，`daemon.js:468-469` 将打印「✅ 复盘完成」并置 `EXTRACTED`（:475-479）。 | 明确：`succeeded`→completed=true；`failed`/`interrupted`→completed=false（或独立状态），上层据此置 FAILED 而非 EXTRACTED。 |
| **P0-C** | **§4.3 分页设计违背 OpenAPI 明示契约：`cursor` 不可与 `order` 组合** | API 契约/设计正确性 | `tech-design.md:110` vs OpenAPI `/api/session/{sessionID}/message` | OpenAPI `cursor` 参数描述原文：「Opaque pagination cursor… **Do not combine with order.**」而 §4.3 设计为「显式 `order=asc` + 循环 `cursor.next` 翻页」。两者直接冲突；若服务端拒绝组合或返回 400（spec 列出 400 `InvalidCursorError`），则翻页拉全**整体失效**。 | 二选一：(a) 仅用 cursor 翻页（首页不传 order，后续传 cursor），从 `cursor.previous`/`next` 定位；或 (b) 真机验证 `order=asc`+cursor 是否被接受并记录证据。当前方案无此验证，属未验证。 |
| **P1-D** | **R1 修复有副作用：V2 下信号1 永久失效，完成判定实际退化为单信号** | 架构正确性 | `tech-design.md:107` + `opencode-client.js:670` | 把 V2 `getSessionStatus` 不在 active 判为 `unknown`（:107）后，`if(status===idle)`（:670，未改动）在 V2 下**永不成立**（V2 完成态也不在 active → `unknown`）。故信号1 对 V2 完全失效，完成判定 100% 依赖信号2（assistant.completed）+ 超时。§4.2 称「信号1 为主」与实际不符。 | 要么让信号1 接入 idle 消息（见 P0-A）；要么在设计中明确「V2 下信号1 降级，不再依赖」，并让文档与代码语义一致。 |
| **P1-E** | **`listCandidateSessions` 分页「同理处理」不够具体，且其实修法不同** | 设计完整性 | `tech-design.md:112` | §4.3 对会话列表分页仅写「同理处理 cursor，或显式传足够大的 limit + 翻页」。但 `GET /api/session` spec 描述「Defaults to the newest 50 sessions」，其 `cursor` 描述**未**含「Do not combine with order」限制——与消息端点契约**不同**，「同理」会误导。且 `listCandidateSessions`（:452）当前裸 GET，漏筛风险真实存在（R2 另一半）。 | 对两个端点分别写明参数契约与修法；给出具体页数/条数上限数值（§4.3 仅说「设上限」未给值）。 |
| **P1-F** | **R9（sawReply 死字段）仅一句带过，未定义修法** | 设计完整性 | `tech-design.md:131` | §4.7 原文仅「`waitForSessionIdle` 兜底路径显式实现 `sawReply` 语义（消除死字段，R9）」。未定义「sawReply=true 时兜底应返回 completed 还是仍 false」，实现者无从落笔。 | 明确语义：超时时 `sawReply=true` → `completed` 取值、`finalStatus` 取值、上层 `daemon.js:468` 判定分支如何变化。 |
| **P2-G** | **§4.4 黑名单 `agent` 判定未给出具体名单** | 设计合理性 | `tech-design.md:117` | 「agent 白名单改黑名单式（仅拦截已知子代理）」未列出「已知子代理」具体枚举。OpenAPI 无 agent 枚举约束（`Session.Info.agent` 仅 `type:string`）。黑名单要求穷举，遗漏即漏抽/误抽。 | 给出黑名单枚举（如 review/explore/general/image-reader）并说明来源；补充「未知 agent 默认放行」的显式决策。 |
| **P2-H** | **§4.4 `session.fork?.sessionID` 判定路径正确，但未覆盖 DB 路径** | 设计完整性 | `opencode-client.js:97`（adapter） | `isSubagentSession` 被 `adapters/opencode.js:97` 复用，输入来自 SQLite `SELECT id,title,directory,...`（:73），**不含 `fork` 字段**。§4.4 新增 `session.fork?.sessionID` 判定对 HTTP 路径有效，对 DB 路径天然无效（无该字段）。设计未提及该差异。 | 说明 DB 路径仍靠标题正则兜底，或从 DB 补查 fork 信息；至少在设计中标注两路径差异。 |
| **P2-I** | **§4.1 探测收紧判据对齐 OpenAPI，方向正确；`additionalProperties:false` 使四字段必全有** | 设计正确性 ✅ | `tech-design.md:91` vs OpenAPI `ServerInfo` | OpenAPI `ServerInfo` 的 `required: [version, pid, urls, paths]` 且 `additionalProperties:false`，`paths.required:[tmp]`。故真机返回的 ServerInfo **必然四整**。收紧为 `version && pid!==undefined && urls!==undefined && paths?.tmp!==undefined` **不会误伤合法 V2 server**（合法 server 必过 spec 校验）。跨版本误判 V1（无 `/api/info`）风险也随之降低。 | 无需修改。 |

---

## 逐维度审查

### 审查点 1：§4.2 完成判定 + outcome（P0-A / P0-B）
- **真机证据充分性**：F-4/F-12 证明 `type:idle` 消息**存在且必现**——这一「存在性」证据**充分**。
- **但「充分性」止步于存在性**：OpenAPI 证实 `Session.Message.Idle.outcome` 为 **required**（本次已核对 spec：`required:[id,time,type,outcome]`）。v2 未处理 `failed`/`interrupted`（P0-B）。
- **判定逻辑脱节**：§4.2 的信号1 在 `waitForSessionIdle` 中**无对应代码位置**（P0-A）。
- **结论**：证据支撑「用 idle 消息」的方向，但**不支撑当前设计的可落地性与失败分支正确性**。

### 审查点 2：§4.2 `getSessionStatus` V2 改 `unknown`（P1-D）
- 短路是否修复：`waitForSessionIdle:670` 的 `if(status===idle)` **未改动**；改 `unknown` 后该分支在 V2 下不触发 → **秒短路逻辑上被消除** ✅。真机 F-11 场景（不在 active→idle→1015ms 短路）不再复现。
- **但改 `unknown` 不足够**：它同时**杀死了信号1 本身**，V2 完成判定退化为信号2 单点（P1-D）。**还需改 `waitForSessionIdle`**（把信号1 换为 idle 消息判定），否则 §4.2 的「信号1 为主」是空话。

### 审查点 3：§4.3 分页（P0-C / P1-E）
- **契约冲突（P0-C）**：OpenAPI 明示 `cursor`「Do not combine with order」，`order=asc`+cursor 设计与 spec 冲突，且**未经真机验证**（verification.md 未做 order+cursor 组合实测，F-6 仅分别测了裸 order 对比）。
- **`arr[arr.length-1]` 正确性**：若 `order=asc` 生效，末元素=最新，语义正确（真机 F-6 证实 asc=旧→新）。**但前提是分页组合有效**——受 P0-C 阻塞。
- **终止条件/上限**：§4.3 只写「设页数/条数上限」，**未给具体值**。
- **`listCandidateSessions`**：「同理处理」不足够（P1-E，且两端点契约不同）。

### 审查点 4：§4.1 探测收紧（P2-I）
- ✅ **无问题**。`additionalProperties:false` + `required` 四字段确保合法 ServerInfo 必含 `paths.tmp`；收紧不会误伤。这是 v2 相对 v1 的正确改进。

### 审查点 5：§4.4 fork 识别（P2-G / P2-H）
- **反向风险**：黑名单确有「漏列→放过真子代理」风险，且**未给名单**（P2-G）。
- **`session.fork?.sessionID` 覆盖**：OpenAPI 证实 `Session.Info.fork` 为可选对象（required 仅 `id,projectID,cost,tokens,time,location`，**不含 fork**），其存在即代表 fork 副本，**覆盖了「fork 副本无 parentID」场景** ✅（HTTP 路径）。**但 DB 路径无此字段**（P2-H）。
- 标题正则兜底真机有效（F-7/F-9）✅。

### 审查点 6：§4.7 R9 `sawReply`（P1-F）
- **仅是提了一句**，未定义修法。不满足「可落地设计」标准。

### 审查点 7：自洽性（信号2 单用 `time.completed`）
- OpenAPI 证实 `Session.Message.Assistant.time` required 仅 `created`；`streamed`、`completed` 均**可选**且无时序语义说明。
- 真机 F-12 显示完成态 `{created,streamed,completed}` 并存 → **`completed` 作为完成标记可靠**（已完成必有）✅。
- **移除 streamed OR 是正确的**（R3 收敛）。
- **但**「进行中是否仅有 streamed 无 completed」**仍未验证**（verification.md §4.1 明示未抓到中间态）→ v2 风险表已将其标注为「风险消解」，**过度乐观**：若存在「先写 streamed 后写 completed」窗口而代码只用 completed，理论上更安全（不会误判完成）；故此处**移除 streamed 是净收益**，标为 P3 信息性即可。**判定：无阻塞问题。**

### 审查点 8：遗漏检查（R1–R13 覆盖度）

| 项 | v2 处置 | 裁决 |
|---|---|---|
| R1 | §4.2 改 unknown + idle 判定 | ⚠️ 部分（P0-A/P1-D） |
| R2 | §4.3 分页 | ⚠️ 部分（P0-C/P1-E） |
| R3 | §4.2 移除 streamed | ✅ 覆盖 |
| R4 | §5 表列「纳入 e2e.js」（:141） | ✅ 有处置（当前代码 e2e.js suites **仍无** v2，属待实施） |
| R5 | v2 文档未再声称「14 套件 PASS」，改列证据来源（:156-158） | ⚠️ 部分：仍称「V2 适配 12 项 PASS」，未复核计数真实性 |
| R6 | §4.4 fork 字段 | ✅ 覆盖 |
| R7 | §4.1 收紧 | ✅ 覆盖 |
| R8（凭据外发） | **v2 全文未提及 R8** | ❌ **遗漏** |
| R9 | §4.7 一句 | ⚠️ 部分（P1-F） |
| R10 | §4.5 确认消除 | ✅ 覆盖 |
| R11 | §4.2 采用 idle | ✅ 覆盖 |
| R12（异常路径） | §4.7 泛泛「各调用给明确错误与降级」，未列具体端点×状态码矩阵 | ⚠️ 部分：不够具体，不可测 |
| R13（既有债） | **v2 全文未提及 R13** | ❌ 遗漏（可延后，但应显式声明「本次不处理」） |

**明确未覆盖**：R8、R13 在 v2 文档中**无任何对应处置**（连「本次不处理」的声明都没有）。R5/R12 处置不具体、不可验证。

---

## P0-C 完整论证（cursor 与 order 互斥）

### 1. 设计原文

`tech-design.md:110`（§4.3 分页拉全，修复 R2）：

```
- 新增 `readAllMessages(baseUrl, sessionId)`：显式 `order=asc`（旧→新，保证「最后一条」语义正确）
  + 循环 `cursor.next` 翻页直至取完或达上限（防死循环，设页数/条数上限）。
```

即：**首页传 `order=asc`，随后用 `cursor.next` 循环翻页**。

### 2. OpenAPI 权威原文（`/api/session/{sessionID}/message`，GET）

`order` 参数（`in: query`，`required: false`）：

```json
{
  "name": "order",
  "in": "query",
  "schema": {
    "anyOf": [
      { "type": "string", "enum": ["asc", "desc"] },
      { "type": "null" }
    ],
    "description": "Message order for the first page. Use desc for newest first or asc for oldest first."
  },
  "required": false
}
```

`cursor` 参数（`in: query`，`required: false`）：

```json
{
  "name": "cursor",
  "in": "query",
  "schema": {
    "anyOf": [
      {
        "type": "string",
        "description": "Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. Do not combine with order."
      },
      { "type": "null" }
    ]
  },
  "required": false
}
```

**关键原文**：`cursor` 描述末句 —— **「Do not combine with order.」**（不要与 order 组合使用）

该端点 `responses.400` 明确列出：`"description": "InvalidCursorError | InvalidRequestError"`。

### 3. 冲突论证

- 设计表述为「`order=asc` + 循环 `cursor.next`」——在同一请求序列中**同时**使用 `order` 与 `cursor`。
- OpenAPI 明文禁止二者组合。
- 后果分两种可能，**均未被真机验证**：
  - 若服务端**拒绝**组合 → 返回 400（`InvalidCursorError`/`InvalidRequestError`）→ `readAllMessages` 抛错或返回空 → **翻页拉全整体失效**，R2 未被修复，甚至比现状（裸 GET 至少拿到首页）更糟。
  - 若服务端**忽略** `order`（仅以 cursor 定位）→ 首页 `order=asc` 生效、后续页方向由 cursor 决定；此时 `arr[arr.length-1]` 的「最后一条」语义取决于 cursor 翻页方向，设计未证明其与 asc 一致，**语义正确性无保证**。
- 该组合在本轮 verification.md 中**无实测记录**：F-6 只分别对比了「裸 order=asc」「裸 order=desc」，**未测 order+cursor 组合**（verification.md:75-78）。

### 4. 受影响代码位置

- 拟新增函数 `readAllMessages(baseUrl, sessionId)`（设计意图，尚无实现）。
- 现有直连消息端点、将被改走该函数的两个调用点：
  - `readSessionMessages` — `opencode-client.js:352`（`fetch(`${baseUrl}${ep.messages}`` 于 :361，裸 GET，无 order/cursor）
  - `getLastAssistantProgress` — `opencode-client.js:603`（`fetch` 于 :613，裸 GET；`arr[arr.length-1]` 语义于 :620 倒序遍历）
- 端点常量 `messages: '/api/session/${sid}/message'` — `opencode-client.js:129`。

### 5. 结论

**P0（阻塞）**。分页拉全是修复 R2（数据判定错位）的核心手段，而其唯一设计（order+cursor）与权威契约直接冲突且未经验证。必须：(a) 改为符合 spec 的翻页方式（cursor 单独驱动，或首页 order/后续 cursor 分离），或 (b) 补真机实测证明 `order=asc`+cursor 组合被接受且方向正确，二者取其一后重审。

---

## 汇总

- **P0（阻塞）**：3 个
  - P0-A：§4.2 信号1（idle 消息）无落地代码位置，方案不可实现
  - P0-B：`failed`/`interrupted` outcome 未区分，存在误判成功 + 误标 EXTRACTED
  - P0-C：§4.3 `order=asc`+cursor 违背 OpenAPI「Do not combine with order」，翻页可能整体失效
- **P1（重要）**：3 个
  - P1-D：V2 下信号1 永久失效，完成判定退化为单点
  - P1-E：listCandidateSessions 分页「同理处理」不具体、两端点契约不同、上限无值
  - P1-F：R9 sawReply 仅一句、无修法
- **P2（讨论）**：3 个（P2-G 黑名单无名单、P2-H DB 路径无 fork 字段、P2-I 探测收紧 ✅ 正确）
- **P3（信息）**：1 个（streamed 移除为净收益，风险表标注过度乐观）

---

## 最终裁决

**REJECTED**

**阻塞项（必须修复后方可放行）**：
1. **P0-A** — 明确 idle 消息判定接入的函数与替换逻辑，让 §4.2 信号1 可落地。
2. **P0-B** — 定义 `succeeded`/`failed`/`interrupted` 三种 outcome 的差异化处置，禁止 failed/interrupted 判为抽取成功。
3. **P0-C** — 按 OpenAPI 契约修正分页方案（cursor 与 order 互斥），或补真机验证 `order=asc`+cursor 组合的实测证据。

**应修**：P1-D、P1-E、P1-F、R8/R13 显式声明。

**说明**：v2 相比 v1 是一次实质性进步——真机证据扎实（F-1~F-12）、方向正确、契约层适配（请求体映射、探测收紧、认证）已收敛。但**核心重写的完成判定（§4.2）与分页（§4.3）在细节上仍不可落地/违背实测契约**，触及「数据丢失防护」这一方案的根本目标，故本轮不予放行。

> 证据来源：`https://opencode.ai/v2/openapi.json` 实核对（`Session.Message.Idle.outcome` required、`SessionMessagesResponse`、`/api/session/{sessionID}/message` 的 `cursor`「Do not combine with order」、`Session.Info.fork` 可选、`ServerInfo` 四必填+`additionalProperties:false`、`/api/session/active` 语义）；`verification.md` F-1~F-12；`opencode-client.js` 行号；`design-review.md` R1–R13。未验证项已显式标注（order+cursor 组合、流式中间态、V1 `/api/info`）。
