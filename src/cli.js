#!/usr/bin/env node

import { 
  searchKnowledge, 
  getKnowledge, 
  listRecent, 
  getDatabase, 
  backupDatabase, 
  exportToMarkdown, 
  getStats,
  syncEmbeddings
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
  memhub stats                 查看全局或项目维度的研发态势与知识资产统计
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
    const project = args[1] || null;
    const stats = getStats({ project });
    console.log(`\n📊 MemHub 研发资产与态势统计:`);
    console.log(`----------------------------------------`);
    console.log(`作用范围: ${stats.project}`);
    console.log(`有效知识总数: ${stats.total_knowledge_entries} 篇`);
    console.log(`\n分类分布:`);
    if (stats.categories.length === 0) {
      console.log(`  (暂无分类数据)`);
    } else {
      stats.categories.forEach(c => {
        console.log(`  • ${c.category.padEnd(15)}: ${c.count} 篇`);
      });
    }
    console.log(`\n会话萃取状态:`);
    if (stats.sessions_scanned.length === 0) {
      console.log(`  (暂未扫描历史会话)`);
    } else {
      stats.sessions_scanned.forEach(s => {
        console.log(`  • 状态 ${s.status.padEnd(12)}: ${s.count} 个会话`);
      });
    }
    console.log(`----------------------------------------\n`);
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
