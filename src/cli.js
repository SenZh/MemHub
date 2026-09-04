#!/usr/bin/env node

import { searchKnowledge, getKnowledge, listRecent, getDatabase } from './storage.js';
import { runOfflineScan } from './scanner.js';
import { VAULT_DIR, CATEGORIES } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
ExoBrain CLI - AI 编程知识外脑

用法:
  exo scan [数量]           离线自动扫描最近历史 Session 并自动提炼入库 (默认 2 个)
  exo find <关键词>         全文检索历史避坑经验与架构决策
  exo get <id>              查看某张知识卡片的完整详细内容与代码
  exo list [条数]           查看最近沉淀的知识列表
  exo rebuild               从本地 Markdown 目录一键自愈重建 SQLite 索引
  exo path                  打印知识库物理路径
`);
}

switch (command) {
  case 'scan': {
    const limit = parseInt(args[1], 10) || 2;
    runOfflineScan(limit);
    break;
  }
  case 'find':
  case 'search': {
    const query = args.slice(1).join(' ');
    if (!query) {
      console.log('请输入搜索关键词，例如: exo find Alpine');
      process.exit(1);
    }
    const results = searchKnowledge(query, { limit: 5 });
    if (results.length === 0) {
      console.log(`未找到与 "${query}" 相关的知识。`);
    } else {
      console.log(`\n🔍 找到 ${results.length} 条相关知识:\n`);
      results.forEach((r, idx) => {
        console.log(`${idx + 1}. [${r.id}] \x1b[36m${r.title}\x1b[0m`);
        console.log(`   分类: ${r.category} | 项目: ${r.project || '通用'}`);
        console.log(`   标签: ${r.tags.join(', ')}`);
        if (r.solution_snippet) {
          console.log(`   正解: ${r.solution_snippet.replace(/<\/?b>/g, '')}`);
        }
        console.log('');
      });
      console.log('提示: 输入 `exo get <id>` 查看完整正文及代码');
    }
    break;
  }

  case 'get': {
    const id = args[1];
    if (!id) {
      console.log('请输入知识卡片 ID，例如: exo get kb-xxxx');
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
    console.log(`\n📚 最近沉淀的知识 (共 ${list.length} 条):\n`);
    list.forEach((item, idx) => {
      console.log(`${idx + 1}. [${item.id}] \x1b[36m${item.title}\x1b[0m (项目: ${item.project || '通用'})`);
    });
    console.log('');
    break;
  }

  case 'rebuild': {
    console.log('🔄 正在从 Markdown 文件自愈重建 SQLite 全文索引...');
    const db = getDatabase();
    db.exec(`DELETE FROM knowledge_meta; DELETE FROM knowledge_fts;`);

    let count = 0;
    for (const cat of CATEGORIES) {
      const dir = path.join(VAULT_DIR, cat);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

      for (const file of files) {
        const fullPath = path.join(dir, file);
        const text = fs.readFileSync(fullPath, 'utf-8');
        
        // 简单提取 frontmatter
        const idMatch = text.match(/id:\s*"([^"]+)"/);
        const titleMatch = text.match(/title:\s*"([^"]+)"/);
        const categoryMatch = text.match(/category:\s*"([^"]+)"/);
        const tagsMatch = text.match(/tags:\s*(\[[^\]]*\])/);
        const projectMatch = text.match(/project:\s*"([^"]+)"/);
        const sessionMatch = text.match(/session_id:\s*"([^"]+)"/);

        if (idMatch && titleMatch) {
          const id = idMatch[1];
          const title = titleMatch[1].replace(/\\"/g, '"');
          const category = categoryMatch ? categoryMatch[1] : cat;
          const tags = tagsMatch ? JSON.parse(tagsMatch[1]) : [];
          const project = projectMatch ? projectMatch[1] : '';
          const sessionId = sessionMatch ? sessionMatch[1] : '';

          db.prepare(`
            INSERT INTO knowledge_meta (
              id, title, category, tags, project, file_path, session_id,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
          `).run(id, title, category, JSON.stringify(tags), project, fullPath, sessionId, Date.now(), Date.now());

          db.prepare(`
            INSERT INTO knowledge_fts (id, title, tags, symptom, root_cause, solution)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(id, title, tags.join(' '), '', '', text);

          count++;
        }
      }
    }
    console.log(`✅ 索引重建完成！共索引 ${count} 篇知识卡片。`);
    break;
  }

  case 'path': {
    console.log(`Vault 目录: ${VAULT_DIR}`);
    break;
  }

  default:
    printHelp();
}
