# 变更总结 (Summary)：MemHub 命名规范、动态时间与会话目录过滤治理

## 1. 变更总量统计

| 指标 | 统计值 |
| :--- | :--- |
| **涉及核心代码文件** | 5 个 (`src/path-filter.js`, `src/config.js`, `src/adapters/opencode.js`, `src/pipeline/scanner-service.js`, `src/cli.js`, `package.json`) |
| **测试文件** | 4 个 (`tests/test-path-filter.js`, `tests/test-config.js`, `tests/test-adapters.js`, `tests/test-cli.js`, `tests/e2e.js`) |
| **测试套件总数** | 7 大套件全部执行通过 (通过率 100%) |
| **审查发现问题总数** | 13 个 (Phase 1 设计审查 7 个 + Phase 2 代码测试审查 6 个) |
| **审查问题修复率** | 100% (全部修复闭环，无降级遗留) |
| **未解决遗留问题** | 0 个 |

---

## 2. 关键决策回溯

1. **命名收敛为 MemHub**：
   - 坚决废弃易冲突的 `hub` 命令，CLI 映射绑定为 `memhub` 与 `mem-hub`；
   - 恢复并保留 `memory-hub` 作为 MCP 入口命令，向后兼容 `exo`。
2. **两阶段 Glob 正则分步替换算法**：
   - 放弃直替换算法，采用安全占位符 `__GLOB_STAR_STAR__`，解决 `**` 与 `*` 的相互嵌套踩踏；
   - 特殊处理末尾 `/**`，确保既匹配目标工程自身（末尾无斜杠），也匹配任意子路径，杜绝规则失效与逃逸。
3. **分层配置与防御性优先级**：
   - 环境变量 `MEMHUB_IDLE_MINUTES` 拥有最高解析优先级；
   - 过滤顺序严格保持：`watchDirectories 根目录限制` $\rightarrow$ `exclude 黑名单拦截 (最高)` $\rightarrow$ `include 白名单确认`。

---

## 3. 审查质量检视

| 检视项 | 检视结果 | 说明 |
| :--- | :--- | :--- |
| **审查问题与改动复杂度匹配** | ✅ 匹配良好 | 针对正则编译、时间过滤与测试真实性挖掘出 4 个 P0 级严重隐患 |
| **发现问题位置引用率** | ✅ 100% 具备精确行号引用 | 空泛描述数为 0 |
| **严重度分布合理性** | ✅ 区分鲜明 | P0 阻塞级 4 个、P1 重要级 6 个、P2 优化级 3 个 |
| **双审独立性与真实退回** | ✅ 真实有效 | Phase 1 与 Phase 2 均触发了真实的退回修改与再次验证闭环 |

---

## 4. 5 关自检终审 (ANTI_OPTIMISM_CHECKPOINT)
1. ✅ **需求对照**：用户要求的 MemHub 命名、CLI 弃用 hub、静默时间可配置、指定目录 include/exclude 采集全部完整实现。
2. ✅ **验证执行**：`contract.md` 规定的 6 大主路径与边界异常场景在自动化测试中 100% 真实执行验证通过。
3. ✅ **相邻检查**：检查 `OpenCode` 宿主 MCP 连通状态正常，向后兼容 `exo` 与旧存储路径正常。
4. ✅ **过程合规**：严格执行了 Phase 1（分析设计+设计审查） $\rightarrow$ Phase 2（实施+代码审查+测试审查） $\rightarrow$ Phase 3（自检总结）。
5. ✅ **指令遵守**：未跳过任何双审，未推脱任何缺陷。
