#!/usr/bin/env node

import { 
  searchKnowledge, 
  getKnowledge, 
  listRecent, 
  getDatabase, 
  backupDatabase, 
  exportToMarkdown, 
  getStats,
  syncEmbeddings,
  getMcpAuditLogs
} from './storage.js';
import { runOfflineScan } from './scanner.js';
import { 
  runDaemon, 
  stopDaemon, 
  getDaemonStatus, 
  showDaemonLogs 
} from './daemon.js';
import { MEMHUB_HOME, VAULT_DIR, BACKUP_DIR, DB_PATH } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
MemHub (memhub / mem-hub) CLI - AI 编程知识中枢与工程长效记忆

用法:
  memhub scan [数量]           离线扫描超过静默时间未活跃的历史 Session 跟踪状态
  memhub daemon [start|stop|status|logs]  后台常驻定时提炼守护服务 (默认后台运行)
  memhub find <关键词>         全文检索历史避坑经验与架构决策 (支持 FTS5 Trigram 模糊匹配)
  memhub get <id>              查看某张知识卡片的完整详细内容与代码正文
  memhub list [条数]           查看最近沉淀的高密度知识索引列表
  memhub stats [选项]          查看全局/项目研发态势、代码踩坑热点与风险预警
                               (支持 --detailed, --json, --project <name>)
  memhub audit [条数]          查看 MCP 工具调用审计流水 (支持 --tool <name>, --json)
  memhub backup [路径]         执行 SQLite 原生 VACUUM INTO 无损原子热备份
  memhub export [目录]         将 SQLite 数据库无损导出为结构化 Markdown 目录树 (Obsidian兼容)
  memhub embed                 全量/增量为已有知识计算 384 维语义向量并持久化
  memhub path                  打印知识库物理路径与数据库位置

daemon 守护指令:
  memhub daemon                默认后台静默启动守护进程
  memhub daemon start          后台启动守护进程
  memhub daemon stop           停止正在后台运行的守护进程
  memhub daemon status         查看后台守护进程运行状态与 PID
  memhub daemon logs [-n 30]   查看守护进程最近输出的日志

daemon 可选参数:
  --foreground, -f    强制前台运行并输出控制台日志
  --interval <分钟>   轮询周期 (默认 30)
  --window-days <N>   扫描窗口: 只处理最近 N 天更新的会话 (默认 7)
  --idle <分钟>       静默阈值: 距现在超过 N 分钟 (默认 120)
  --limit <条数>      单轮最多处理会话数 (默认 3)
  --once              只执行一轮后退出
  --dry-run           测试桩模式 (不真发 HTTP POST)
  --force             强制重新处理已跳过的会话
