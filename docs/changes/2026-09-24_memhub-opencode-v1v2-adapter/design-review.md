# Phase 1 设计审查报告：OpenCode v1/v2 双版本适配 (Design Review)

> 变更编号：2026-09-24_memhub-opencode-v1v2-adapter
> 审查方式：3 个独立审查 Subagent（差异化视角）+ 交叉 BATTLE 互攻
> **最终裁决：REJECTED（不通过，须修复后复审）**

## 1. 阶段概述

对 `tech-design.md` 与 `src/host/opencode-client.js` 已落地的双版本适配实现，执行「3 视角独立评审 → 互相 battle」双轮流程：

- **A 视角**：架构正确性（契约对齐与逻辑正确）
- **B 视角**：破坏性与风险（回归、静默失效、安全）
- **C 视角**：测试与验证（覆盖度、可证伪性、证据诚信）

三轮独立结论一致 `REJECTED`，命中重叠缺陷（非单点误判）。BATTLE 轮各评审主动自我纠偏，剔除误报。

---

## 2. BATTLE 收敛后的最终问题清单

排序原则：数据丢失 > 静默误判 > 安全 > 证据诚信 > 覆盖缺口。`[真机]` = 须真机验证才能确证触发路径。

| 编号 | 级别 | 问题 | 位置 | 结论 |
|---|---|---|---|---|
| R1 | **P0** | V2 `getSessionStatus` 把「不在 `/api/session/active` 集合」判为 `idle`，丢失 `unknown` 语义；`waitForSessionIdle` 对 `idle` **无二次确认**即优先短路返回 completed → `daemon.js:490` 删除 fork，抽取腰斩/静默丢数据 `[真机]` | `opencode-client.js:579-582`、`:670` | 三方共识。C 修正了 A 的因果方向：真机若副本**不在** active 才短路（更隐蔽） |
| R2 | **P0** | V2 `/api/session/:id/message` 与 /api/session 是**分页端点**（省略 limit 只返回默认页），代码不传 `limit/order`、不解 `cursor` → 会话漏筛 + 取错「最后一条 assistant」→ 提前判定完成 | `opencode-client.js:361,452,613` | C/B 均主张 P1→P0 升级 |
| R3 | **P0** | `getLastAssistantProgress` 用 `time.completed \|\| time.streamed` 判完成；`streamed` 与 `completed` 在 OpenAPI 中为**并列可选字段**、无语义说明，OR 逻辑可疑（长 tool-call 期误判） | `opencode-client.js:625` | 三方共识，A 自我降 P0→P1，C/B 维持 P0 |
| R4 | **P0** | `tests/test-host-client-v2.js` **未纳入** `tests/e2e.js` suites 数组 → `npm test` 永不执行，V2 适配自动化门禁 **0 覆盖** | `tests/e2e.js:20-36` | C 提出，A/B 接受事实、质疑等级 |
| R5 | **P0** | `tech-design.md` 声称「全量 14 套件 PASS」与实际不符（e2e 实为 15 项且不含 v2，`tests/` 有 18 个 test-*.js）→ 证据诚信 | `tech-design.md:106` | C 提出并拆分独立计数 |
| R6 | P1 | `isSubagentSession` 仅靠标题正则 `(fork #N)`，未用 V2 权威结构字段 `Session.Info.fork:{sessionID,boundary}`；且 agent 白名单只认 `build/main/default`，会**漏抽** `plan` 等 V2 主模式 `[真机]` | `opencode-client.js:394-397,413` | B 提出 P0，集体降 P1（未验证推测） |
| R7 | P1 | `detectApiVersion` 对 `/api/info` 判定过宽：`version` 字段两代共有，却被用作判 V2 的充分条件 → 返回含 version 的 V1 宿主会误判 V2（应改用 `pid`/`paths` 等 ServerInfo 专有字段） | `opencode-client.js:97` | B 提出，C 给出可测用例界定 |
| R8 | P1 | 探测阶段先带 Basic Auth 打**任意被扫描命中的本地端口**；`/api/info` 为 `security:[]`，带鉴权纯负收益 | `opencode-client.js:76-93` | B 提出 P0，**证伪为既有设计**（git 比对确认改造前已如此），降 P1 |
| R9 | P1 | `waitForSessionIdle` 兜底路径 `sawReply` 为死字段：注释声称「视为大概完成」，代码仅透传、未参与判定 | `opencode-client.js:685,696` | A 自审新增 |
| R10 | P1 | V2 认证模型未验证（spec 中 `/api/info`、`fork` 均 `security:[]`，无 securitySchemes）→ 若不接受 Basic Auth 则全链路 401 | 全 V2 请求 | A 从 B 分析反向提炼 |
| R11 | P1 | `Session.Message.Idle.outcome`（succeeded/failed/interrupted）为 V2 一等公民未被利用，可根治 R1 | `opencode-client.js` 消息解析 | A 提出，C/B 认同为最佳修复手段 |
| R12 | P1 | 异常路径零覆盖（404/500/401/非 JSON/超时全无断言）；`dispatchExtractionPrompt(dryRun:false)` 只断 `posted` 不断 body；mock 不校验 body schema | `tests/test-host-client-v2.js` | C 提出，A/B 接受 |
| R13 | P2 | 端口扫描 + 凭据外发的既有设计债（独立安全工单跟踪） | `discoverOpenCodeServer` | 既有，非本次引入 |

