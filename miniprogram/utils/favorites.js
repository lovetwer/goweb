/**
 * utils/favorites.js —— 本地收藏（wx.setStorageSync，无任何后端、无任何用户信息）
 *
 * 存储结构（Storage key = config.FAVORITES_KEY）：
 * [
 *   {
 *     id: '站点 _id',
 *     name: '站点名',
 *     url: 'https://...',
 *     category: '效率工具',
 *     description: '一句话简介',
 *     coverUrl: 'cloud://...',
 *     addedAt: 1717200000000
 *   }
 * ]
 * 新的排在前面，最多保留 200 条。
 */

const config = require('../config.js');

const KEY = config.FAVORITES_KEY;
const MAX = 200;

/**
 * 读取全部收藏
 * @returns {Array}
 */
function getAll() {
  try {
    const list = wx.getStorageSync(KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[favorites] 读取失败', e);
    return [];
  }
}

/**
 * 写入全部收藏
 * @param {Array} list
 * @returns {boolean}
 */
function saveAll(list) {
  try {
    wx.setStorageSync(KEY, Array.isArray(list) ? list.slice(0, MAX) : []);
    return true;
  } catch (e) {
    console.warn('[favorites] 写入失败', e);
    return false;
  }
}

/**
 * 是否已收藏
 * @param {string} id
 * @returns {boolean}
 */
function has(id) {
  if (!id) return false;
  return getAll().some((item) => item && item.id === id);
}

/**
 * 批量判断是否已收藏
 * @param {Array<string>} ids
 * @returns {Object} { id: true/false }
 */
function hasMany(ids) {
  const set = {};
  getAll().forEach((item) => {
    if (item && item.id) set[item.id] = true;
  });
  const result = {};
  (ids || []).forEach((id) => {
    result[id] = !!set[id];
  });
  return result;
}

/**
 * 切换收藏状态
 * @param {Object} site 站点对象（需含 _id/id、name、url、category、description、coverUrl）
 * @returns {boolean} 切换后是否为「已收藏」
 */
function toggle(site) {
  if (!site) return false;
  const id = site._id || site.id;
  if (!id) return false;

  const list = getAll();
  const index = list.findIndex((item) => item && item.id === id);

  if (index > -1) {
    list.splice(index, 1);
    saveAll(list);
    return false;
  }

  list.unshift({
    id,
    name: site.name || '',
    url: site.url || '',
    category: site.category || '',
    description: site.description || '',
    coverUrl: site.coverUrl || '',
    addedAt: Date.now()
  });
  saveAll(list);
  return true;
}

/**
 * 移除单条
 * @param {string} id
 * @returns {boolean}
 */
function remove(id) {
  const list = getAll();
  const next = list.filter((item) => item && item.id !== id);
  if (next.length === list.length) return false;
  return saveAll(next);
}

/**
 * 清空全部收藏
 * @returns {boolean}
 */
function clear() {
  try {
    wx.removeStorageSync(KEY);
    return true;
  } catch (e) {
    console.warn('[favorites] 清空失败', e);
    return false;
  }
}

/**
 * 收藏数量
 * @returns {number}
 */
function count() {
  return getAll().length;
}

module.exports = {
  KEY,
  MAX,
  getAll,
  saveAll,
  has,
  hasMany,
  toggle,
  remove,
  clear,
  count
};
