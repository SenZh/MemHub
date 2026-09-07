# MemHub

> **面向 AI 编程与软件工程的长期记忆与暗知识调度中枢 (The Unified Long-term Memory & Knowledge Hub for AI Coding Agents)**  
> 一次踩坑、全局免疫、永不遗忘。支持 OpenCode、Cursor、Claude Code 等任意支持 MCP 的 Agent。

---

## 🌟 为什么需要 MemHub？

在当下使用 AI Agent 进行软件工程开发时，普遍存在**知识资产蒸发**与**反复踩坑**的痛点：
- **知识蒸发**：花了几个小时攻克隐蔽环境 Bug、版本断层或敲定复杂架构决策，Session 一关就彻底淹没在历史聊天中，下次切换工具或新会话 Agent 依然“失忆”；
- **操作流水账噪音**：市面上的记忆插件多侧重于记录无脑的工具调用片段（`Observation`），排查一次问题产生几十条命令垃圾，信息噪音极大且吃爆 Context Window；
- **缺乏因果与决策建模**：通用记忆库仅存离散事实，无法表达**排错因果链（现象 $\rightarrow$ 根因 $\rightarrow$ 验证正解）**与**架构权衡决策（ADR / 业务潜规则）**。

**MemHub 不做操作录音机，做开发者的“工程认知与实操随身锦囊”。**

---

## 🚀 核心特性

- 🧠 **借宿主算力提炼（零 API Key 依赖）**：利用原会话自身上下文与模型参数执行知识抽取，吃 Prompt Cache 近乎零额外费用。
- ⚡ **单文件 SQLite 工业存储内核 + DDL 自愈**：
  - 核心数据存放在单文件 SQLite（`~/.memhub/memory.db`）中，自带 WAL 事务锁与 FTS5 倒排索引，杜绝多文件 I/O 碎片与并发写损坏；
  - 内置 DDL 热迁移自愈引擎，自动感知新字段与老库升级；
  - 原生支持 `VACUUM INTO` 无损热备份归档与一键导出 Obsidian 兼容的 Markdown 目录。
- 🧩 **三大基石分类与结构化要素清单**：
  - 彻底收敛为三大正交顶级分类：`learnings`（排错避坑）、`decisions`（架构决策 ADR）、`patterns`（最佳实践模板）；
  - 彻底补全业务操作背景、底层因果、已排除误区清单、受影响拓扑面与架构红线，消灭“半拉子废纸”。
- 🎯 **工作区隔离与多标签交集检索**：
  - 支持 `(project = ? OR project = 'global')` 物理隔离无关项目，同时穿透全局通用经验；
  - 基于 SQLite 原生 `json_each` 实现标签多值交集（AND）参数化精准收窄。
- 🤖 **极简动宾 MCP 协议与大模型自主认知**：
  - 核心工具全面升级为 `memhub_save`（存）、`memhub_search`（搜）、`memhub_get`（取）、`memhub_recent`（历）；
  - 彻底消灭“叫 knowledge”的心智割裂，自解释 Schema 让大模型自主形成两阶段防爆 Token 行为。
- 🛡️ **物理终态成功证据门禁 (Truth Verification Gate)**：
  - 提炼引擎前置检验退出码 0、测试通过或服务就绪证据，严禁记录未经验证的猜测。
- 🕒 **可配置静默时间与会话目录过滤引擎**：
  - 自动判定会话静默完成态（默认 120 分钟未更新判定为已结束，支持动态配置与环境变量覆盖）；
  - 路径过滤引擎提供 `watchDirectories` 根目录限制、`exclude` 黑名单（最高优先）与 `include` 白名单确认。
- 🔒 **敏感凭据深度递归脱敏 (Secret Scrubbing)**：
  - 入库前自动匹配清洗标量字段与多级数组要素中的 AK/SK、JWT、密码、私钥，替换为 `***REDACTED***`。

---

## 📦 架构全景

```text
                  AI Agent (OpenCode / Cursor / Claude Code)
                                      │
         ┌────────────────────────────┴────────────────────────────┐
         ▼ (主动交互)                                               ▼ (离线自动萃取)
  MCP 协议接口 (memhub-mcp)                               后台守护引擎 (memhub scan)
  • hub_record_knowledge                                  • 定时检查静默会话 (>2小时未更新)
  • hub_search_knowledge (L1 索引 ~50 tokens)             • 目录 include/exclude 规则过滤
  • hub_get_knowledge (L2/L3 展开代码详情)                • 排除 [MemHub] 前缀防自循环
  • hub_list_recent                                       • 借宿主模型单轮轻量归纳
         │                                                         │
         └────────────────────────────┬────────────────────────────┘
                                      ▼
                      【MemHub 核心单文件 SQLite 内核】
                         (~/.memhub/memory.db)
                      ┌────────────────────────────┐
                      │ • knowledge_items (物理分层)│
                      │ • knowledge_fts (Trigram)  │
                      │ • session_tracking (状态机)│
                      └─────────────┬──────────────┘
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
            VACUUM INTO 无损原子冷备      export 按需导出 Markdown
           (~/.memhub/backups/*.db)      (~/.memhub/vault/ 知识星空)
```

