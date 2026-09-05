/**
 * utils/util.js —— 通用小工具（无任何网络请求、无任何用户信息获取）
 */

/**
 * 防抖
 * @param {Function} fn 目标函数
 * @param {number} wait 等待毫秒
 * @returns {Function}
 */
function debounce(fn, wait = 300) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  };
}

/**
 * HTML/正则特殊字符转义，避免用户输入破坏 db.RegExp
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 去掉首尾空白
 * @param {string} str
 * @returns {string}
 */
function trim(str) {
  return String(str || '').trim();
}

/**
 * 取名称首字符，用于封面加载失败时的占位块
 * @param {string} name
 * @returns {string}
 */
function firstChar(name) {
  const s = trim(name);
  return s ? s.slice(0, 1).toUpperCase() : 'W';
}

/**
 * 根据名称生成一个稳定的中性底色（封面占位块用）
 * 主题：黑白灰红 —— 这里只输出灰阶，红色留给强调元素
 * @param {string} name
 * @returns {string} 形如 #efeeec
 */
function colorOf(name) {
  const palette = ['#efeeec', '#e9e8e5', '#f3f2f0', '#e4e3e0', '#eceae7', '#e7e6e3'];
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) % 9973;
  }
  return palette[hash % palette.length];
}

/**
 * 占位块上的首字母颜色（深灰，压在浅灰底上）
 * @param {string} name
 * @returns {string}
 */
function inkOf(name) {
  const palette = ['#8e8d8a', '#7c7b78', '#9a9996', '#74736f', '#86857f', '#6e6d69'];
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 37 + s.charCodeAt(i)) % 7919;
  }
  return palette[hash % palette.length];
}

/**
 * 时间格式化（兼容 iOS：把 - 换成 /）
 * @param {Date|string|number} value
 * @param {string} fmt
 * @returns {string}
 */
function formatDate(value, fmt = 'YYYY-MM-DD') {
  if (!value) return '';
  let d;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'number') {
    d = new Date(value);
  } else if (value && value.$date) {
    d = new Date(value.$date);
  } else {
    d = new Date(String(value).replace(/-/g, '/').replace('T', ' ').replace(/\.\d+Z?$/, ''));
  }
  if (isNaN(d.getTime())) return '';

  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  const map = {
    YYYY: d.getFullYear(),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds())
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (k) => map[k]);
}

/**
 * 相对时间：刚刚 / x 分钟前 / x 小时前 / x 天前 / 具体日期
 * @param {Date|string|number} value
 * @returns {string}
 */
function fromNow(value) {
  if (!value) return '';
  let ts;
  if (value instanceof Date) ts = value.getTime();
  else if (typeof value === 'number') ts = value;
  else if (value && value.$date) ts = new Date(value.$date).getTime();
  else ts = new Date(String(value).replace(/-/g, '/')).getTime();

  if (!ts || isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return formatDate(ts, 'YYYY-MM-DD');
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(ts, 'YYYY-MM-DD');
}

module.exports = {
  debounce,
  escapeRegExp,
  trim,
  firstChar,
  colorOf,
  inkOf,
  formatDate,
  fromNow
};
