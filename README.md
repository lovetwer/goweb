# goweb · 网站收录导航（微信小程序）

原生小程序框架 + 微信云开发（云数据库直连），**纯只读展示**的网站收录导航工具。
个人主体可上架：全程无登录、无授权弹窗、不获取任何用户信息、不做任何外部网页跳转。

---

## 〇、设计语言：浅色为主 · 白 80% / 黑 5% / 灰 5% / 红 5% / 其他 5%

整体是「编辑排版 / 杂志目录」的路子，**以白为底**：页面、卡片、导航栏、底部操作栏全是纯白，
靠 **2rpx 发丝线 + 大量留白 + 字号层级** 来分层，不用阴影、不用渐变、圆角统一 4rpx。
黑只用在高冲击的小面积元素上，红是唯一的强调色，出现位置固定且克制。

| 配比 | 角色 | 具体用在哪 |
| --- | --- | --- |
| **白 80%** | 画布 | 页面底色 `#ffffff`、卡片、导航栏、底部操作栏、Tab 未选中态、大面积留白、反白文字 |
| **黑 5%** | 重量 | 大标题（66rpx / 58rpx 实心黑 + 描边字）、Tab 选中态（黑底白字）、主按钮「复制网址」、网址卡左侧竖条、卡片按压边框 |
| **灰 5%** | 信息层级 | 正文 `#55554f`、辅助 `#8b8a85`、等宽小字 `#b3b2ad`、发丝线 `#eceae6` / `#dedbd5`、极浅填充块 `#f7f6f4` |
| **红 5%** | 强调 | `#e8231a`，仅下面 7 处，全部是 6~12rpx 的小色块或短暂反馈 |
| **其他 5%** | 内容 | 封面占位色块（中性灰阶 `#efeeec` 等）、骨架屏、用户上传的封面图本身 |

色值表：

| 变量 | 色值 | 用途 |
| --- | --- | --- |
| `--bg` / `--card` / `--white` | `#ffffff` | 页面底色 / 卡片 / 反白文字 |
| `--black` | `#0c0c0c` | 主黑：标题、选中态、主按钮 |
| `--ink` | `#111111` | 正文黑 |
| `--ink-2` | `#55554f` | 次级文字（简介正文） |
| `--ink-3` | `#8b8a85` | 辅助文字 |
| `--ink-4` | `#b3b2ad` | 弱文字 / 等宽小字 / 占位符 |
| `--line` / `--line-2` | `#eceae6` / `#dedbd5` | 发丝线 / 稍重的边框 |
| `--fill` / `--fill-2` | `#f7f6f4` / `#f1efec` | 极浅填充块（简介底、标签底、封面兜底） |
| `--red` / `--red-deep` / `--red-soft` | `#e8231a` / `#c81b13` / `#fdeceb` | 强调色及其深/浅变体 |

红色只出现在这 7 处（WXSS 里都标了 `红 n/7` 注释，便于核对）：

1. `index.wxss` 首页刊头行的实心小圆点（12rpx）；
2. `index.wxss` 首页结果统计前的竖条 mark（6×22rpx）；
3. `detail.wxss` 详情页分类前的小方块（12rpx）；
4. `detail.wxss` 已收藏时大图上书签按钮的红底红书签；
5. `detail.wxss` 已收藏时底部收藏按钮的红边红底；
6. `detail.wxss`「复制网址」成功的瞬时反馈（黑按钮变红 2 秒后恢复）；
7. `favorites.wxss` 收藏页「清空」二字的红字提示（破坏性操作）。

其余一律黑白灰。图标全部 CSS 绘制（放大镜、书签、叉号），**不使用 emoji、不使用图片图标、不引第三方组件库**。
中英文混排：中文用系统黑体，英文 / 数字 / 域名统一走等宽字体（`--mono`），强化「目录 / 索引」的观感。

---

