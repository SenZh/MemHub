/**
 * 极简标准 Cron 表达式解析与匹配引擎（零依赖）
 *
 * 支持标准 5 段式：分 时 日 月 周
 *   - 星号      任意值
 *   - 星号斜杠n 每 n 个单位（如每 5 分钟）
 *   - a-b       区间（可叠加步长 a-b/n）
 *   - a,b,c     列表
 *   - 单值      精确匹配
 *
 * 字段取值范围：
 *   分 0-59 | 时 0-23 | 日 1-31 | 月 1-12 | 周 0-6 (0=周日)
 *
 * 日与周为 "OR" 语义（二者任一命中即触发），与 Vixie cron 保持一致。
 * 若同时限制日与周（都非星号），只要其一命中即触发。
 */

const FIELD_RANGES = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dayOfWeek', min: 0, max: 6 }
];

/**
 * 解析单个 cron 字段为去重升序的数值数组
 * @param {string} field 原始字段
 * @param {{min:number,max:number,name:string}} range 取值范围
 * @returns {number[]}
 */
function parseField(field, range) {
  const { min, max, name } = range;
  const values = new Set();
  const segments = String(field).split(',');

  for (const rawSeg of segments) {
    const seg = rawSeg.trim();
    if (!seg) continue;

    // 拆出步长（形如 */n 或 a-b/n 或 a/n）
    let step = 1;
    let body = seg;
    const slash = seg.indexOf('/');
    if (slash >= 0) {
      body = seg.slice(0, slash);
      const stepStr = seg.slice(slash + 1);
      step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`cron 字段 "${name}" 步长非法: ${seg}`);
      }
    }

    let lo;
    let hi;
    if (body === '*') {
      lo = min;
      hi = max;
    } else if (body.includes('-')) {
      const [a, b] = body.split('-');
      lo = parseInt(a, 10);
      hi = parseInt(b, 10);
      if (isNaN(lo) || isNaN(hi)) {
        throw new Error(`cron 字段 "${name}" 区间非法: ${seg}`);
      }
    } else {
      lo = parseInt(body, 10);
      hi = lo;
      if (isNaN(lo)) {
        throw new Error(`cron 字段 "${name}" 数值非法: ${seg}`);
      }
    }

    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron 字段 "${name}" 越界: ${seg} (合法范围 ${min}-${max})`);
    }

    for (let v = lo; v <= hi; v += step) {
      values.add(v);
    }
  }

  return Array.from(values).sort((a, b) => a - b);
}

/**
 * 编译 cron 表达式，返回可复用的匹配器对象
 * @param {string} expr 5 段式 cron 表达式
 * @returns {{match:(date:Date)=>boolean, expr:string, fields:Object}}
 * @throws {Error} 表达式非法时抛出
 */
export function compileCron(expr) {
  if (!expr || typeof expr !== 'string') {
    throw new Error('cron 表达式不能为空');
  }
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron 表达式必须为 5 段（分 时 日 月 周），实际 ${parts.length} 段: "${expr}"`);
  }

  const [minF, hourF, domF, monthF, dowF] = parts;
  const fields = {
    minute: parseField(minF, FIELD_RANGES[0]),
    hour: parseField(hourF, FIELD_RANGES[1]),
    dayOfMonth: parseField(domF, FIELD_RANGES[2]),
    month: parseField(monthF, FIELD_RANGES[3]),
    dayOfWeek: parseField(dowF, FIELD_RANGES[4])
  };

  const domRestricted = domF.trim() !== '*';
  const dowRestricted = dowF.trim() !== '*';

  const minuteSet = new Set(fields.minute);
  const hourSet = new Set(fields.hour);
  const domSet = new Set(fields.dayOfMonth);
  const monthSet = new Set(fields.month);
  const dowSet = new Set(fields.dayOfWeek);

  function match(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return false;
    if (!minuteSet.has(date.getMinutes())) return false;
    if (!hourSet.has(date.getHours())) return false;
    if (!monthSet.has(date.getMonth() + 1)) return false;

    const domHit = domSet.has(date.getDate());
    const dowHit = dowSet.has(date.getDay());

    // 日与周均为 * 时都算命中；仅其一受限时用该字段；两者都受限时取 OR
    if (domRestricted && dowRestricted) return domHit || dowHit;
    if (domRestricted) return domHit;
    if (dowRestricted) return dowHit;
    return true;
  }

  return { match, expr: expr.trim(), fields };
}

/**
 * 快捷判断：给定表达式与时刻是否命中
 * @param {string} expr
 * @param {Date} [date]
 * @returns {boolean}
 */
export function cronMatches(expr, date = new Date()) {
  return compileCron(expr).match(date);
}
