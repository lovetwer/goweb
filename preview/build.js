/**
 * preview/build.js —— 把小程序页面「静态渲染」成 HTML，用于在浏览器里快速看设计效果。
 *
 * ⚠️ 这只是设计预览工具，不参与小程序运行、不会被打包上传：
 *    - 直接读取真实的 miniprogram/pages/*.wxml 与 *.wxss（样式 1:1）
 *    - 用假的内存数据代替云数据库（mockDB），不发起任何网络请求
 *    - rpx 按 1rpx = 0.5px（375pt 设计宽度）换算
 *
 * 用法：node preview/build.js     → 生成 preview/index.html
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const PREVIEW = __dirname;

/* ------------------------------------------------------------------ */
/* 假数据（与 data/sites.sample.json 同源，封面走本地占位，不联网）      */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  '效率工具',
  '设计资源',
  '开发技术',
  '学习教育',
  '资讯阅读',
  '影音娱乐',
  '生活服务',
  '数据查询'
];

const SITES = [
  {
    _id: 's1',
    name: '极简待办',
    url: 'https://todo.example.com',
    category: '效率工具',
    description:
      '一款只做待办清单的轻量工具，支持自然语言快速录入、按项目分组、每日三件事聚焦视图。没有社交、没有推送轰炸，打开就能写完今天的清单。',
    coverUrl: '',
    createTime: '2026-01-01T02:00:00.000Z'
  },
  {
    _id: 's2',
    name: '配色实验室',
    url: 'https://palette.example.com',
    category: '设计资源',
    description:
      '在线配色方案生成器，可从一张图片提取主色，也能按色相、饱和度、对比度规则自动生成协调色板，并一键导出 CSS 变量与设计稿色值。附带 WCAG 对比度检测。',
    coverUrl: '',
    createTime: '2025-12-29T02:00:00.000Z'
  },
  {
    _id: 's3',
    name: '接口速查',
    url: 'https://apidoc.example.com',
    category: '开发技术',
    description:
      '常用 HTTP 状态码、请求头、正则表达式与 MIME 类型的速查手册，所有条目支持关键词搜索，附带可直接复制的示例代码片段。',
    coverUrl: '',
    createTime: '2025-12-26T02:00:00.000Z'
  },
  {
    _id: 's4',
    name: '单词日历',
    url: 'https://words.example.com',
    category: '学习教育',
    description:
      '按天推送一组高频词汇的学习站点，每个词配有例句、词根拆解与常见搭配。学习记录保存在浏览器本地，支持生成复习卡片与间隔重复计划。',
    coverUrl: '',
    createTime: '2025-12-23T02:00:00.000Z'
  },
  {
    _id: 's5',
    name: '长文慢读',
    url: 'https://reader.example.com',
    category: '资讯阅读',
    description:
      '精选深度长文的聚合阅读站，自动去除页面广告与干扰元素，提供纯文本排版、字号调节与夜间模式，还能估算阅读时长、标记段落。',
    coverUrl: '',
    createTime: '2025-12-20T02:00:00.000Z'
  },
  {
    _id: 's6',
    name: '白噪音电台',
    url: 'https://noise.example.com',
    category: '影音娱乐',
    description:
      '可自由叠加环境音的专注白噪音工具，雨声、咖啡馆、壁炉、风声等二十余种音轨可单独调节音量并混音，内置番茄钟计时。',
    coverUrl: '',
    createTime: '2025-12-17T02:00:00.000Z'
  }
];

const util = require(path.join(MP, 'utils/util.js'));

