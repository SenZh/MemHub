# 真机事实校验报告：OpenCode V2 适配假设验证 (Verification)

> 变更编号：2026-09-24_memhub-opencode-v1v2-adapter
> 校验环境：本机运行中的 **OpenCode 2.0.15**（`/api/info` 返回 `version:"2.0.15", pid:7692`）
> 校验方式：**不做假设，直接打真实端点观测**；用 `/tmp` 之外的真实凭据（`OPENCODE_SERVER_PASSWORD`）
> 校验脚本：`scripts/verify-opencode-v2.js`、`scripts/verify-opencode-v2-deep.js`

## 0. 结论摘要

评审提出的 6 项「必须真机验证」事项**已全部得到事实结论**，其中 **3 项与评审假设相反**。

| # | 待验证事项 | 假设（评审） | **真机事实** | 影响 |
|---|---|---|---|---|
| 1 | detectApiVersion 判定 | 先探 /api/info → V2 | ✅ **判为 V2** | 判定正确 |
| 2 | V2 是否有 /global/health | v2 无此端点（404） | ❌ **返回 200 + SPA HTML 兜底** | 依赖 JSON 校验可排除，判定仍正确 |
| 3 | V2 是否接受 Basic Auth | 未验证（spec `security:[]`） | ✅ **接受**（401 带 `WWW-Authenticate: Basic`，带凭据 200） | R10 消除 |
| 4 | fork 副本是否在 active 集合 | 不确定，两种都可能致命 | ❌ **不在**！刚 fork 的副本被判 idle | **R1 确证成立（秒短路）** |
| 5 | fork 后 title 是否改写 | 未验证 | ✅ **确实追加 `(fork #N)`**；返回体带权威 `fork` 字段 | R6 标题正则真机有效，但权威字段未用仍是 P1 |
| 6 | time.streamed / completed 时序 | 未验证 | ✅ **完成态两者并存**：`{created, streamed, completed}` | R3 需重判 |
| 7 | 消息分页 | 未验证 | ❌ **默认 50 条、默认 desc（新→旧）、cursor 可翻页（实测 5 页 67 条）** | **R2 确证成立，且更严重** |
| 8 | V1 宿主是否有 /api/info | 未验证 | 本机无 V1 宿主，未验证 | 保留 |

---

## 1. 关键事实详录

### F1. 版本与鉴权（服务器 49612）
```
GET /api/info (无凭据)  → 401  WWW-Authenticate: Basic realm="Secure Area"
GET /api/info (带凭据)  → 200  {"version":"2.0.15","pid":7692,"urls":[...],"paths":{"tmp":"..."}}
```
- V2 **接受 Basic Auth** → R10（认证模型风险）**解除**。
- `/api/info` 的 `ServerInfo` 四字段与官方规范完全一致。

### F2. `/global/health` 在 V2 下返回 HTML（评审未预料）
```
GET /global/health → 200  Content: <!doctype html>...OpenCode SPA
```
- **重要**：V2 对所有未匹配路径返回 200 + SPA HTML（前端兜底）。
- `detectApiVersion` 的 `probe()` 依赖 `JSON.parse` 成功才判定 → **HTML 无法解析为 JSON → 不会误判为 V1**。
- ✅ 判定逻辑在真机下**正确**。但需注意：这是**依赖 JSON 解析的隐式保护**，应在代码注释中显式说明。

### F3. 会话对象真实字段
```
{
  id, projectID, agent, model, cost, tokens, outcome, time, title, location
}
time = { created, updated, idle }        ← 还有 idle 字段（评审未提及）
location = { directory: "D:\\ws\\MemHub" } ← 与假设一致 ✅
parentID = undefined (root session)      ← 与假设一致 ✅
fork 字段 = 不存在（非 fork 会话）        ← fork 为可选字段，与规范一致 ✅
```
- `location.directory` 归一化**真机生效**（验证 5：`listCandidateSessions` 返回的 `dir` 正确）。
- **新发现**：`Session.Info.time` 含 **`idle`** 字段（会话进入空闲的时间）。

### F4. `listCandidateSessions` 端到端真机通过
```
windowDays:30, idleMinutes:1 → 返回 3 个候选，directory 均正确归一化
```

### F5. `/api/session/active` 真实形态
```
{"data":{"ses_xxx":{"type":"running"},"ses_yyy":{"type":"running"}}}
```
- 只包含 **running** 的会话；当前工作会话在集合中。
- **未验证**：fork 出来的会话是否会自动进入 running（需 fork 实测）。

### F6. 消息接口分页行为（R2 确证，且比评审预判更严重）
```
GET /api/session/:id/message （不带 limit/order）
  → 默认返回 50 条
  → 默认顺序 = desc（新→旧）      ← 首条 created=1790217950699, 末条=1790215136899
  → cursor.next 非空

显式 order 对比：
  order=asc  → 旧→新
  order=desc → 新→旧
```
**这是最硬的证据**：当前代码 `getLastAssistantProgress` 用 `arr[arr.length-1]` 取「最后一条」——在默认 **desc（新在最前）** 下，取到的是**最旧的一条**：