## 一、功能一览

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 首页 | `pages/index/index` | 顶部搜索框 + 分类横向 Tab + 网站卡片列表（封面缩略图 / 名称 / 一句话简介 / 分类标签），支持分类过滤与名称、简介模糊搜索（`db.RegExp`），点卡片 `wx.navigateTo` 进详情 |
| 详情页 | `pages/detail/detail?id=xx` | 云存储大图 + 网站名 + 分类 + 完整简介；「复制网址」按钮（`wx.setClipboardData` + `showToast`）；`onLoad` 按 id 查 `sites`，并用 `wx.setNavigationBarTitle` 把标题设为「网站名 - 领域关键词」 |
| 收藏页 | `pages/favorites/favorites` | 本地收藏列表（`wx.setStorageSync` 读取），支持取消收藏、清空 |

无 `tabBar`，首页 → 详情用 `navigateTo`，首页 → 收藏用 `navigateTo`。

**收藏说明**：需求里只提到「详情页可收藏」，这里额外做了一张极简的收藏列表页方便查看/取消，
数据全部存在手机本地，不联网、不上传。如果你只想要两个页面，删掉
`miniprogram/pages/favorites/` 整个目录、`app.json` 里的那一行页面注册、
以及首页 `index.wxml` 里的 `<view class="fav-entry">…</view>` 和 `index.js` 里的 `onFavEntryTap` 即可，
详情页的收藏功能不受影响。

---

## 二、目录结构

```
goweb/
├── project.config.json          # 项目配置（appid 为占位符，导入时填自己的）
├── project.private.config.json  # 工具本地私有配置（已在 .gitignore 中）
├── sitemap.json                 # 根目录副本：{"rules":[{"action":"allow","page":"*"}]}
├── package.json                 # 便捷脚本（同步 sitemap / 生成示例数据）
├── data/
│   ├── sites.sample.json        # ★ 10 条示例数据，云开发控制台可直接导入（JSON Lines）
│   ├── sites.sample.pretty.json # 同样 10 条，格式化数组，方便手动新增记录时复制
│   └── gen-sample.js            # 示例数据生成脚本
└── miniprogram/                 # 小程序根目录（project.config.json 的 miniprogramRoot）
    ├── app.js                   # 仅做 wx.cloud.init，不采集用户信息
    ├── app.json                 # 页面注册 + window 配置 + sitemapLocation
    ├── app.wxss                 # 全局样式变量与通用类
    ├── config.js                # ★ 唯一配置入口：环境 ID、分类数组、分页大小等
    ├── sitemap.json             # 实际生效的 sitemap（内容与根目录一致）
    ├── utils/
    │   ├── util.js              # 防抖、正则转义、时间格式化、占位色
    │   └── favorites.js         # 本地收藏读写（getStorageSync / setStorageSync）
    └── pages/
        ├── index/               # 首页
        ├── detail/              # 详情页
        └── favorites/           # 收藏页（本地存储）
```

---

## 三、跑起来（5 步）

### 1. 填入你的 AppID

打开 `project.config.json`，把

```json
"appid": "wx0000000000000000"
```

换成你自己的小程序 AppID；或在微信开发者工具「导入项目」时直接填写 AppID（工具会自动写回该文件）。

### 2. 用开发者工具导入

微信开发者工具 → 导入项目 → 目录选择**仓库根目录 `goweb/`**（不是 `miniprogram/`，
因为 `project.config.json` 在根目录，`miniprogramRoot` 已指向 `miniprogram/`）。

### 3. 开通云开发并填写环境 ID

工具栏点「云开发」→ 开通（个人主体可选按量付费的免费额度环境）→ 复制**环境 ID**
（形如 `cloud1-3gxxxxxxxxxxxxxx`），填到 `miniprogram/config.js`：

```js
ENV_ID: 'cloud1-3gxxxxxxxxxxxxxx',
```

> 云开发环境 ID 填错时，首页会直接提示「云环境未配置，请在 config.js 里填写你的 ENV_ID」，不会白屏。

### 4. 建集合、设权限、导数据

