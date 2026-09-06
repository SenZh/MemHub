#!/usr/bin/env node

import { 
  searchKnowledge, 
  getKnowledge, 
  listRecent, 
  getDatabase, 
  backupDatabase, 
  exportToMarkdown, 
  getStats 
} from './storage.js';
import { runOfflineScan } from './scanner.js';
import { MEMORY_HUB_HOME, VAULT_DIR, BACKUP_DIR, DB_PATH } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Memory Hub (hub) CLI - AI 编程知识中枢与工程长效记忆

用法:
  hub scan [数量]           离线自动扫描超过 2 小时未活跃的历史 Session 并自动萃取入库
  hub find <关键词>         全文检索历史避坑经验与架构决策 (支持 FTS5 Trigram 模糊匹配)
  hub get <id>              查看某张知识卡片的完整详细内容与代码正文
  hub list [条数]           查看最近沉淀的高密度知识索引列表
  hub stats                 查看全局或项目维度的研发态势与知识资产统计
  hub backup [路径]         执行 SQLite 原生 VACUUM INTO 无损原子热备份
  hub export [目录]         将 SQLite 数据库无损导出为结构化 Markdown 目录树 (Obsidian兼容)
  hub path                  打印知识库物理路径与数据库位置
`);
}

switch (command) {
  case 'scan': {
    const limit = parseInt(args[1], 10) || 2;
    console.log(`🔍 开始离线扫描历史已结束（>2小时静默）的 OpenCode 会话...`);
    runOfflineScan(limit);
    break;
  }

  case 'find':
  case 'search': {
    const query = args.slice(1).join(' ');
    if (!query) {
      console.log('请输入搜索关键词，例如: hub find Alpine');
      process.exit(1);
    }
    const results = searchKnowledge(query, { limit: 5 });
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
      console.log('提示: 输入 `hub get <id>` 查看完整正解代码与技术根因 (L2/L3 级)');
    }
    break;
  }

  case 'get': {
    const id = args[1];
    if (!id) {
      console.log('请输入知识卡片 ID，例如: hub get kb-xxxx');
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
    console.log(`\n📊 Memory Hub 研发资产与态势统计:`);
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

  case 'path': {
    console.log(`\nMemory Hub 物理路径配置:`);
    console.log(`  • 根目录:   ${MEMORY_HUB_HOME}`);
    console.log(`  • SQLite库: ${DB_PATH}`);
    console.log(`  • Vault导出: ${VAULT_DIR}`);
    console.log(`  • 归档目录: ${BACKUP_DIR}\n`);
    break;
  }

  default:
    printHelp();
}
