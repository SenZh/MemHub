# Phase 2 & Phase 3 命名体系升级审查与交付总结

## 1. 变更背景与原因
用户严厉且敏锐地指出：“工具命令为什么叫 knowledge？这合适吗？”，一针见血抓住了“插件叫 MemHub（长效记忆中枢），工具却叫 knowledge（静态百科文档）”的心智断层与名词冗余缺陷。

---

## 2. 核心落地成果
1. **MCP 核心工具名全面升级为 `memhub_*` 极简动宾体系**：
   - **`memhub_save`**：主动沉淀并保存长效工程经验记忆；
   - **`memhub_search`**：两阶段渐进式检索第一阶段（~50 Tokens 强指纹摘要探测）；
   - **`memhub_get`**：两阶段渐进式检索第二阶段（展开高清 Markdown 记忆正文与真实代码）；
   - **`memhub_recent`**：最近沉淀记忆轨迹速览；
2. **完全平滑向后兼容**：
   - 隐式完全兼容 `hub_record_knowledge`, `hub_search_knowledge`, `hub_get_knowledge`, `hub_list_recent`；
   - 隐式完全兼容 `exo_record_knowledge`, `exo_search_knowledge`, `exo_get_knowledge`, `exo_list_recent`；
3. **测试套件与主干文档全面对齐**：
   - `tests/test-mcp-protocol.js` 全面升级为验证 `memhub_*` 契约，全量 7 大测试套件 100% 绿灯全过；
   - 同步更新了 `docs/architecture-design.md`、`README.md`、`requirements.md` 与 `tech-design.md`。

---

## 3. 验收状态
- 全量自动化测试：**100% 绿灯通过**；
- 宿主 MCP 连通性：**`✓ memhub connected`**；
- 数据库状态：重置为 **0 条测试残留** 的全新纯净状态。