```js
// opencode-client.js:620-635（现状）
for (let i = arr.length - 1; i >= 0; i--) {  // 倒序遍历取"最后一条"
```
- 默认 desc 时，`arr[arr.length-1]` = 最旧消息；倒序遍历找到的「最后一条 assistant」实际是**最旧的 assistant** → 完成度判定完全错位。
- 实测该会话共 **67 条消息 / 5 页**，**必须翻页**才能拿全。
- ❌ **R2 从 P0 确证，且是必然缺陷（静态+真机双重证实）**。

### F7. `type:'idle'` 消息**真实存在**，且携带 `outcome`
```
消息类型分布（单会话）: {assistant:60, user:4, idle:3}
多会话抽样（6 个）:     全部含 idle:true，outcome 均为 succeeded
```
- ✅ **R11 成立**：`Session.Message.Idle` 是真实的完成信号，可作为比 `time.completed`、`/api/session/active` 更权威的完成判定依据。
- 实测每个会话末尾都有 `idle` 消息，且 `Session.Info.outcome` 为 `succeeded`。

### F8. `time.streamed` 与 `time.completed` 真实并存
```
assistant.time = { created:..., streamed:..., completed:... }
```
- 已完成的消息**两者都有值**。
- 因此 R3 的关键问题变成：**流式进行中是否只有 `streamed` 无 `completed`** —— 这需要**抓一条正在流式的消息**才能确证，本轮未抓到。

---

## 2. 对评审结论的修正

| 评审项 | 修正后结论 |
|---|---|
| **R1**（idle 短路） | 机制**确认存在**（active 只含 running），但「fork 是否进 active」仍未验证 → 保留 **P0**，修复方向明确：V2 完成判定改用 **`idle` 消息 + `outcome`**（已证实存在），彻底绕开 active 语义歧义 |
| **R2**（分页） | **确证且升级**：默认 50 条 + 默认 desc → 当前取「最后一条」实为最旧一条，判定错位是**必然**。必须显式 `order` + 翻页 |
| **R3**（streamed OR） | 真机证明完成态两字段并存；「仅 streamed」中间态**未抓到** → 保留 P1，但修复方向明确：**只用 `completed` 或改用 `idle` 消息** |
| **R6**（fork 字段/标题） | 真机未触发 fork，**仍属未验证** → 保留 P1，需 fork 一次实测标题 |
| **R10**（V2 认证） | ✅ **消除**：V2 接受 Basic Auth |

---

## 3. fork 真机实测（第二轮，已执行）

脚本：`scripts/verify-fork.js`。对真实会话执行 fork → 观测 → 注入 prompt → 观测 → 清理。

### F9. fork 后 title **确实**追加 `(fork #N)` ✅
```
源会话:  title="opencode1 与 opencode2 接口兼容性分析"
fork 返回: title="opencode1 与 opencode2 接口兼容性分析 (fork #1)"
```
→ **R6 的「标题正则失效」风险在真机不成立**：V2 fork 确实改写标题。
→ 但 R6 的另一半仍成立：真机 fork 返回体**携带权威 `fork` 字段**（`{"sessionID":"...","boundary":{"type":"through","messageID":"..."}}`）—— 用标题正则属「有权威字段不用」，仍是 P1 稳健性缺陷（成本极低）。

### F10. fork 副本 **不在** `/api/session/active` 集合中 ❌（R1 确证）
```
active 集合: [来源会话, 其他会话...]   ← 不含 fork.id
getSessionStatus(fork) => idle        ← 被判为 idle
getSessionStatus(源会话) => running
```
→ 刚 fork 出的副本**立即被判为 `idle`**。

### F11. **R1 确证成立：waitForSessionIdle 对刚 fork 的空会话 1 秒内秒短路** ❌
```
waitForSessionIdle(fork, {maxWaitMs:8000})
  结果: completed=true  finalStatus=idle  耗时=1015ms
```
- 在**未注入任何 prompt**、fork 会话**完全为空**的情况下，`waitForSessionIdle` 在**第一轮轮询即返回 `completed:true`**。
- 因果链完整闭合：`getSessionStatus` 把「不在 active」判为 `idle` → `waitForSessionIdle:670` 见 `idle` 立即短路返回完成 → `daemon.js:490` 删除 fork → **抽取 100% 丢失**。
- **这是可复现的数据丢失事故，R1 从「P0 假设」升级为「P0 已证实」。**

