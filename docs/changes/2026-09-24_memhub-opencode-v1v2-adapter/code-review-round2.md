# 代码复审报告（第二轮）：OpenCode v1/v2 双版本适配修复

> 变更编号：2026-09-24_memhub-opencode-v1v2-adapter
> 审查类型：修复后独立复审（针对上轮 2 个 P0）
> 审查对象：`src/host/opencode-client.js`（`readAllMessages` / `listAllSessions` / `snapshotForkBaseline`）、`src/daemon.js:445-449`、`tests/test-host-client-v2.js`（用例 17=T5、18=T6）
> 审查方式：静态逐行 + **独立编写 mock server 实测**（不复用项目 mock）+ **真机 2.0.15 复核**（`http://127.0.0.1:49612`）
> 审查基线：上轮 `code-review.md`、`verification.md` F16-b/F17/F18

---

## 一、P0-1 复审：`snapshotForkBaseline` 竞态 —— ❌ **未闭合（仍为 P0）**

### 1.1 修复内容确认

`opencode-client.js:741-771` 已由「固定 `settleMs=1500`」改为「轮询直到消息 ID 集**连续两次完全一致**（`sameSet(prev, cur)`）」，参数 `maxWaitMs=20000`、`pollIntervalMs=1500`；`daemon.js:448` 也同步去掉了 `settleMs` 传参。方向正确，但**判据强度不足**。

### 1.2 矛盾点：`sameSet` 连续 2 次一致 ≠ 复制完成

「连续两次一致」把「**相邻两次采样的间隔**（即 `pollIntervalMs`）」误当成「**复制已停止**」的证据。当复制在两次采样之间**停顿超过一个 `pollIntervalMs`** 时，两次采样必然读到相同的 ID 集 → 误判稳定 → 返回**过早且残缺**的快照。

### 1.3 独立实测：脚本与结果（必做项）

**脚本 1**：`D:\Users\470785\AppData\Local\Temp\opencode\review2-probe.mjs`（含 A. limit=1 与 C. baseline 竞态两部分）

构造模型：fork 副本前 1800ms 只可见 1 条历史 `h1`，>1800ms 后复制完成、插入第 2 条历史 `h2`（含 `idle+succeeded`）。运行结果：

```
[C] snapshotForkBaseline 耗时 = 1512 ms, 快照 ID 集 = ["h1"]
[C] 采样次数 = 2
[C] 是否漏掉后插入的历史消息 h2 = 是（竞态未闭合）
```

**关键**：`h2` 是 `idle+succeeded` 形态 —— 正是 F16 事故里「被漏掉后又被误判为本次新增完成信号」的那类消息。

**脚本 2**：`D:\Users\470785\AppData\Local\Temp\opencode\review2-defer.mjs`（多档停顿时长扫描，确定性模型）

```
pollInterval=1500（当前实现默认）:
  停顿 1000ms    -> 快照耗时 3035ms, 含 h2 = true  ✅ 未误判
  停顿 1800ms    -> 快照耗时 1516ms, 含 h2 = false ❌ 漏掉后插入历史（竞态）
  停顿 3000ms    -> 快照耗时 1515ms, 含 h2 = false ❌ 漏掉后插入历史（竞态）
  停顿 5000ms    -> 快照耗时 1513ms, 含 h2 = false ❌ 漏掉后插入历史（竞态）
```

**反直觉但可解释的结论**：复制停顿**越长**，越必然被误判为稳定（因为长长的停顿正好跨越一次采样间隔）。因此「轮询」这一改动**只解决了「复制总耗时 > 1.5s」的一半问题，另一半点（复制停顿 > pollInterval）反而被新判据"优化"成了必然误判**。

### 1.4 修复方向验证：单纯加「连续 N 次」无效，必须加「最小沉淀时长」

**脚本 3**：`D:\Users\470785\AppData\Local\Temp\opencode\review2-fixmodel.mjs`（停顿固定 5000ms，比较 4 种判据）

```
当前实现: 连续1次 / 1500ms                    耗时= 1524ms 含h2=false ❌
方案A: 连续2次 / 1500ms                     耗时= 3021ms 含h2=false ❌
方案B: 连续1次 + minSettle6s / 1500ms       耗时= 7547ms 含h2=true  ✅
方案C: 连续2次 + minSettle6s / 1500ms       耗时= 9055ms 含h2=true  ✅
```

→ **方案 A（把「连续 2 次」当修复）同样失效**：停顿可长达 2×1500ms。**必须叠加 `minSettleMs`（最小沉淀时长，≥6s）**才能闭合，与 F16-b「复制约 6s 才稳定」的真机事实一致。方案 B 为最小改动：保留现有轮询，仅在 `sameSet` 通过后再校验 `Date.now()-start >= minSettleMs`（默认 6000），否则继续采样。

### 1.5 真机佐证（本机 2.0.15）

**脚本 4**：`D:\Users\470785\AppData\Local\Temp\opencode\review2-repeat.mjs`（对源会话 `ses_f2edf2da9ffebHultAagCwrjXv` 连续 fork 3 次，每次快照后静置 12s 复查条数）