const decoratedSites = SITES.map((raw) => ({
  _id: raw._id,
  name: raw.name,
  url: raw.url,
  category: raw.category,
  description: raw.description,
  coverUrl: raw.coverUrl,
  createTime: raw.createTime,
  timeText: util.fromNow(raw.createTime),
  initial: util.firstChar(raw.name),
  bgColor: util.colorOf(raw.name),
  inkColor: util.inkOf(raw.name),
  hostText: String(raw.url).replace(/^https?:\/\//, ''),
  hasCover: !!raw.coverUrl,
  addedText: '3 天前'
}));

const detailSite = Object.assign({}, decoratedSites[1], {
  timeText: '2025-12-29'
});

const tabs = CATEGORIES.map((name, i) => ({ name, no: i < 9 ? `0${i + 1}` : `${i + 1}` }));
const numberedSites = decoratedSites.map((it, i) =>
  Object.assign({}, it, { no: i < 9 ? `0${i + 1}` : `${i + 1}` })
);

const PAGES = {
  index: {
    title: '网站收录导航',
    navStyle: 'light',
    data: {
      categories: CATEGORIES,
      tabs,
      tabCount: CATEGORIES.length + 1,
      activeIndex: 0,
      activeCategory: '',
      keyword: '',
      searchFocus: false,
      sites: numberedSites,
      page: 1,
      hasMore: true,
      loading: false,
      loadingMore: false,
      firstLoaded: true,
      errorText: '',
      totalText: '共 10 个网站',
      favCount: 3
    }
  },
  detail: {
    title: '配色实验室 - 设计资源',
    navStyle: 'dark',
    data: {
      id: 's2',
      site: detailSite,
      loading: false,
      errorText: '',
      isFavorite: true,
      coverFailed: true,
      copied: false
    }
  },
  favorites: {
    title: '我的收藏',
    navStyle: 'light',
    data: {
      list: numberedSites.slice(0, 3),
      loading: false,
      count: 3,
      countText: '03'
    }
  }
};

/* ------------------------------------------------------------------ */
/* 极简 WXML 渲染器（只为预览：支持 wx:if / wx:elif / wx:else / wx:for） */
/* ------------------------------------------------------------------ */

const VOID_TAGS = new Set(['image', 'input', 'icon']);
const TAG_MAP = {
  view: 'div',
  text: 'span',
  block: 'block',
  'scroll-view': 'div',
  image: 'img',
  input: 'input'
};
const BLOCK_CLASS = {
  'scroll-view': 'sv',
  block: 'blk'
};

const RESERVED = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'Math',
  'Date',
  'JSON',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object'
]);

/**
 * 把 WXML 表达式转成可执行的 JS 表达式：
 * - 字符串字面量原样保留
 * - 属性名（前面有 "."）原样保留
 * - item / index 原样保留（由 with(ctx) 从循环上下文取）
 * - 其余裸标识符加 ctx. 前缀
 */
function transformExpr(rawExpr) {
  // 还原 tokenizer 阶段为绕过标签边界而转义的 < >
  const expr = String(rawExpr).replace(/\u0002/g, '<').replace(/\u0003/g, '>');
  let out = '';
  let prev = '';
  const re = /('[^']*')|("[^"]*")|([A-Za-z_$][\w$]*)|([\s\S])/g;
  let m;
  while ((m = re.exec(expr))) {
    if (m[1] || m[2]) {
      out += m[0];
    } else if (m[3]) {
      const id = m[3];
      if (prev === '.' || RESERVED.has(id) || id === 'item' || id === 'index') out += id;
      else out += `ctx.${id}`;
    } else {
      out += m[4];
    }
    prev = m[0].slice(-1);
  }
  return out;
}

/** 把指令里的 "{{expr}}" 还原成 expr */
function unwrapMustache(v) {
  const m = String(v == null ? '' : v).trim().match(/^\{\{([\s\S]*)\}\}$/);
  return m ? m[1] : String(v == null ? '' : v);
}

function makeEval(expr) {
  const js = transformExpr(expr);
  // eslint-disable-next-line no-new-func
  return new Function('ctx', `with (ctx) { try { return (${js}); } catch (e) { return undefined; } }`);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 手写属性解析器：正确处理值里带空格与 {{ }} 的情况 */
function parseAttrs(str, attrs) {
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /\s/.test(str[i])) i += 1;
    let name = '';
    while (i < str.length && /[\w:.-]/.test(str[i])) {
      name += str[i];
      i += 1;
    }
    if (!name) {
      i += 1;
      continue;
    }
    while (i < str.length && /\s/.test(str[i])) i += 1;
    if (str[i] !== '=') {
      attrs[name] = '';
      continue;
    }
    i += 1;
    while (i < str.length && /\s/.test(str[i])) i += 1;
    const quote = str[i];
    if (quote !== '"' && quote !== "'") {
      let v = '';
      while (i < str.length && !/\s/.test(str[i])) {
        v += str[i];
        i += 1;
      }
      attrs[name] = v;
      continue;
    }
    i += 1;
    let v = '';
    while (i < str.length && str[i] !== quote) {
      v += str[i];
      i += 1;
    }
    i += 1;
    attrs[name] = v;
  }
}

