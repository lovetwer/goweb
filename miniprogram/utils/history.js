/**
 * utils/history.js —— 工具使用记录（wx.setStorageSync，无后端、不采集任何用户信息）
 *
 * 记录「最近用过哪些工具」：打开工具时 push 一条工具快照。
 * 最近用过的排前面，同一条重复使用只保留一条（提到最前），最多 100 条。
 *
 * 存储结构（Storage key = config.HISTORY_KEY）：
 * [
 *   { id, name, desc, icon, image, path, category, usedAt }
 * ]
 */

const config = require('../config.js');

const KEY = config.HISTORY_KEY;
const MAX = 100;

/**
 * 读取全部记录（已按时间倒序）
 * @returns {Array}
 */
function getAll() {
  try {
    const list = wx.getStorageSync(KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveAll(list) {
  try {
    wx.setStorageSync(KEY, Array.isArray(list) ? list.slice(0, MAX) : []);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 记录一次使用（打开工具时调用）
 * @param {Object} tool 工具对象（需含 id、name、desc、icon、path、category）
 */
function push(tool) {
  if (!tool || !tool.id) return false;

  const list = getAll().filter((item) => item && item.id !== tool.id);
  list.unshift({
    id: tool.id,
    name: tool.name || '',
    desc: tool.desc || '',
    icon: tool.icon || '',
    image: tool.image || '',
    path: tool.path || '',
    category: tool.category || '',
    usedAt: Date.now()
  });
  return saveAll(list);
}

function remove(id) {
  const list = getAll();
  const next = list.filter((item) => item && item.id !== id);
  if (next.length === list.length) return false;
  return saveAll(next);
}

function clear() {
  try {
    wx.removeStorageSync(KEY);
    return true;
  } catch (e) {
    return false;
  }
}

function count() {
  return getAll().length;
}

module.exports = { KEY, MAX, getAll, push, remove, clear, count };
