# P1 优化报告：OpenCode v1/v2 适配健壮性加固

> 变更编号：2026-09-24_memhub-opencode-v1v2-adapter
> 阶段：P1 优化（承接 `code-review-round2.md` 的 P1 清单）
> 依据：`code-review.md` / `code-review-round2.md` 列出的 P1 项

## 1. 结论

4 个 P1 项已逐条处置：**2 个真优化 + 1 个防御性加固 + 1 个经复核判定为非缺陷（如实说明）**。
全量 e2e 16/16 通过，真机 OpenCode 2.0.15 端到端复核通过。

## 2. 逐项处置

### P1-2 异常静默吞错（401/500 无告警）—— ✅ 已修（真优化）

**问题**：`waitForSessionIdle` 中 `getSessionStatus` / `getLastAssistantProgress` 的异常被
`catch { }` 静默吞掉，只表现为「最终超时」，401 未授权等错误无法排查。

**修法**：
- `waitForSessionIdle` 新增 `lastError` 字段，记录轮询期间最后一次异常消息并在返回值中透出。
- `daemon.js` 在 `lastError` 非空时打印明确告警。
- 新增测试 T8（模拟消息端点全程 401），断言 `lastError` 含 `401` 且不误判完成。

**证据**：T8 实测输出 `lastError = getLastAssistantProgress: 读取会话消息失败 HTTP 401` ✅

### P1-3 `lastIdle` 语义 —— ✅ 复核后判定「非缺陷」，仅加注释与防御

**评审意见**：设计文档称「末条 idle」，实现取「升序遍历后的最后一个 idle」，疑似语义偏斜。

**复核结论（基于真机 F21/F22）**：
- 实现遍历的是**时间升序**数组，末值即「时间最新的 idle」——**与「末条 idle」等价**，语义正确。
- 真机 F22 证实所有消息均带 `time.created`，且 `idle` 表示「某一轮任务结束」；
  在 `baselineIds` 差集隔离下，「新增 idle」就是**本次抽取任务**的完成信号，语义准确。
- **判定：非缺陷**。仅补充注释说明「最新 idle = 本次任务完成信号」，避免后续误读。

### P1-1 降级后 `pageLimit` 跨页复用 —— ✅ 防御性加固

**评审意见**：降级后的 `pageLimit` 被后续页复用，属「未验证风险、非已证缺陷」。

**修法**：`getLastAssistantProgress` 对 `scoped` 按 `id` **防御性去重**，
避免 cursor 翻页边界重复导致 `partsCount` 重复计数。
**关键约束**：仅对「有 `id`」的条目去重，**无 id 的条目全保留**——否则会误删 V1 裸消息、
导致 V1 判定失效（已在实现中显式处理并注释）。

### P1-4 V1 `getSessionStatus` 异常路径 —— ✅ 由 P1-2 一并覆盖

**问题**：V1 下 `getSessionStatus` 非 200 抛错 → `status='idle'` 短路失效 → 退化为消息层判定。

**复核结论**：
- 该降级**本身是安全的**：V1 有「assistant `time.completed`」消息判定做双保险，不会丢数据。
- 真正的痛点是「短路失效后无可观测信号」——已由 P1-2 的 `lastError` 覆盖。

## 3. 真机新增证据（本轮顺带抓到）

### F21 「流式中间态」真机实锤
```json
type=assistant  time={"created":...,"streamed":...}                    ← 无 completed，正在流式
type=assistant  time={"created":...,"streamed":...,"completed":...}     ← 已完成
```
- 这是历次评审一直「未抓到」的中间态，本轮观测到。
- **坐实 R3 修复正确性**：旧代码 `completed || streamed` 会把正在流式的消息误判为已完成；
  现在仅认 `completed`，中间态正确判为未完成。

## 4. 验证证据

| 项 | 结果 |
|---|---|
| V1 回归 `test-host-client.js` | **14/14 PASS** |
| V2 适配 `test-host-client-v2.js` | **20/20 PASS**（新增 T8 异常透出） |
| 全量 e2e | **16/16 SUITE PASS，EXIT=0** |
| 真机端到端（OpenCode 2.0.15） | ✅ 10s 完成抽取，`succeeded` |
| 异常可观测（T8） | ✅ `lastError` 正确透出 401 |