1. 云开发控制台 → 数据库 → 新建集合，名字必须是 **`sites`**（与 `config.js` 的 `COLLECTION` 一致）。
2. 选中 `sites` → 权限设置 → 自定义规则或预设里选 **「所有用户可读，仅创建者可写」**（只读展示场景推荐）。
   本项目小程序端直接查询、不写云函数，所以读权限必须对所有用户开放。
3. 集合页 → 导入 → 选择 `data/sites.sample.json` → 冲突处理选 **Insert** → 导入。
   导入后应有 10 条记录，字段为 `name / url / category / description / coverUrl / createTime`。

> `data/sites.sample.json` 是**JSON Lines**（一行一条记录），这正是云开发控制台导入要求的格式。
> `createTime` 用 `{"$date":"2026-01-01T02:00:00.000Z"}` 表示，导入后是真正的 Date 类型，
> 首页的 `orderBy('createTime', 'desc')` 才能正确排序。

集合字段约定：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 网站名称，首页搜索字段之一 |
| `url` | string | 网址，仅用于展示与「复制网址」，**不做任何跳转** |
| `category` | string | 分类，取值必须与 `config.js` 的 `CATEGORIES` 中的某一项完全一致 |
| `description` | string | 简介，首页显示前两行，详情页显示全文；同样是搜索字段 |
| `coverUrl` | string | 封面图，云存储 File ID（`cloud://…`）或 https 图片地址 |
| `createTime` | Date | 收录时间，用于列表倒序 |

### 5. 准备封面图（可选，但建议）

示例数据里的 `coverUrl` 是**占位 File ID**（`cloud://your-env-id.6763-your-env-id-1300000000/covers/xxx.png`），
并不指向真实文件。两种处理方式：

- **推荐**：云开发控制台 → 存储 → 新建 `covers/` 目录 → 上传 10 张图（建议 750×500 左右的横图，png/jpg）
  → 点开文件详情 → 复制 **File ID** → 回到数据库把对应记录的 `coverUrl` 替换掉。
- **偷懒**：什么都不做。图片加载失败时小程序端有 `binderror` 兜底，会自动降级为
  「网站首字母 + 柔和色块」的占位图，界面不会出现破图。

也可以直接用 https 图片地址（`<image>` 组件支持 https，不需要配 downloadFile 合法域名），
但外链图存在失效风险，正式使用建议放云存储。

想批量重新生成示例数据（比如换成你自己的环境 ID）：

```bash
node data/gen-sample.js cloud1-3gxxxxxxxxxxxxxx
```

---

## 四、搜索与过滤是怎么做的

`pages/index/index.js` 的 `buildWhere()`：

```js
const reg = db.RegExp({ regexp: util.escapeRegExp(keyword), options: 'i' });
conditions.push(db.command.or([{ name: reg }, { description: reg }]));
// 分类条件
conditions.push({ category: this.data.activeCategory });
// 两个条件同时存在时用 and 合并
return db.command.and(conditions);
```

- 用户输入先经过 `escapeRegExp` 转义，避免 `.` `*` `(` 之类字符破坏正则或造成异常匹配；
- 输入框有 300ms 防抖（`config.SEARCH_DEBOUNCE`），不会每敲一个字就打一次数据库；
- 分页：`count()` + `skip/limit`，`PAGE_SIZE` 默认 20，触底自动加载，也可点「点击加载更多」；
- 下拉刷新已开启（`index.json` 的 `enablePullDownRefresh`）；
- 卡片左上角的序号、Tab 上的分类编号（`00`/`01`…）都在 `index.js` 里预计算好再下发
  （`tabs`、`site.no`），WXML 模板里不做运算 —— 既省心也更稳。

> 提示：模糊搜索是全表扫描，数据量上千后建议在控制台给 `sites` 加索引
> （`category` 单字段索引、`createTime` 倒序索引），查询会明显变快。

---

## 五、详情页标题

`onLoad` 拿到 id 后 `doc(id).get()`，成功回调里执行：