`);
}

switch (command) {
  case 'scan': {
    const limit = parseInt(args[1], 10) || 2;
    console.log(`🔍 开始扫描历史已结束（静默完成态）的 OpenCode 会话...`);
    runOfflineScan(limit);
    break;
  }

  case 'daemon': {
    const subAction = args[1];

    if (subAction === 'stop') {
      stopDaemon();
      break;
    }

    if (subAction === 'status') {
      getDaemonStatus();
      break;
    }

    if (subAction === 'logs') {
      let lines = 30;
      const nIdx = args.indexOf('-n');
      if (nIdx !== -1 && args[nIdx + 1]) {
        lines = parseInt(args[nIdx + 1], 10) || 30;
      }
      showDaemonLogs({ lines });
      break;
    }

    // 排除 start 关键字后的其余参数
    const rest = (subAction === 'start') ? args.slice(2) : args.slice(1);
    const cliOpts = { once: false, foreground: false };

    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--foreground' || a === '-f') cliOpts.foreground = true;
      else if (a === '--interval') cliOpts.interval = parseInt(rest[++i], 10) || undefined;
      else if (a === '--window-days') cliOpts.windowDays = parseInt(rest[++i], 10) || undefined;
      else if (a === '--idle') cliOpts.idleMinutes = parseInt(rest[++i], 10) || undefined;
      else if (a === '--limit') cliOpts.limit = parseInt(rest[++i], 10) || undefined;
      else if (a === '--once') cliOpts.once = true;
      else if (a === '--dry-run') cliOpts.dryRun = true;
      else if (a === '--force') cliOpts.force = true;
    }

    runDaemon(cliOpts);
    break;
  }

  case 'find':
  case 'search': {
    const rawArgs = args.slice(1);
    let project = null;
    let category = null;
    const tags = [];
    const queryTokens = [];

    for (let i = 0; i < rawArgs.length; i++) {
      const arg = rawArgs[i];
      if (arg === '--project' || arg === '-w' || arg === '--workspace') {
        project = rawArgs[++i];
      } else if (arg === '--category' || arg === '-c') {
        category = rawArgs[++i];
      } else if (arg === '--tag' || arg === '-t') {
        tags.push(rawArgs[++i]);
      } else {
        queryTokens.push(arg);
      }
    }

    const query = queryTokens.join(' ');
    if (!query) {
      console.log('请输入搜索关键词，例如: memhub find Alpine --project bindCenter --tag docker');
      process.exit(1);
    }
    const results = searchKnowledge(query, { 
      limit: 5,
      project,
      category,
      tags
    });
    if (results.length === 0) {
      console.log(`未找到与 "${query}" 相关的知识。`);
    } else {
      console.log(`\n🔍 找到 ${results.length} 条相关知识索引 (L1 级):\n`);
      results.forEach((r, idx) => {
        console.log(`${idx + 1}. [${r.id}] \x1b[36m${r.title}\x1b[0m`);
        console.log(`   分类: ${r.category} | 项目: ${r.project || 'global'}`);
        console.log(`   标签: ${r.tags.join(', ')}`);
        if (r.summary) {
          console.log(`   摘要: ${r.summary}`);
        }
        console.log('');
      });
      console.log('提示: 输入 `memhub get <id>` 查看完整正解代码与技术根因 (L2/L3 级)');
    }
    break;
  }

  case 'get': {
    const id = args[1];
    if (!id) {
      console.log('请输入知识卡片 ID，例如: memhub get kb-xxxx');
      process.exit(1);
    }
    const card = getKnowledge(id);
    if (!card) {
      console.log(`未找到 ID 为 "${id}" 的卡片。`);
    } else {
      console.log('\n' + card.content + '\n');
    }
    break;
  }

  case 'list': {
    const limit = parseInt(args[1], 10) || 10;
    const list = listRecent({ limit });
    console.log(`\n📚 最近沉淀的知识索引 (共 ${list.length} 条):\n`);
    list.forEach((item, idx) => {
      console.log(`${idx + 1}. [${item.id}] [${item.category}] \x1b[36m${item.title}\x1b[0m (项目: ${item.project || 'global'})`);
    });
    console.log('');
    break;
  }

  case 'stats': {
    let project = null;
    let jsonMode = false;
    let detailed = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--json') {
        jsonMode = true;
      } else if (args[i] === '--detailed') {
        detailed = true;
      } else if (args[i] === '--project' && args[i + 1]) {
        project = args[++i];
      } else if (!args[i].startsWith('-') && !project) {
        project = args[i];
      }
    }

    const stats = getStats({ project });

    if (jsonMode) {
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    console.log(`\n============================================================`);
    console.log(`              📊 MemHub 研发态势与知识资产大盘              `);
    console.log(`============================================================`);
    console.log(`【作用范围】: ${stats.project}`);
    console.log(`【长效资产】: ${stats.total_knowledge_entries} 篇 (估算规避试错节省 ~${stats.estimated_saved_tokens.toLocaleString()} tokens)`);
    
    console.log(`\n【📂 四大基石分类分布】:`);
    if (stats.categories.length === 0) {
      console.log(`  (暂无分类数据)`);
    } else {
      const maxCount = Math.max(...stats.categories.map(c => c.count), 1);
      stats.categories.forEach(c => {
        const barLen = Math.max(1, Math.round((c.count / maxCount) * 16));
        const bar = '█'.repeat(barLen).padEnd(16);
        console.log(`  • ${c.category.padEnd(12)} [${bar}] ${c.count} 篇`);
      });
    }

    console.log(`\n【🏢 按 Project 项目维度汇总分布】:`);
    if (!stats.projects || stats.projects.length === 0) {
      console.log(`  (暂无项目维度数据)`);
    } else {
      const maxProjCount = Math.max(...stats.projects.map(p => p.total), 1);
      stats.projects.forEach(p => {
        const barLen = Math.max(1, Math.round((p.total / maxProjCount) * 12));
        const bar = '█'.repeat(barLen).padEnd(12);
        console.log(`  • ${p.project.padEnd(18)} [${bar}] 总计: ${String(p.total).padStart(2)} 篇 (排错: ${p.learnings}, 决策: ${p.decisions}, 模式: ${p.patterns}, 业务: ${p.business})`);
      });
    }

    console.log(`\n【🤖 会话扫描与萃取流水】:`);
    if (stats.sessions_scanned.length === 0) {
      console.log(`  (暂未扫描历史会话)`);
    } else {
      stats.sessions_scanned.forEach(s => {
        console.log(`  • 状态 ${s.status.padEnd(12)}: ${s.count} 个会话`);
      });
    }

    console.log(`\n【⚡ MCP 工具调用频次与响应】:`);
    if (!stats.mcp_tool_calls || stats.mcp_tool_calls.length === 0) {
      console.log(`  (暂无 MCP 调用审计记录)`);
    } else {
      stats.mcp_tool_calls.forEach(m => {
        const avg = m.avg_duration_ms ? `${Math.round(m.avg_duration_ms)}ms` : '0ms';
        console.log(`  • ${m.tool_name.padEnd(20)}: ${String(m.count).padStart(4)} 次 (平均耗时: ${avg})`);
      });
    }
    console.log(`============================================================\n`);
    break;
  }

  case 'audit': {
    let limit = 20;
    let tool = null;
    let project = null;
    let jsonMode = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--json') {
        jsonMode = true;
      } else if (args[i] === '--tool' && args[i + 1]) {
        tool = args[++i];
      } else if (args[i] === '--project' && args[i + 1]) {
        project = args[++i];
      } else if (!isNaN(parseInt(args[i], 10))) {
        limit = parseInt(args[i], 10);
      }
    }

    const logs = getMcpAuditLogs({ limit, tool, project });

    if (jsonMode) {
      console.log(JSON.stringify(logs, null, 2));
      break;
    }

    console.log(`\n============================================================`);
    console.log(`              🔍 MemHub MCP 工具调用审计流水                `);
    console.log(`============================================================`);
    if (logs.length === 0) {
      console.log(`  (暂无 MCP 调用审计记录)`);
    } else {
      logs.forEach(l => {
        const timeStr = new Date(l.created_at).toISOString().replace('T', ' ').slice(0, 19);
        const statusBadge = l.status === 'SUCCESS' ? '✅' : '❌';
        const durationStr = `${l.duration_ms}ms`.padStart(6);
        const toolStr = l.tool_name.padEnd(16);
        const projStr = (l.project || 'global').padEnd(12);
        const queryStr = (l.query_summary || '-').slice(0, 45);
        console.log(`[${timeStr}] ${statusBadge} ${toolStr} | ${projStr} | 耗时:${durationStr} | 命中:${String(l.hits_count).padStart(2)} | 目标: ${queryStr}`);
      });
    }
    console.log(`============================================================\n`);
    break;
  }

  case 'backup': {
    const targetPath = args[1] || null;
    console.log(`🔄 正在执行 SQLite 原生 VACUUM INTO 原子无损热备份...`);
    try {
      const backupFile = backupDatabase(targetPath);
      console.log(`✅ 备份成功！单文件归档镜像已生成:\n   ${backupFile}`);
    } catch (e) {
      console.error(`❌ 备份失败: ${e.message}`);
    }
    break;
  }

  case 'export': {
    const targetDir = args[1] || VAULT_DIR;
    console.log(`🔄 正在将 SQLite 知识库导出为 Markdown 文件...`);
    try {
      const res = exportToMarkdown(targetDir);
      console.log(`✅ 导出成功！共导出 ${res.totalExported} 篇 Markdown 卡片至:\n   ${res.exportDir}`);
    } catch (e) {
      console.error(`❌ 导出失败: ${e.message}`);
    }
    break;
  }

  case 'embed': {
    console.log(`🔄 正在执行知识向量化与同步维护 (384 维语义空间)...`);
    try {
      const res = syncEmbeddings();
      console.log(`✅ 向量化同步完成！新计算并持久化了 ${res.processed} 条卡片向量。`);
    } catch (e) {
      console.error(`❌ 向量同步失败: ${e.message}`);
    }
    break;
  }

  case 'path': {
    console.log(`\nMemHub 物理路径配置:`);
    console.log(`  • 根目录:   ${MEMHUB_HOME}`);
    console.log(`  • SQLite库: ${DB_PATH}`);
    console.log(`  • Vault导出: ${VAULT_DIR}`);
    console.log(`  • 归档目录: ${BACKUP_DIR}\n`);
    break;
  }

  default:
    printHelp();
}