```
run1: 快照耗时=1630ms 快照=224 12s后=224 快照后新增=0 ✅
run2: 快照耗时=1640ms 快照=224 12s后=224 快照后新增=0 ✅
run3: 快照耗时=1652ms 快照=224 12s后=224 快照后新增=0 ✅
```

**真机解读（必须如实呈现，不得据 3 次绿就判闭）**：
- 本机本会话的复制在**首个 `pollInterval` 内即已完成**，故 3 次点测均未复现；这与「源会话较小、宿主机较快」一致，**不能反证竞态不存在**。
- 相反，F18 已记录**同一源会话两次 fork 结果不稳定（一次立即 100 条、另一次 20s 内 0 条）** —— 这正是「复制存在不可预测停顿」的真机证据。我的 mock 只是把 F18 的随机停顿**确定性化**后复核，证明该判据在停顿 > `pollInterval` 时必然误判。
- 结论按「代码判据 + 确定性复现」成立，不依赖真机是否复现。

### 1.6 裁决

**P0-1 未闭合，仍为 P0。** 理由：`sameSet` 连续两次一致只证明「两次采样之间无变化」，不证明「复制已终止」；存在「复制停顿 > `pollIntervalMs`」这一未被防守的区间，F18 已证真机复制停顿不可预测。**必须叠加 `minSettleMs ≥ 6000`（方案 B）**，单纯把 `stableRuns` 调到 2 无效（已实测）。

---

## 二、P0-2 复审：400 循环降级 —— ✅ **已闭合**

### 2.1 修复内容确认

- `readAllMessages:434-463`：`do...while` 循环内，`res.status === 400 && pageLimit > minLimit(=1)` → `pageLimit = Math.max(1, floor(pageLimit/2))` → `continue`（**cursor 未变，故确实重试同一页**）；`minLimit` 亦支持 `opts.minPageLimit` 覆盖。
- `listAllSessions:561-587`：同构循环降级，下限硬编码 1。
- 新增 T6（测试用例 18）：`mockLimitCap` 模拟服务端上限 50 与 1。

### 2.2 独立实测（必做项）

**脚本**：`D:\Users\470785\AppData\Local\Temp\opencode\review2-probe.mjs`（A 段，服务端对任意 `limit>1` 返回 400，`limit=1` 才可通过；分页用 cursor=已返回条数）

```
[A] 上限=1 读到文本消息数 = 4 (期望 4)
[A] 请求序列 = ["/api/session/ses-cap1/message?limit=100","...?limit=50","...?limit=25","...?limit=12",
                "...?limit=6","...?limit=3","...?limit=1",
                "...?limit=1&cursor=1","...?limit=1&cursor=2","...?limit=1&cursor=3","...?limit=1&cursor=4"]
[A] 结论 = PASS 循环降级生效
```

**判读**：
1. ✅ **覆盖上限=1**：从 100 一路 50→25→12→6→3→1，降级链完整，**未在 `pageLimit===1` 时抛错**。
2. ✅ **`continue` 重试同一页正确**：前 7 次请求均**不带 cursor**（同一首页反复重试），降级到 1 后才开始带 cursor 翻页。
3. ✅ **翻页取全**：`limit=1` 下逐页读到 4 条文本消息（含末条 idle），与期望一致。
4. ✅ 项目自带 T6 同向印证：`node tests/test-host-client-v2.js` → **18 项全绿，EXIT=0**（T6 断言上限 50 与 1 两档）。

### 2.3 「降级后 pageLimit 跨页复用」副作用复核

上轮 P1-1 的担忧是「降级后的 `pageLimit` 被后续页复用 → cursor 跨度与 limit 绑定可能漏读/重复」。复核结论：**属未验证风险，非已证缺陷；本次改动未加剧**。
- 降级只发生在**同一页重试**期间，降级完成时该页尚未消费，`all` 也未累积该页数据，故不存在「已用旧 limit 翻过的页被新 limit 重新解释」。真正的复用点仅为「后续页用降级后的更小 limit」——在真机 F13 语义（cursor 为游标而非 offset）下，更小 limit 只影响单页条数、不影响游标推进，**不会漏读**。
- 残留建议（非阻塞）：`getLastAssistantProgress` 使用前可对 `scoped` 按 `id` 去重，作为防御。

### 2.4 裁决

**P0-2 已闭合。** 循环降级覆盖上限=1；同页重试正确；独立实测与项目 T6 双绿。

---

## 三、新问题 与 上轮 P1 现状

### 3.1 本次改动引入的新问题