```js
wx.setNavigationBarTitle({ title: `${site.name} - ${site.category}` });
```

「领域关键词」取站点的 `category`（分类为空时退化为域名主词）；标题超过 30 字符会截断加省略号，
避免导航栏挤压。示例效果：**`正则可视化 - 开发技术`**。

---

## 六、合规自查（个人主体 / 只读展示）

已逐条对照硬性要求实现，并在代码层面做了检查：

- **无登录、无授权、不获取用户信息**：全项目未出现 `wx.login`、`wx.getUserProfile`、`wx.getUserInfo`、
  `wx.authorize`、`wx.getSetting`、`open-type="getPhoneNumber"` 等任何 API；
  `app.json` 的 `permission` 与 `requiredPrivateInfos` 均为空；`wx.cloud.init` 未开启 `traceUser`。
- **无外部网页跳转**：未使用 `web-view` 组件，未出现「点击打开 / 立即前往 / 跳转访问」类文案；
  网址只以纯文本展示，唯一的动作按钮是**「复制网址」**（`wx.setClipboardData` 成功后 `wx.showToast('网址已复制')`）。
  网址区域长按也只是复制。
- **无第三方组件库**：所有页面 `usingComponents` 均为 `{}`，图标（放大镜、五角星）用纯 CSS 绘制，
  样式全部手写 WXSS。
- **sitemap**：`sitemap.json` 内容即 `{ "rules": [{ "action": "allow", "page": "*" }] }`。
  根目录与 `miniprogram/` 下各放了一份（`miniprogramRoot` 指向 `miniprogram/`，实际生效的是后者）。
  修改根目录那份后执行 `npm run sync:sitemap` 可同步。
- **收藏无后端**：仅 `wx.setStorageSync` / `wx.getStorageSync`，key 为 `goweb_favorites`，最多存 200 条。

实际用到的全部 `wx` API：
`wx.cloud`、`wx.setNavigationBarTitle`、`wx.setClipboardData`、`wx.showToast`、`wx.showModal`、
`wx.navigateTo`、`wx.reLaunch`、`wx.pageScrollTo`、`wx.previewImage`、`wx.stopPullDownRefresh`、
`wx.setStorageSync`、`wx.getStorageSync`、`wx.removeStorageSync`。

---

## 七、常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| 首页提示「还没有 sites 集合…」 | 集合名不是 `sites`，或还没导入数据 |
| 首页提示「没有读取权限…」 | 集合权限没设成「所有用户可读」 |
| 首页提示「云环境未配置…」 | `config.js` 的 `ENV_ID` 还是占位符 |
| 封面显示为首字母色块 | `coverUrl` 的 File ID 不属于当前环境 / 文件不存在，按第三节第 5 步替换 |
| 分类 Tab 点了没数据 | 数据库里 `category` 的值和 `config.js` 的 `CATEGORIES` 不一致（注意不要有空格） |
| 列表顺序不对 | `createTime` 导入成了字符串。请用 `data/sites.sample.json`（带 `$date`）导入 |
| 想改分类 | 只改 `miniprogram/config.js` 的 `CATEGORIES` 数组即可，首页 Tab 自动跟随 |
| 想改每页条数 / 防抖 | `config.js` 的 `PAGE_SIZE`、`SEARCH_DEBOUNCE` |

---

## 八、上架前检查清单

1. `project.config.json` 的 `appid` 已换成自己的；
2. `config.js` 的 `ENV_ID` 已填真实环境 ID；
3. `sites` 集合已建、权限为「所有用户可读」、数据已导入；
4. 封面图已上传云存储并回填 `coverUrl`（或接受色块占位）；
5. 真机预览：搜索、分类切换、下拉刷新、触底加载、详情复制网址、收藏与取消收藏都正常；
6. 小程序后台「服务类目」选择与「网站收录/导航」匹配的类目（如 工具 > 信息查询），
   并在版本描述中说明本小程序为只读信息展示、不跳转外部网页。
