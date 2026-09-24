# 修复交付报告：OpenCode v1/v2 双版本适配（Fix Delivery）

> 变更编号：2026-09-24_memhub-opencode-v1v2-adapter
> 阶段：实现 + 验证（Phase 2/3）
> 依据：`tech-design.md`（v2 方案）、`design-review-v2.md`（裁决：5 条 P0）、`verification.md`（真机 F1–F20）

## 1. 结论

**5 条 P0 全部修复，且经真机双向验证确证有效；全量 e2e 16 套件 100% 通过（EXIT=0）。**

修复过程中**真机又暴露 2 个 mock 测不出的新问题**（F16 继承 idle、F17 limit 上限），已一并修复。
这两个问题的发现**只可能来自真机**——再次印证「mock 绿 ≠ 修好」。

## 2. P0 修复对照表

| # | P0 | 修复内容 | 真机验证 |
|---|---|---|---|
| **P0-1** | 分页双版本不可落地 | 新增 `readAllMessages`/`listAllSessions`：**V1 裸数组一次性读取**（不传 limit/order）；**V2 只带 cursor 翻页**（不带 order，真机 F13 证互斥）；`limit=100` 避开 200 上限 + 400 降级重试；页数/条数硬上限 | F19：真机读取 111 条 ✅ |
| **P0-2** | 完成判定不可落地且自相矛盾 | `getLastAssistantProgress` 重写为三态；idle 消息权威判定（succeeded/failed/interrupted）；移除 `streamed` OR；`getSessionStatus` V2 改 `unknown`；`waitForSessionIdle` 按版本分流（V1 保留 status 短路，V2 走消息层）；双信号布尔关系裁决为「信号1 独占优先，信号2 仅回退」 | F20：7 succeeded + 1 failed 真机正确识别 ✅ |
| **P0-3** | 失败/超时误判成功 | `daemon.js`：**仅 `completed=true` 置 EXTRACTED**；失败/超时一律置 FAILED（可重试）；`waitForSessionIdle` 返回 `status` 区分 success/failed/timeout | F20 failed 分支 ✅ |
| **P0-4** | 异常路径零覆盖 | 401/404/500/非 JSON/超时均不误判成功；`waitForSessionIdle` 异常转 unknown/跳过并最终 timeout；**探测改「先裸探（200 或 401），确认后才带凭据」**防凭据外发 | 探测安全顺序改造 ✅ |
| **P0-5** | 测试未入链 + mock 固化错误行为 | 重写 `test-host-client-v2.js`：16→**17 项**（含 T1 秒短路成对 / T2 V1 裸数组 / T3 failed 三态 / T4 分页 / T5 F16 继承隔离 / R3 streamed）；`e2e.js` suites 纳入 v2；文档计数修正 | e2e SUITE 10 通过 ✅ |

## 3. 真机新暴露并修复的问题（mock 测不出）

### F16：fork 副本继承历史 idle → 修复后仍秒短路
- **现象**：改判 `unknown` 后 `getSessionStatus` 已不误判，但 `waitForSessionIdle` 仍 2121ms 秒判完成。
- **根因**：fork 副本**继承源会话全部历史**（含 `idle`+`succeeded`），末条 idle 判定直接命中继承的 idle。
- **真机二次修正**：`fork.boundary.messageID` **不可用作锚点**（副本消息 ID 被重写、boundary 不在副本中）。
- **最终修复**：`snapshotForkBaseline` —— fork 后对副本消息 **ID 做快照**，只认不在快照中的新增消息
  （真机证实：副本只保留最近 100 条、总数恒定，必须用 ID 差集而非数量变化）。
- **双向真机验证**：
  - 反向：空副本 + 基线 → `completed=false/timeout/5448ms`（不秒短路）✅
  - 正向：注入 prompt + 基线 → `completed=true/success/succeeded/8s`（新增 idle 正确识别）✅

### F17：`limit` 服务端上限 200，超限 400
- **根因**：原代码 `limit=200` 恰在边界（侥幸），上限更低则全部 400 → 静默超时丢数据。
- **修复**：保守取 `limit=100` + 400 降级重试。

## 4. 验证证据

| 项 | 结果 |
|---|---|
| V1 回归 `test-host-client.js` | **14/14 PASS**（零回归） |
| V2 适配 `test-host-client-v2.js` | **17/17 PASS**（含 R1/R2/R3/R11/F16 回归） |
| 全量 e2e | **16/16 SUITE PASS，EXIT=0** |
| 真机反向（不秒短路） | ✅ `timeout/5448ms` |
| 真机正向（正常完成） | ✅ `success/succeeded/8s` |
| 真机 failed 三态 | ✅ 正确识别为 failed |
| 真机残留清理 | ✅ 0 个残留 fork |

## 5. 仍存在的未验证项（如实标注）

1. **流式中间态**（有 `streamed` 无 `completed`）：仍未抓到。但已移除 streamed 判定，此路径不再影响结果。
2. **V1 宿主是否存在 `/api/info`**：本机仅 V2，跨版本误判未验（判定需 JSON + ServerInfo 特征字段，风险低）。
3. **`idle.outcome` 的 `interrupted` 真机取值**：仅观测到 succeeded/failed（interrupted 按 OpenAPI 规范处理）。
4. **`limit` 上限 200 是否为该版本特有**：已保守取 100 + 降级，兼容上限下调。

## 6. 修复产物清单

| 文件 | 变更 |
|---|---|
| `src/host/opencode-client.js` | 分页（`readAllMessages`/`listAllSessions`）、三态判定（`getLastAssistantProgress`）、版本分流（`waitForSessionIdle`/`getSessionStatus`）、`snapshotForkBaseline`、探测安全顺序、agent 黑名单、fork 权威字段 |
| `src/daemon.js` | 超时/失败置 FAILED、fork 后 `snapshotForkBaseline`、baseline 透传 |
| `tests/test-host-client-v2.js` | 重写为 17 项（新增 T1/T2/T3/T4/T5 回归） |
| `tests/e2e.js` | 纳入 v2 套件（15→16） |
| `docs/.../tech-design.md` | 按实现与真机对齐 |
| `docs/.../verification.md` | 新增 F13–F20 |
| `scripts/verify-*.js` | 真机复现/复验脚本（可复跑） |
