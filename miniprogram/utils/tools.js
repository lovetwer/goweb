/**
 * utils/tools.js —— 工具注册表（工具箱的唯一数据源）
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 新增一个工具只需要两步：                                       │
 * │   1. 在 pages/ 下建好工具页面（四件套 js/json/wxml/wxss）；     │
 * │   2. 在下面的 TOOLS 数组里注册一条记录。                        │
 * │ 首页分区、搜索、收藏、历史全部自动生效，不需要改任何页面代码。      │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 工具全部内置在代码包里，纯本地运行：无网络请求、无数据库、无用户信息。
 */

/**
 * 工具分类
 * key    分类标识（TOOLS 里 category 字段的取值）
 * name   分类中文名（首页分区标题）
 * en     分区英文刊头（装饰用）
 * color  分类强调色（图标前景 / 分区标记，低饱和暖调）
 * soft   分类浅底色（图标底 / 工具卡点缀）
 */
const CATEGORIES = [
  { key: 'calc', name: '计算换算', en: 'CALC', color: '#b84827', soft: '#f8e3d9' },
  { key: 'text', name: '文本处理', en: 'TEXT', color: '#a8762a', soft: '#f5ead6' },
  { key: 'datetime', name: '日期时间', en: 'DATE', color: '#6b7f3f', soft: '#eaefdd' },
  { key: 'life', name: '生活查询', en: 'LIFE', color: '#4f6d8c', soft: '#e2ebf3' }
];

/**
 * 工具清单 —— 当前为空，等工具定下来后在这里注册。
 *
 * 每条记录的字段约定：
 *   id        string  唯一标识（收藏 / 历史用它做 key，定好不要再改）
 *   name      string  工具名（搜索字段）
 *   desc      string  一句话简介（首页卡片展示 + 搜索字段）
 *   category  string  分类 key，必须取自上面的 CATEGORIES
 *   icon      string  图标字符（首页 / 收藏 / 历史卡片上直接渲染；
 *                     留空则用名称首字兜底）
 *   path      string  工具页面路径，如 '/pages/calc/calc'
 *   keywords  array   可选，额外搜索词（别名 / 英文名 / 场景词）
 *   vipOnly   boolean 可选，true = 会员专属工具（缺省 = 公开）
 */
const TOOLS = [
  {
    id: 'beauty-scan',
    name: '颜值分析',
    desc: '上传一张照片，AI 给出娱乐向颜值参考分',
    category: 'life',
    icon: '颜',
    path: '/pages/beauty/beauty',
    keywords: ['颜值', '打分', '照片', '人脸', 'beauty', '相貌', '长相']
    // vipOnly: false
  }
  // 示例（注册时照这个格式写，然后删掉本注释块上方的示例行）：
  // {
  //   id: 'unit-converter',
  //   name: '单位换算',
  //   desc: '长度、重量、温度等常用单位一键换算',
  //   category: 'calc',
  //   icon: '换',
  //   path: '/pages/unit-converter/unit-converter',
  //   keywords: ['unit', '长度', '重量']
  //   vipOnly: false
  // }
];

/* ---------------------------------------------------------------- */
/* 以下为注册表的查询接口，页面代码只面向这些函数，不直接碰原始数组      */
/* ---------------------------------------------------------------- */

/** 全部分类（含无工具的分类，首页渲染时会过滤） */
function getCategories() {
  return CATEGORIES.slice();
}

/** 按 key 取分类定义，取不到返回 null */
function getCategory(key) {
  return CATEGORIES.find((c) => c && c.key === key) || null;
}

/** 全部工具（TOOLS 的浅拷贝，调用方改动不会污染注册表） */
function getAllTools() {
  return TOOLS.map((t) => Object.assign({}, t));
}

/** 工具总数 */
function count() {
  return TOOLS.length;
}

/** 按 id 取单个工具（含分类信息补全），取不到返回 null */
function getTool(id) {
  const raw = TOOLS.find((t) => t && t.id === id);
  if (!raw) return null;
  return decorate(raw);
}

/** 按分类取工具列表（已装饰） */
function getToolsByCategory(key) {
  return TOOLS.filter((t) => t && t.category === key).map((t) => decorate(t));
}

/**
 * 首页分区数据：[{ category(分类对象), tools(已装饰) }]
 * 只有分类下有工具才会出现在结果里；全部为空时返回 []，
 * 首页据此显示「工具上架中」空状态。
 */
function getSections() {
  return CATEGORIES.map((cat) => ({
    category: Object.assign({}, cat),
    tools: getToolsByCategory(cat.key)
  })).filter((sec) => sec.tools.length > 0);
}

/**
 * 本地搜索：匹配 name / desc / keywords / 分类名，不分页（内置工具总量有限）。
 * @param {string} keyword
 * @returns {Array} 已装饰的工具列表
 */
function searchTools(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return [];
  return TOOLS.filter((t) => {
    if (!t) return false;
    const cat = getCategory(t.category);
    const haystack = [
      t.name,
      t.desc,
      cat ? cat.name : '',
      Array.isArray(t.keywords) ? t.keywords.join(' ') : ''
    ]
      .join(' ')
      .toLowerCase();
    return haystack.indexOf(kw) > -1;
  }).map((t) => decorate(t));
}

/**
 * 给工具补全渲染所需字段：
 *   categoryName 分类中文名 / color·soft 分类色 / initial 图标兜底字符
 */
function decorate(tool) {
  const raw = tool || {};
  const cat = getCategory(raw.category);
  return {
    id: raw.id || '',
    name: raw.name || '未命名工具',
    desc: raw.desc || '',
    category: raw.category || '',
    categoryName: cat ? cat.name : '未分类',
    color: cat ? cat.color : '#8b8279',
    soft: cat ? cat.soft : '#f5f0e8',
    icon: raw.icon || '',
    initial: raw.icon || (raw.name || '工').slice(0, 1),
    path: raw.path || '',
    keywords: Array.isArray(raw.keywords) ? raw.keywords.slice() : [],
    vipOnly: raw.vipOnly === true
  };
}

module.exports = {
  CATEGORIES,
  TOOLS,
  getCategories,
  getCategory,
  getAllTools,
  count,
  getTool,
  getToolsByCategory,
  getSections,
  searchTools,
  decorate
};