function tokenize(wxml) {
  const src = wxml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{[^{}]*\}\}/g, (m) => m.replace(/</g, '\u0002').replace(/>/g, '\u0003'));
  const tokens = [];
  // 标签属性里允许出现 ">" 以外的任意字符（含引号包裹的 {{ }}），自闭合的 "/" 归到属性组末尾
  // 属性段里的 {{ ... }} 作为整体匹配，避免表达式里的 < > 被当成标签边界
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\{\{[^}]*\}\}|[^>"]|"[^"]*")*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) {
      const text = m[4];
      if (text.trim()) tokens.push({ type: 'text', value: text });
      continue;
    }
    const close = m[1];
    const tag = m[2];
    let attrStr = m[3] || '';
    let self = '';
    const selfMatch = attrStr.match(/\/(\s*)$/);
    if (selfMatch) {
      self = '/';
      attrStr = attrStr.slice(0, attrStr.length - selfMatch[0].length);
    }
    const attrs = {};
    parseAttrs(attrStr || '', attrs);
    if (close) tokens.push({ type: 'close', tag });
    else tokens.push({ type: 'open', tag, attrs, self: self === '/' || VOID_TAGS.has(tag) });
  }
  return tokens;
}

/** 把 token 流组装成树，并处理 wx:if / elif /else 链与 wx:for */
function buildTree(tokens) {
  const root = { children: [] };
  const stack = [root];

  tokens.forEach((tk) => {
    const top = stack[stack.length - 1];

    if (tk.type === 'close') {
      if (stack.length > 1) stack.pop();
      return;
    }

    if (tk.type === 'text') {
      top.children.push({ type: 'text', value: tk.value });
      return;
    }

    const node = { type: 'el', tag: tk.tag, attrs: tk.attrs, children: [] };

    if (tk.attrs['wx:for']) {
      const loop = { type: 'loop', listExpr: unwrapMustache(tk.attrs['wx:for']), node };
      top.children.push(loop);
      if (!tk.self) stack.push(node);
      // loop 节点不需要闭合，元素自己闭合即可
      return;
    }

    if (tk.attrs['wx:if']) {
      const branch = { type: 'branch', cases: [{ expr: unwrapMustache(tk.attrs['wx:if']), node }] };
      top.children.push(branch);
      branch.__owner = true;
      if (!tk.self) {
        stack.push(node);
        node.__branch = branch;
      }
      return;
    }

    if (tk.attrs['wx:elif'] || tk.attrs['wx:else'] !== undefined) {
      // 找到最近的、还在同层的 branch
      const siblings = top.children;
      let branch = null;
      for (let i = siblings.length - 1; i >= 0; i -= 1) {
        if (siblings[i].type === 'branch') {
          branch = siblings[i];
          break;
        }
        if (siblings[i].type === 'text') continue;
        break;
      }
      if (branch) {
        branch.cases.push({
          expr: tk.attrs['wx:elif'] ? unwrapMustache(tk.attrs['wx:elif']) : null,
          node
        });
        if (!tk.self) {
          stack.push(node);
          node.__branch = branch;
        }
        return;
      }
    }

    top.children.push(node);
    if (!tk.self) stack.push(node);
  });

  return root;
}

