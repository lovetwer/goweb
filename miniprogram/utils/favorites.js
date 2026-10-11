/**
 * utils/favorites.js —— 本地收藏（wx.setStorageSync，无任何后端、无任何用户信息）
 *
 * 收藏对象是「工具」（utils/tools.js 注册表里的条目），存的是工具快照：
 * 即使将来某个工具下架，收藏里仍能看到名字（点开时按 id 反查注册表，
 * 查不到就提示已下架）。
 *
 * 存储结构（Storage key = config.FAVORITES_KEY）：
 * [
 *   {
 *     id: '工具 id',
 *     name: '工具名',
 *     desc: '一句话简介',
 *     icon: '图标字符',
 *     image: '本地功能插画路径（可选）',
 *     path: '/pages/xxx/xxx',
 *     category: '分类 key',
 *     addedAt: 1717200000000
 *   }
 * ]
 * 新收藏的排前面，最多保留 200 条。
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
 * 切换收藏状态
 * @param {Object} tool 工具对象（需含 id、name、desc、icon、path、category）
 * @returns {boolean} 切换后是否为「已收藏」
 */
function toggle(tool) {
  if (!tool || !tool.id) return false;

  const list = getAll();
  const index = list.findIndex((item) => item && item.id === tool.id);

  if (index > -1) {
    list.splice(index, 1);
    saveAll(list);
    return false;
  }

  list.unshift({
    id: tool.id,
    name: tool.name || '',
    desc: tool.desc || '',
    icon: tool.icon || '',
    image: tool.image || '',
    path: tool.path || '',
    category: tool.category || '',
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
  toggle,
  remove,
  clear,
  count
};