### F12. 注入 prompt 后 fork 会话才进入 active，且 idle 消息是可靠完成信号 ✅
```
注入 prompt 后 t=1.5s: inActive=true   ← 有任务时才进 active
消息类型: user, system, assistant, ..., idle (×3)
lastAsst.time = {created, streamed, completed}  ← 三者并存
```
- **反向证明 R1 的修复方向**：`/api/session/active` 只反映「有活跃任务」，**不是「会话是否存在/完成」**。用它判完成在语义上就是错的。
- `idle` 消息在任务完成后出现，是**权威完成信号**（配合 `Session.Info.outcome`）。
- 附带：`deleteSession` 真机可用（删除后从列表消失）。

---

## 4. 尚未验证（需进一步实测）

1. **流式中间态**：需在 LLM 生成过程中高频抓 `/api/session/:id/message`，确认是否出现「有 streamed 无 completed」。（当前仅观测到完成态，两字段并存）
2. **V1 宿主是否有 `/api/info`**：本机仅有 V2，无法验证跨版本误判。

---

## 5. 第三轮补充实测（评审 v2 争议点裁决）

脚本：`scripts/verify-order-cursor.js`、`scripts/verify-fork-field.js`

### F13. 🔴 `order` 与 `cursor` **不可组合**，服务端硬报错（评审 A P0-C 确证）
```
GET /api/session/:id/message?limit=5&order=asc       → 200 ✅
GET /api/session/:id/message?limit=5&order=asc&cursor=<c> → 400
     {"_tag":"InvalidCursorError","message":"Cursor cannot be combined with order"}
```
- 这**不是** spec 的「建议不要组合」，而是服务端**硬拒绝 400**。
- v2 方案 §4.3「显式 `order=asc` + 循环 `cursor.next` 翻页」在真机上**根本无法工作**（第二页即 400）。**P0-C 从 spec 推断升级为真机确证**。
- **唯一可行的翻页方式**：翻页时**只带 `cursor`，不带 `order`**。
- 附带事实：不带 `order` 全程用 cursor 翻页，整体顺序恒为 **desc（新→旧）**（用例4：首条 1790218239974 → 末条 1790218189508）。因此**「想拿最新消息」不能靠 asc，而要靠翻页后取第一页的第一条，或全程 desc 后取所有页的第一条**。

### F14. ✅ 列表元素**确实携带 `Session.Info.fork` 字段**（评审 C 5c 缺口，验证后为好消息）
```
fork 一个会话后，GET /api/session 列表中该元素字段：
  id, fork, projectID, agent, model, cost, tokens, time, title, location
  fork = {"sessionID":"<源会话>","boundary":{"type":"through","messageID":"..."}}
```
- 评审 C 5c 指出：「`isSubagentSession` 用 `session.fork?.sessionID` 作权威兜底」这一设计，此前**只验证过 fork 接口返回体带 fork**（F-7），**未验证列表元素带 fork**。
- 本轮**真机直验**：**列表元素确实带 `fork` 字段**，字段名 `sessionID` 与设计一致 → **权威兜底 `session.fork?.sessionID` 在 HTTP 列表路径下可用 ✅**。
- 附注：本轮 fork 未传 `title` 时，fork 接口返回体 `title` 为 `undefined`，但列表元素中 title 已补全（含 `(fork #N)`）。说明 **fork 接口返回体的 title 不可靠（取决于入参），列表元素才可靠** → 这反向支持「不要依赖 fork 返回体 title，要以列表/单查为准」。

### F15. 现有 v2 mock 测试「忠实复刻了错误行为」（评审 C 8a 确证）
- `tests/test-host-client-v2.js:152` 断言 `getSessionStatus(不在 active) === 'idle'`
- `:198-199` 断言 `waitForSessionIdle` 返回 `{completed:true, finalStatus:'idle'}`
- 这两条 mock **忠实复刻了真机 F-10/F-11 的错误行为**（fork 不在 active → 判 idle → 秒短路）。
- **结论**：问题不在「mock 不忠」，而在「忠实复刻了一个错误行为，并把它当正确来断言」。设计修复（改判 `unknown` + 用 idle 消息判完成）**必然打红这两条现有断言** → v2 必须显式声明对它们的改写/删除，否则 CI 会「为绿而反向固化 bug」。

---

## 6. 第四轮：修复后真机复核（暴露 3 个 mock 测不出的新问题）

脚本：`scripts/verify-fix-realmachine.js`、`verify-fork-clean.js`、`verify-fork-inherit.js`

> **本轮最重要教训**：这 3 个问题**全部是 mock 测试测不出来、只有真机才暴露的**，
> 且其中 2 个会直接导致「修复后仍然丢数据」。再次证明「mock 绿 ≠ 修好」。

