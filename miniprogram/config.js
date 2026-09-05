/**
 * config.js —— 全局唯一配置入口
 *
 * 导入项目后只需要改两个地方：
 * 1. ENV_ID：换成你自己的云开发环境 ID（云开发控制台首页可查，形如 cloud1-3gxxxxxxxxxxxxxx）
 * 2. CATEGORIES：分类写死在这里，首页横向 Tab 直接读取，改这里即可增删分类
 */

module.exports = {
  // ⚠️ 必填：你的云开发环境 ID
  ENV_ID: 'your-env-id',

  // 云存储 bucket 说明（仅示例数据 data/sites.sample.json 里的 coverUrl 会用到）
  // 真实 fileID 形如：cloud://<环境ID>.<数字>-<环境ID>-<APPID>/covers/xxx.png
  // 请在「云开发控制台 → 存储 → 点开文件 → 复制 File ID」获取，再回填到数据库记录里
  STORAGE_BUCKET: '6763-your-env-id-1300000000',

  // 数据库集合名
  COLLECTION: 'sites',

  // 分类：写死的数组，首页 Tab 与详情页标签共用
  CATEGORIES: [
    '效率工具',
    '设计资源',
    '开发技术',
    '学习教育',
    '资讯阅读',
    '影音娱乐',
    '生活服务',
    '数据查询'
  ],

  // 首页每页条数
  PAGE_SIZE: 20,

  // 搜索输入防抖（毫秒）
  SEARCH_DEBOUNCE: 300,

  // 本地收藏存储 key
  FAVORITES_KEY: 'goweb_favorites',

  // 详情页标题格式：网站名 - 领域关键词
  DETAIL_TITLE_SEP: ' - '
};
