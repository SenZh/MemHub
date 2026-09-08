import path from 'node:path';

/**
 * 轻量级安全路径过滤引擎
 * 支持 Windows/POSIX 归一化、安全 Glob 编译、特殊字符防注入、根目录监听与黑白名单优先级
 */
export class PathFilter {
  constructor(rules = {}) {
    const r = rules || {}; // 防御 null 入参
    this.watchDirectories = Array.isArray(r.watchDirectories)
      ? r.watchDirectories.map(d => this._normalizePath(d)).filter(Boolean)
      : [];

    this.excludeRegexes = Array.isArray(r.exclude)
      ? r.exclude.map(p => this._globToRegex(p)).filter(Boolean)
      : [];

    this.includeRegexes = Array.isArray(r.include)
      ? r.include.map(p => this._globToRegex(p)).filter(Boolean)
      : [];
  }

  /**
   * 路径标准化：转 POSIX 正斜杠、去除末尾斜杠、Windows 环境转小写
   */
  _normalizePath(p) {
    if (!p || typeof p !== 'string') return '';
    let normalized = p.trim().replace(/\\/g, '/');
    if (normalized === '/') return '/'; // 保护 Unix 根路径
    normalized = normalized.replace(/\/+$/, '');
    if (process.platform === 'win32') {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  }

  /**
   * 安全 Glob 编译为正则表达式
   * 彻底解决：
   * 1. 正则特殊字符转义
   * 2. ** 与 * 的分步替换防踩踏
   * 3. 末尾 /** 能同时匹配目录自身与子目录
   * 4. 边界锚定防前缀误杀（如 tmp 不误伤 tmp-data）
   */
  _globToRegex(globPattern) {
    if (!globPattern || typeof globPattern !== 'string') return null;

    let p = globPattern.trim().replace(/\\/g, '/');
    if (process.platform === 'win32') {
      p = p.toLowerCase();
    }

    // 检查末尾是否为 /**
    const endsWithDoubleStar = p.endsWith('/**');
    if (endsWithDoubleStar) {
      p = p.slice(0, -3); // 剥离末尾 /**，后续用边界保护接管
    }

    // 1. 转义正则特殊字符（排除 * 和 ?）
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // 2. 使用安全占位符分步替换，杜绝 ** 与 * 的相互踩踏
    const withPlaceholder = escaped.replace(/\*\*/g, '__GLOB_STAR_STAR__');
    const withSingleStar = withPlaceholder.replace(/\*/g, '[^/]*');
    const withQuestionMark = withSingleStar.replace(/\?/g, '[^/]');
    const bodyPattern = withQuestionMark.replace(/__GLOB_STAR_STAR__/g, '.*');

    // 3. 构建首尾锚定：
    // 前缀：若为根绝对路径则以 ^ 锚定，否则匹配路径边界 (^|/)
    const prefix = (p.startsWith('/') || /^[a-z]:/i.test(p)) ? '^' : '(^|/)';

    // 尾部：
    // 若原模式以 /** 结尾，则既匹配该目录本身，也匹配其任意子路径：(?:\/.*)?$
    // 否则严格匹配路径末尾或斜杠边界：(?:\/.*)?$
    const suffix = endsWithDoubleStar ? '(?:\/.*)?$' : '(?:$|\/)';

    const regexStr = `${prefix}${bodyPattern}${suffix}`;

    try {
      return new RegExp(regexStr, 'i');
    } catch (err) {
      console.warn(`[PathFilter] 无法解析路径规则: "${globPattern}", 错误: ${err.message}`);
      return null;
    }
  }

  /**
   * 判断目标目录是否符合规则
   */
  isMatch(targetDir) {
    if (!targetDir || typeof targetDir !== 'string') {
      return false; // 空路径安全排除
    }

    const normTarget = this._normalizePath(targetDir);
    if (!normTarget) return false;

    // 1. 关卡一：watchDirectories 根目录限制
    if (this.watchDirectories.length > 0) {
      const inWatch = this.watchDirectories.some(root => {
        if (root === '/') return true;
        return normTarget === root || normTarget.startsWith(root + '/');
      });
      if (!inWatch) {
        return false; // 不在监听根目录下，拦截
      }
    }

    // 2. 关卡二：exclude 黑名单（最高优先级）
    if (this.excludeRegexes.length > 0) {
      const isExcluded = this.excludeRegexes.some(re => re.test(normTarget));
      if (isExcluded) {
        return false; // 命中黑名单，拦截
      }
    }

    // 3. 关卡三：include 白名单
    if (this.includeRegexes.length > 0) {
      return this.includeRegexes.some(re => re.test(normTarget));
    }

    // 若未配置 include，默认放行
    return true;
  }

  /**
   * 语义别名：等同于 isMatch(targetDir)
   */
  isAllowed(targetDir) {
    return this.isMatch(targetDir);
  }
}