### F16. 🔴🔴 fork 副本**继承源会话的全部历史消息**（含 idle），导致「改用 idle 判定」后**仍然秒短路**
```
源会话（有 143 条消息 / 含多个 idle+succeeded）
  → fork 出的副本：立即读到 100 条消息，其中 idle 5 条，outcome 全为 succeeded
```
- **后果**：`getLastAssistantProgress` 用「末条 idle 消息」判完成 → 直接命中**继承来的历史 idle**
  → 刚 fork、**尚未开始抽取**就被判 `completed=true` → 真机复核实测 **2121ms 秒判完成**。
- **本质**：R1 的**秒短路没被消灭，只是把触发条件从「active 语义」换成了「继承的 idle 消息」**。
- **为何 mock 测不出**：mock 里 fork 副本是「空会话」（`mockMessages=[]`），而真机副本**带着源会话全部历史**。

### F16-b. 🔴 **二次修正**：`fork.boundary.messageID` 无法作锚点（副本重写 ID 且不含 boundary）
```
fork 返回: fork.boundary = {"type":"through","messageID":"msg_0d1660aec001..."}
fork 副本消息（100 条，desc）：
  首条 id = msg_0d166264a002MMPZQd5RvQV40C_1416   ← ID 被整体重写（带 _N 后缀）
  boundary 是否在副本中 = false                    ← fork 点的消息不在副本里
副本只保留最近 100 条（cursor.next 非空），最旧 time=1790217943630 < boundary time=1790219521028
```
- **结论**：不能用 boundary messageID 定位（真机实测**不在副本中**）。
- **可行方案（已验证）**：**fork 后对副本消息 ID 做快照**，之后只认「不在快照中」的新增消息。
  真机验证：副本复制约 6s 后稳定；快照后注入 prompt，新增消息清晰可辨
  （`新增=[user,system]` → `新增=[idle,assistant,user,system]`），且**总消息数恒为 100**
  （旧消息被挤出）→ **必须用 ID 集合差集，不能用数量变化判断**。

### F16-c. ✅ ID 快照方案真机双向验证通过
```
【反向】fork 空副本 + 快照基线：
  无基线: completed=true          （❌ 被继承 idle 误判——证明风险真实）
  有基线: completed=false/incomplete（✅ 正确隔离）
  端到端: completed=false/timeout/5448ms（✅ 不秒短路）
【正向】fork + 快照 + 注入 prompt：
  completed=true/status=success/outcome=succeeded/8s（✅ 新增 idle 被正确识别为完成）
```
- **修复方向**：必须区分「**fork 之后新产生的** idle」与「继承的 idle」——
  用 `fork.boundary.messageID`（真机确认为 `{type:'through', messageID:'msg_...'}`）作锚点，
  **只认可出现在 boundary 之后的消息**。

### F17. 🔴 `limit` 参数有**服务端上限 200**，超限直接 400
```
?limit=200  → 200 143条
?limit=201  → 400
?limit=500  → 400
```
- 修复代码里 `MESSAGE_PAGE_LIMIT=200` **恰好在边界上**（侥幸可用）；若某版本上限更低，
  则**所有消息读取 400 → 判定永不完成 → 静默走超时 → 数据丢失**。
- **修复方向**：显式记录「上限 200」这一真机事实；对 400（InvalidRequestError）做**降级重试**
  （如降半 limit），或直接保守取一个远低于上限的值（如 100）。

### F18. ⚠️ fork 副本消息**可见性存在异步延迟**（现象不稳定）
- 同一个源会话：一次 fork 后立即读到 100 条；另一次 fork 后 **20s 内 0 条**。
- 说明 fork 的历史复制**非同步完成**，`waitForSessionIdle` 早期轮询可能读到空 → 需容忍。
- **影响**：不能假设「fork 后就立刻有消息」。

### F19. ✅ 分页读取真机有效（单函数验证）
- `readSessionMessages(源会话)` 实测读取 **111 条**（正确翻页取全）；`getLastAssistantProgress` 正确返回
  `{completed:true, status:'success', outcome:'succeeded'}`。
- 说明分页逻辑本身正确，问题在于**「继承 idle」的判定归属**（F16）。

### F20. ✅ idle 消息三态判定真机有效（含 failed）
- 对 8 个真实会话逐一判定：
  - 7 个 `outcome=succeeded` → `completed=true, status='success'` ✅
  - 1 个 `outcome=failed`（就是本会话的 fork 评审子会话）→ `completed=false, status='failed'` ✅
- **证明 failed 分支真机可触发且被正确识别**（不再当成功）。

---

## 4. 校验方法学声明

- 本轮**不做任何假设**，所有结论来自对运行中 OpenCode 2.0.15 的真实 HTTP 请求。
- 脚本可复现：`node scripts/verify-opencode-v2.js <baseUrl>`、`node scripts/verify-opencode-v2-deep.js <baseUrl>`。
- 与评审的差异已显式标注（F2、F5、F6、F7 均修正或深化了评审假设）。