function renderTree(node, ctx) {
  if (node.type === 'text') {
    const v = node.value.replace(/\{\{([\s\S]*?)\}\}/g, (m, expr) => {
      const r = makeEval(expr)(ctx);
      return r === undefined || r === null ? '' : String(r);
    });
    return escapeHtml(v).replace(/\n\s*\n/g, '\n');
  }

  if (node.type === 'loop') {
    const list = makeEval(node.listExpr)(ctx);
    if (!list || typeof list[Symbol.iterator] !== 'function') return '';
    return Array.from(list)
      .map((it, i) => renderTree(node.node, Object.assign({}, ctx, { item: it, index: i })))
      .join('');
  }

  if (node.type === 'branch') {
    for (const c of node.cases) {
      if (!c.expr) return renderTree(c.node, ctx);
      const v = makeEval(c.expr)(ctx);
      if (v) return renderTree(c.node, ctx);
    }
    return '';
  }

  const attrs = Object.assign({}, node.attrs);
  // 计算 class / style 里的插值
  ['class', 'style'].forEach((k) => {
    if (attrs[k] && /\{\{/.test(attrs[k])) {
      attrs[k] = attrs[k].replace(/\{\{([\s\S]*?)\}\}/g, (m, expr) => {
        const r = makeEval(expr)(ctx);
        return r === undefined || r === null || r === false ? '' : String(r);
      });
    }
  });

  const tag = TAG_MAP[node.tag] || node.tag;
  const extra = BLOCK_CLASS[node.tag] ? ` ${BLOCK_CLASS[node.tag]}` : '';
  const cls = attrs.class ? `${attrs.class}${extra}` : extra.trim();
  const styleAttr = attrs.style ? ` style="${escapeHtml(attrs.style)}"` : '';

  const clsAttr = cls ? ` class="${escapeHtml(cls)}"` : '';
  const isSkeleton = /\bskeleton\b/.test(cls);

  if (tag === 'img') {
    if (isSkeleton) return `<div${clsAttr}${styleAttr}></div>`;
    const src = (attrs.src || '').replace(/\{\{([\s\S]*?)\}\}/g, (m, expr) => {
      const r = makeEval(expr)(ctx);
      return r || '';
    });
    return `<div${clsAttr ? clsAttr : ' class="img-ph"'}${styleAttr}><span class="img-ph-text">${escapeHtml(
      src ? 'COVER' : 'NO COVER'
    )}</span></div>`;
  }

  if (tag === 'input') {
    const ph = attrs.placeholder || '';
    return `<div${clsAttr}${styleAttr}><span class="input-ph">${escapeHtml(ph)}</span></div>`;
  }

  const inner = node.children.map((c) => renderTree(c, ctx)).join('');
  if (tag === 'block') return inner;
  return `<${tag}${clsAttr}${styleAttr}>${inner}</${tag}>`;
}

/* ------------------------------------------------------------------ */
/* WXSS → CSS：去掉注释、补 :root 变量、rpx 换算                        */
/* ------------------------------------------------------------------ */

function pageVarsToRoot(css) {
  return css.replace(/(^|\n)\s*page\s*\{/, '\n:root, .phone {');
}

function rpxToPx(css) {
  return css.replace(/(-?\d*\.?\d+)rpx/g, (m, n) => `${(parseFloat(n) / 2).toFixed(3).replace(/\.?0+$/, '')}px`);
}

function buildCss(page) {
  const app = fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8');
  const pageCss = fs.readFileSync(path.join(MP, 'pages', page, `${page}.wxss`), 'utf8');
  let css = `${app}\n${pageCss}`;
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  css = pageVarsToRoot(css);
  css = rpxToPx(css);
  return css;
}

/* ------------------------------------------------------------------ */
/* 组装 HTML                                                            */
/* ------------------------------------------------------------------ */

const PREVIEW_CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 40px 24px 80px;
  background: #dddcd8;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
}
.wrap { max-width: 1180px; margin: 0 auto; }
.head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 28px; }
.head h1 { margin: 0; font-size: 22px; letter-spacing: 1px; color: #111; }
.head p { margin: 6px 0 0; font-size: 13px; color: #6b6a66; }
.switch { display: flex; gap: 8px; }
.switch a {
  padding: 8px 18px; font-size: 13px; text-decoration: none; color: #333;
  border: 1px solid #c6c5c0; border-radius: 999px; background: #f4f3f0;
}
.switch a.on { background: #0c0c0c; color: #fff; border-color: #0c0c0c; }
.phones { display: flex; gap: 28px; flex-wrap: wrap; justify-content: center; }
.device { width: 375px; }
.device-label { font-size: 12px; letter-spacing: 2px; color: #6b6a66; margin-bottom: 10px; font-family: Menlo, Consolas, monospace; }
.phone {
  width: 375px; height: 760px; overflow: hidden auto; background: #f2f1ef;
  border: 10px solid #111; border-radius: 34px; box-shadow: 0 18px 50px rgba(0,0,0,.22);
  position: relative;
}
.nav {
  height: 44px; display: flex; align-items: center; justify-content: center; position: relative;
  font-size: 15px; font-weight: 600; letter-spacing: .5px;
}
.nav.light { background: #f2f1ef; color: #111; }
.nav.dark { background: #0c0c0c; color: #fff; }
.nav .back { position: absolute; left: 14px; font-size: 18px; font-weight: 400; opacity: .6; }
.nav .dots { position: absolute; right: 12px; width: 52px; height: 22px; border: 1px solid rgba(120,120,120,.45); border-radius: 11px; }
/* 预览专用：WXML 里的结构性标签 */
blk { display: block; }
.sv { overflow-x: auto; }
.img-ph { display: flex; align-items: center; justify-content: center; background: repeating-linear-gradient(45deg,#e7e6e3,#e7e6e3 6px,#f0efec 6px,#f0efec 12px); }
.img-ph-text { font-family: Menlo, Consolas, monospace; font-size: 9px; letter-spacing: 2px; color: #a9a8a3; }
.input-ph { flex: 1; display: flex; align-items: center; color: #a9a8a3; font-size: 13.5px; min-width: 0; }
.note { max-width: 720px; margin: 34px auto 0; padding: 20px 24px; background: #f4f3f0; border: 1px solid #d6d5d0; border-radius: 6px; font-size: 13px; line-height: 1.9; color: #55544f; }
.note b { color: #111; }
.note code { font-family: Menlo, Consolas, monospace; background: #e7e6e3; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
`;

function renderPage(key) {
  const conf = PAGES[key];
  const wxml = fs.readFileSync(path.join(MP, 'pages', key, `${key}.wxml`), 'utf8');
  const tree = buildTree(tokenize(wxml));
  const body = tree.children.map((n) => renderTree(n, conf.data)).join('');
  const css = buildCss(key);
  const nav = `<div class="nav ${conf.navStyle}">${key === 'index' ? '' : '<span class="back">‹</span>'}<span>${escapeHtml(conf.title)}</span><span class="dots"></span></div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(conf.title)} · 设计预览</title>
<style>${PREVIEW_CSS}</style>
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <div>
      <h1>网站收录导航 · 设计预览</h1>
      <p>黑白灰 95% + 红 5% · 由真实 WXML / WXSS 静态渲染，数据为本地假数据，不联网</p>
    </div>
    <div class="switch">
      <a href="./preview.html">三屏总览</a>
      ${Object.keys(PAGES)
        .map(
          (k) =>
            `<a class="${k === key ? 'on' : ''}" href="./${k}.html">${
              { index: '首页', detail: '详情页', favorites: '收藏页' }[k]
            }</a>`
        )
        .join('')}
    </div>
  </div>

  <div class="phones">
    <div class="device">
      <div class="device-label">${key.toUpperCase()} / 375 × 760</div>
      <div class="phone">${nav}${body}</div>
    </div>
  </div>

  <div class="note">
    <b>说明：</b>此页面是 <code>preview/build.js</code> 用仓库里真实的
    <code>miniprogram/pages/${key}/${key}.wxml</code> 与 <code>.wxss</code> 渲染出来的设计快照，
    仅供在浏览器里看效果；小程序运行时不涉及此目录（已在 <code>project.config.json</code> 的
    <code>packOptions.ignore</code> 中排除）。<br />
    <b>预览与真机的差异：</b>① 云存储封面图未加载，统一显示为斜纹占位块（真机上会显示你上传的大图，
    加载失败时降级为首字母色块）；② 交互（搜索、切分类、复制、收藏）在预览里是静态的；
    ③ <code>rpx</code> 按 1rpx = 0.5px 换算。
  </div>
</div>
</body>
</html>
`;
}

Object.keys(PAGES).forEach((key) => {
  const out = path.join(PREVIEW, `${key}.html`);
  fs.writeFileSync(out, renderPage(key), 'utf8');
  console.log(`✅ ${out}`);
});
