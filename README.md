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
- ⚡ **单文件 SQLite 工业存储内核**：
  - 核心数据存放在单文件 SQLite（`~/.memhub/memory.db`）中，自带 WAL 事务锁与 FTS5 倒排索引，杜绝多文件 I/O 碎片与并发写损坏；
  - 原生支持 `VACUUM INTO` 无损热备份归档与一键导出 Obsidian 兼容的 Markdown 目录。
- 🔍 **两阶段渐进式披露协议 (Progressive Disclosure)**：
  - **阶段一（检索）**：仅返回单条 ~30-50 Tokens 的高密度索引摘要，并带引导指令，防止 Token 爆炸与注意力迷失；
  - **阶段二（展开详情）**：大模型确认命中后，按需批量拉取深度技术根因剖析与可运行代码块。
- 🛡️ **前置查重与版本演进防线**：
  - 标题哈希前置防重，彻底消灭重复卡片堆积；
  - 支持 `supersedes` 显式版本演进，新方案入库自动置换历史废弃版本。
- 🕒 **可配置静默时间与会话目录过滤引擎**：
  - 自动判定会话静默完成态（默认 120 分钟未更新判定为已结束，支持动态配置与环境变量覆盖）；
  - 路径过滤引擎提供 `watchDirectories` 根目录限制、`exclude` 黑名单（最高优先）与 `include` 白名单确认。
- 🔒 **敏感凭据前置脱敏 (Secret Scrubbing)**：
  - 入库前自动匹配清洗常见云厂商 AK/SK、JWT、密码、私钥，替换为 `***REDACTED***`。

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
# 查看最近沉淀的知识索引
memhub list

# 毫秒级全文检索历史避坑经验与架构决策
memhub find "Alpine glibc"

# 查看某张卡片的完整代码与技术根因
memhub get kb-c3ffcbe1

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
