/**
 * data/gen-sample.js
 * 生成 sites.sample.json（云开发控制台「导入」使用的 JSON Lines 格式：一行一条记录）
 *
 * 用法：node data/gen-sample.js
 *
 * 说明：
 * - createTime 用 {"$date": "ISO8601"} 形式，导入后会成为真正的 Date 类型，
 *   这样首页 orderBy('createTime', 'desc') 才能正确排序。
 * - coverUrl 是云存储 fileID（cloud://环境ID.bucket/路径），需要把 __ENV__ 替换成
 *   你自己的环境 ID 并把图片上传到对应路径；没上传也不会白屏，小程序端有
 *   binderror 兜底，会自动降级为「首字母色块」。
 */

const fs = require('fs');
const path = require('path');

// 环境 ID：可用命令行参数覆盖，例如 node data/gen-sample.js cloud1-3gxxxxxxxxxxxxxx
// 默认值与 miniprogram/config.js 里的 ENV_ID 占位符一致
const ENV_ID = process.argv[2] || 'your-env-id';

// bucket 命名规则：<环境ID>.<数字>-<环境ID>-<APPID>
// 下面这串只是占位，真实 fileID 请以「云开发控制台 → 存储 → 文件详情」里复制的为准
const BUCKET = `6763-${ENV_ID}-1300000000`;
const cover = (name) => `cloud://${ENV_ID}.${BUCKET}/covers/${name}`;

// 以 2026-01-01 为基准往前排布，保证导入后顺序稳定
const base = Date.UTC(2026, 0, 1, 2, 0, 0);
const day = 24 * 60 * 60 * 1000;

const sites = [
  {
    name: '极简待办',
    url: 'https://todo.example.com',
    category: '效率工具',
    description:
      '一款只做待办清单的轻量工具，支持自然语言快速录入、按项目分组、每日三件事聚焦视图。没有社交、没有推送轰炸，打开就能写完今天的清单，适合需要极简任务管理的人。',
    cover: 'todo.png'
  },
  {
    name: '配色实验室',
    url: 'https://palette.example.com',
    category: '设计资源',
    description:
      '在线配色方案生成器，可从一张图片提取主色，也能按色相、饱和度、对比度规则自动生成协调色板，并一键导出 CSS 变量、Tailwind 配置与设计稿色值。附带 WCAG 对比度检测。',
    cover: 'palette.png'
  },
  {
    name: '接口速查',
    url: 'https://apidoc.example.com',
    category: '开发技术',
    description:
      '常用 HTTP 状态码、请求头、正则表达式与 MIME 类型的速查手册，所有条目支持关键词搜索，附带可直接复制的示例代码片段，写接口调试时不用再翻文档。',
    cover: 'apidoc.png'
  },
  {
    name: '单词日历',
    url: 'https://words.example.com',
    category: '学习教育',
    description:
      '按天推送一组高频词汇的学习站点，每个词配有例句、词根拆解与常见搭配。学习记录保存在浏览器本地，支持生成复习卡片与间隔重复计划，适合碎片时间背单词。',
    cover: 'words.png'
  },
  {
    name: '长文慢读',
    url: 'https://reader.example.com',
    category: '资讯阅读',
    description:
      '精选深度长文的聚合阅读站，自动去除页面广告与干扰元素，提供纯文本排版、字号调节与夜间模式，还能估算阅读时长、标记段落，把长文读完这件事变得轻松一些。',
    cover: 'reader.png'
  },
  {
    name: '白噪音电台',
    url: 'https://noise.example.com',
    category: '影音娱乐',
    description:
      '可自由叠加环境音的专注白噪音工具，雨声、咖啡馆、壁炉、风声等二十余种音轨可单独调节音量并混音，内置番茄钟计时，支持后台播放，适合在家办公或自习时使用。',
    cover: 'noise.png'
  },
  {
    name: '菜谱小馆',
    url: 'https://recipe.example.com',
    category: '生活服务',
    description:
      '按现有食材反查能做什么菜的家常菜谱站，输入冰箱里剩下的食材即可匹配菜谱，每道菜给出用量、步骤图与火候提示，还能按低卡、少油、快手等标签筛选。',
    cover: 'recipe.png'
  },
  {
    name: '汇率换算台',
    url: 'https://fx.example.com',
    category: '数据查询',
    description:
      '实时汇率查询与货币换算工具，覆盖上百种法定货币与常见贵金属，支持历史汇率走势查看、多币种同时对比，可把常用币种固定成快捷面板，出差旅行前查一眼就够。',
    cover: 'fx.png'
  },
  {
    name: '图标仓库',
    url: 'https://icons.example.com',
    category: '设计资源',
    description:
      '收录上万枚开源矢量图标的检索站，可按线性、面性、双色等风格筛选，支持在线改色、改线宽后导出 SVG 或 PNG，也能整包下载图标集，做界面时找图标不再东拼西凑。',
    cover: 'icons.png'
  },
  {
    name: '正则可视化',
    url: 'https://regex.example.com',
    category: '开发技术',
    description:
      '把正则表达式拆解成铁路图的可视化工具，实时高亮匹配结果与捕获分组，内置手机号、邮箱、身份证、URL 等常用模板，还能对每个片段添加中文注释，写正则不再靠猜。',
    cover: 'regex.png'
  }
];

const lines = sites.map((item, index) => {
  const record = {
    name: item.name,
    url: item.url,
    category: item.category,
    description: item.description,
    coverUrl: cover(item.cover),
    createTime: { $date: new Date(base - index * 3 * day).toISOString() }
  };
  return JSON.stringify(record);
});

const out = path.join(__dirname, 'sites.sample.json');
fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');

// 顺手生成一份「人类可读」的对照表，方便你在控制台里手动新增记录时复制
const pretty = sites.map((item, index) => ({
  name: item.name,
  url: item.url,
  category: item.category,
  description: item.description,
  coverUrl: cover(item.cover),
  createTime: new Date(base - index * 3 * day).toISOString()
}));
fs.writeFileSync(path.join(__dirname, 'sites.sample.pretty.json'), `${JSON.stringify(pretty, null, 2)}\n`, 'utf8');

console.log(`✅ 已生成 ${lines.length} 条示例数据：`);
console.log(`   - ${out}               （控制台导入用，JSON Lines）`);
console.log(`   - ${path.join(__dirname, 'sites.sample.pretty.json')}   （人工阅读用，JSON 数组）`);
