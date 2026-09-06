# Phase 1 设计审查报告 (Design Review)

## 1. 主 Agent 自审结论
- **需求对照**：覆盖了用户关于 MemHub 命名、CLI 命令绑定、静默时间可配置、目录 include/exclude 规则的需求，但在整体调用链穿透与根目录判定上缺少明确表述；
- **自审发现**：
  1. 正则替换算法若先替换 `**` 再替换 `*`，内部的 `*` 会被二次替换导致正则表达式语法错乱；
  2. 需求中的 `watchDirectories`（指定扫描根目录）未在匹配引擎中落实；
  3. `package.json` 的 `bin` 移除 `memory-hub` 会影响 MCP 的直接调用。

---

## 2. 独立 Sub-agent (review) 审查意见汇总
Sub-agent 提出 7 项问题（P0 级 2 项，P1 级 3 项，P2 级 2 项），判定为 **需修改后重审 (REJECTION)**：
1. **[P0] Glob 转正则算法时序踩踏与特殊字符未转义**（`tech-design.md` §3）；
2. **[P0] `watchDirectories` 在设计与契约中彻底悬空断层**（`requirements.md` / `tech-design.md`）；
3. **[P1] `ScannerService` 扫描链路未打通配置透传**；
4. **[P1] `package.json` 误删 `memory-hub` 命令**；
5. **[P1] 会话自循环防卫遗漏新前缀 `[MemHub]%`**；
6. **[P2] `PathFilter` 缺失对象复用与空路径防御**；
7. **[P2] 测试方案缺少特殊符号转义与盘符混合等场景**。

---

## 3. 主 Agent 仲裁与裁决

### 差异点仲裁结论：全部采纳并立即修正文档
Sub-agent 指出的问题全部客观存在、直击要害。主 Agent 裁决：**全盘接受审查意见，不带折扣地修改设计、契约与测试方案文档。**

### 审查质量校验
Sub-agent 逐项引用了具体文件名与行号，严重度有分级，审查质量**完全合格**。

---

## 4. 审查问题清单与解决落实

| # | 类型 | 问题描述 | 引用位置 | 严重度 | 状态 | 解决方案 |
|---|------|---------|---------|--------|------|---------|
| 1 | 逻辑缺陷 | Glob 转正则存在时序踩踏与特殊字符转义遗漏 | `tech-design.md:61` | 高 (P0) | ✅ 已解决 | 重构编译算法：先转义特殊字符，再用安全占位符分步置换 `**` 与 `*` |
| 2 | 需求断层 | `watchDirectories` 根目录过滤未在引擎中落地 | `tech-design.md:68` | 高 (P0) | ✅ 已解决 | 在 `PathFilter` 中加入根目录包含判定，默认全库放行，指定后必须在根目录下 |
| 3 | 调用链路 | `ScannerService` 未向适配器注入扫描规则配置 | `tech-design.md:85` | 中 (P1) | ✅ 已解决 | 明确 `ScannerService` 统一加载配置并传入 `adapter.scanCandidateSessions(opts)` |
| 4 | 兼容隐患 | 误删 `memory-hub` 导致已有 MCP 启动配置报错 | `tech-design.md:16` | 中 (P1) | ✅ 已解决 | `bin` 同时注册 `memhub`、`mem-hub`、`memory-hub` 与 `exo` |
| 5 | 安全防卫 | 扫描防自循环遗漏新前缀 `[MemHub]%` | `tech-design.md:88` | 中 (P1) | ✅ 已解决 | SQL 明确补充 `AND title NOT LIKE '[MemHub]%'` |
| 6 | 健壮性 | `PathFilter` 需预编译对象复用并防御空路径 | `tech-design.md:70` | 低 (P2) | ✅ 已解决 | 设计为 `PathFilter` 类，预编译正则，空路径默认跳过 |
| 7 | 测试完备 | 补充盘符、特殊符号与极端值用例 | `test-plan.md:15` | 低 (P2) | ✅ 已解决 | 测试方案扩展为 10 条用例，覆盖全部边界场景 |

**裁决最终状态**：修正文档已就绪，准予进入 Phase 2。