| # | 严重 | 问题 | 位置 | 证据 | 说明 |
|---|------|------|------|------|------|
| N-1 | **P1** | `snapshotForkBaseline` 超时兜底返回 `prev`（最后一次采样），**调用方无法区分「已稳定」与「超时未稳定」**，daemon 会照常把该基线用于差集，慢复制场景下静默降级为「可能多隔离几条历史」甚至「基线为空」 | `opencode-client.js:769-770` | 静态确认：返回类型恒为 `Set`，无 `stable` 标志 | 建议返回 `{ids, stable, waitedMs}` 或在超时时告警 |
| N-2 | **P2** | 降级循环**无降级次数与总请求数耦合保护**：若服务端对所有 `limit` 返回 400（非 limit 超限类），将一路降到 `minLimit` 后抛 400 错，行为可接受；但若服务端上限恒为 0/非法，最多产生 `log2(100)≈7` 次无效请求，无熔断 | `opencode-client.js:445-448` | 静态确认 | 可接受，建议记日志 |
| N-3 | **P3** | `snapshotForkBaseline` 的 `pollIntervalMs` 命名易被误读为「稳定判定窗口」，实际它同时是「采样间隔」与「误判窗口」 | `opencode-client.js:744` | 静态确认 | 建议注释显式说明 |

**未发现**因 P0-2 改动引入的功能性新缺陷。

### 3.2 上轮 P1 现状（本轮未涉及改动，逐条复核）

| 上轮 P1 | 现状 | 证据 |
|---|---|---|
| P1-1 降级后 `pageLimit` 跨页复用 | **未修复（保留）**，复核为未验证风险、非缺陷（见 §2.3） | `opencode-client.js:432` 循环外声明 |
| P1-2 异常静默吞错、401 无告警 | **未修复**：`waitForSessionIdle:963-967` 仍 `catch { status='unknown' }`；`:997-999` 仍吞消息读取异常；`getLastAssistantProgress` 抛错 → 静默轮询至超时 | 静态确认 |
| P1-3 `lastIdle` 语义偏斜（取「任意 baseline 外末条」而非「时间序末条」） | **未修复**：`opencode-client.js:886-892` 对排序后的 `scoped` 全量遍历取最后一条，与设计 §4.2 措辞仍有差异 | 静态确认 |
| P1-4 V1 `getSessionStatus` 异常路径语义变化 | **未修复**：`:797` 非 200 仍抛错 → V1 短路失效 → 退化为消息层 `info.time.completed` 判定 | 静态确认 |
| P1-5 文案/计数未对齐（tech-design「16 项」） | **部分**：实现/测试已为 18 项（T5/T6 新增），`docs` 计数需再次核对 | `tests/test-host-client-v2.js` 实测 18 项 |

> 说明：P1 均为**非阻塞**，但 P1-2（静默吞错）与 P1-3（`lastIdle` 语义）与本次 P0-1「假成功」主题同源，建议下一轮合并处理。

---

## 四、裁决

### **REJECTED**

阻塞项（**1 个 P0**）：

1. **[P0-1] `snapshotForkBaseline` 竞态窗口未闭合（原样存在，仅换了判据形式）**
   - 「连续两次 ID 集一致」在**复制停顿 > `pollIntervalMs`（1500ms）**时必然提前判稳，返回残缺快照；F18 已证真机复制停顿不可预测。
   - 独立确定性实测（`review2-defer.mjs`）覆盖 1000/1800/3000/5000ms 四档停顿：**除 1000ms 外全部误判**，且停顿越长越必然误判。
   - 修复方向已实测验证：**必须叠加 `minSettleMs ≥ 6000`（方案 B）**；单纯把「连续 N 次」提到 2（方案 A）**无效**（`review2-fixmodel.mjs` 实测仍漏）。
   - 影响不变：漏掉的继承 `idle` 被当「本次新增完成信号」→ 假 `EXTRACTED` + 数据丢失。

**已闭合项**：
- **[P0-2] 400 循环降级**：✅ 已闭合（覆盖上限=1，同页重试正确，独立实测 + T6 双绿）。

**剩余 P0 数：1**（P0-1）。

**放行条件**：`snapshotForkBaseline` 增加最小沉淀时长（`minSettleMs` 默认 ≥6000），或等价地要求「消息集在 `[max(2×pollInterval, 6000), maxWaitMs]` 窗口内保持不变」；建议同时让超时兜底可被上层区分（N-1）。

---

## 五、附：本轮实测脚本清单（可复现）

| 脚本 | 用途 | 关键结果 |
|---|---|---|
| `%TEMP%\opencode\review2-probe.mjs` | A. limit 上限=1 读消息；C. baseline 停顿竞态 | A: PASS 读全 4 条；C: 1512ms 返回快照 `["h1"]`，漏 `h2` |
| `%TEMP%\opencode\review2-defer.mjs` | 多档复制停顿扫描 | 停顿 1800/3000/5000ms 全部误判；1000ms 正常 |
| `%TEMP%\opencode\review2-fixmodel.mjs` | 修复方向对比（stableRuns / minSettle） | 连续2次无效；+minSettle6s 有效 |
| `%TEMP%\opencode\review2-repeat.mjs` | 真机 2.0.15 连续 fork 3 次 | 3 次快照耗时 ~1.6s、无漏；未复现（源会话小），已如实标注 |
| `tests/test-host-client-v2.js` | 项目自带 18 项 | EXIT=0 全绿 |

真机操作合规性：本轮真机仅执行 fork → 只读 → delete，**创建的 3 个 fork 副本与 1 个观测副本均已 `deleteSession` 清理**（脚本输出 `🧹 已清理`），未注入任何 prompt、未改动业务数据。