---

## 🛠️ 安装与配置

### 1. 全局配置至 OpenCode

在 OpenCode 的全局配置文件（`~/.config/opencode/opencode.json`）中添加 MCP Server：

```json
{
  "mcp": {
    "memhub": {
      "type": "local",
      "command": [
        "node",
        "/path/to/MemHub/src/index.js"
      ],
      "enabled": true
    }
  }
}
```

验证连接状态：
```bash
opencode mcp list
# 应显示：✓ memhub connected
```

---

## 💻 命令行 CLI 用法 (`memhub` / `mem-hub`)

```bash
# 全域盲查（最常用，0 门槛）
memhub find "Alpine glibc"

# 多维高级检索：限定工作区(项目) + 过滤标签 + 指定分类
memhub find "批量锁" --project pay-center --tag redisson --category learnings

# 查看某张卡片的完整代码与分类专属详情 (L2 级展开)
memhub get kb-c3ffcbe1

# 查看最近沉淀的知识索引（支持按项目与标签过滤）
memhub list

# 离线扫描已结束（超过静默时间）的历史会话并自动萃取入库
memhub scan

# 查看研发投入轨迹与知识资产统计大盘
memhub stats

# 执行 SQLite 原生 VACUUM INTO 原子无损热备份冷备
memhub backup

# 将 SQLite 知识库无损导出为人类友好的 Markdown 目录树 (Obsidian兼容)
memhub export

# 打印当前知识库物理文件路径
memhub path
```

---

## 🤖 MCP 工具与大模型自主认知契约

MemHub 遵循“渐进式披露 (Progressive Disclosure)”与“自解释认知契约”，向大模型暴露 4 个标准 MCP 工具（以 `memhub_*` 为标准命名空间，并完全向下兼容 `hub_*` 与 `exo_*`）：

| 标准 MCP 工具名 | 角色与认知定位 | 大模型何时调用？怎么用？ |
|:---|:---|:---|
| **`memhub_search`** | **渐进式检索 - 阶段一**<br>(~50 Tokens 超轻量探测) | **动代码前必调**。输入 `query`（可带 `project`、`tags`、`category`），返回极简强指纹摘要。大模型负责先在上下文比对确认是否吻合。 |
| **`memhub_get`** | **渐进式检索 - 阶段二**<br>(确定性高清 Markdown) | **确认吻合后再调**。传入 `ids: ["kb-xxx"]` 展开完整卡片（含业务背景、深层因果、验证正解、已排除误区与架构红线）。 |
| **`memhub_save`** | **主动长效资产沉淀**<br>(工程认知持久化) | **攻克排错(learnings)、敲定决策(decisions)、写出模板(patterns)后调用**。强制要求填写业务背景(`context`)与正解(`solution`)，严禁脑补。 |
| **`memhub_recent`** | **最近记忆轨迹速览**<br>(新会话破冰) | **新开会话、接手新项目时调用**。快速拉取最近演进，支持按 `project`（自动穿透 global 资产）和 `tags` 过滤。 |

---

## ⚙️ 配置文件说明 (`~/.memhub/config.json`)

```json
{
  "version": "1.0",
  "idleMinutes": 120,
  "scanRules": {
    "watchDirectories": [
      "D:/workspace"
    ],
    "include": [
      "**/my-important-project/**"
    ],
    "exclude": [
      "**/tmp/**",
      "**/scratchpad/**",
      "**/node_modules/**",
      "**/*demo*"
    ]
  }
}
```

- **`idleMinutes`**：判定会话进入已结束完成态的静默分钟数（默认 120，支持环境变量 `MEMHUB_IDLE_MINUTES` 覆盖）；
- **`watchDirectories`**：限制扫描的物理根目录数组（默认空表示全库扫描）；
- **`exclude`**：黑名单通配符规则，**最高优先级**，命中立即跳过；
- **`include`**：白名单通配符规则，未配置默认全部放行。

---

## 🧪 测试与质量保障

MemHub 拥有完整的分层自动化测试矩阵（涵盖路径引擎、配置防腐、存储内核、适配器动态过滤、管道提炼、Stdio MCP 渐进披露及 CLI 映射）：

```bash
npm test
# 7 大测试套件 100% 自动化全绿灯通过
```

---

## 📄 开源许可证

[MIT License](LICENSE)