---

## 3. BATTLE 的自我纠偏记录（证明非走过场）

| 评审 | 原始主张 | 纠偏后 | 触发证据 |
|---|---|---|---|
| A | 3 个 P0 | 收敛为 **1 个真 P0**（R1 链）；自己把 `streamed` 从 P0 降 P1 以保持立场一致 | 承认 `streamed` 写入时机无法验证 |
| B | fork 套娃 = P0、凭据泄露 = P0 | **双双降级**（P1 / P2） | OpenAPI 证 `fork` 为可选字段且无标题行为文档；git 证凭据泄露是既有设计 |
| B | 分页 = P1 | **升为 P0（R2）** | OpenAPI 明示默认页大小，**静态可证的必然缺陷** |
| C | 「未入链」+「14/15」合并 1 个 P0 | **拆为 2 个独立 P0**（R4/R5） | 三个数字互不相等，比原表述更严重 |
| C | 未表态分页 | **升为 P0**（R2） | 与 idle 短路叠加成「三重提前删除」 |
| C | 未表态凭据泄露 | 从 P0 降 P1（R8） | 机制真实但前提严苛 |

**关键批判（C 提出、B 承认）**：测试 mock 把「fork 标题必带 `(fork #N)`」写死，是**循环论证**——用假设构造 mock、再用 mock 证明假设。该批判同样适用于 B 自己的 P0-1。

---

## 4. 必须真机验证的事项（mock 不可替代）

1. fork 副本**是否**出现在 `/api/session/active`（决定 R1 真实触发路径）
2. 真机 fork 后 `title` 是否被改写（决定 R6 标题正则是否碰巧可用）
3. `time.streamed` 与 `time.completed` 的真实写入时序（决定 R3 窗口大小）
4. `/api/session/:id/message` 单页条数上限与 `cursor.next` 行为（决定 R2 量化）
5. V2 是否接受 Basic Auth（决定 R10）
6. V1 宿主 `/api/info` 是否存在/返回什么（决定 R7 误判是否真实发生）

---

## 5. 裁决结论

**APPROVED / REJECTED：REJECTED**

**必须修复（放行门槛）**：
- R1（idle 短路链，建议顺带用 R11 `Idle.outcome` 根治）
- R2（分页契约违背）
- R3（完成判定 OR 过宽）
- R4（测试入链）
- R5（文档证据与实况对齐）

**应修**：R6–R12
**可延后**：R13

**复审前置条件**：补齐第 4 节 6 项真机事实校验 + 修复 R1–R5 + 重跑 V2 测试并补「仅 streamed 无 completed」「active 为空」「分页 cursor」「异常路径」「真发 prompt body」用例。

> 说明：本次评审对象是「已落地的实现」，改动方向正确、契约层适配扎实（V2 mock 与官方 OpenAPI 逐字段一致），但**完成判定/状态语义/分页/验证证据**四处需收敛后方可放行。
