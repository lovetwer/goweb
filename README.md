# 工具箱（微信小程序）

原生小程序框架 + 微信云开发。**实用工具箱**：各类小工具内置在小程序包里本地运行，
首页按分类分区展示，支持本地搜索、收藏与使用记录。

个人主体可上架：无授权弹窗、不获取昵称头像手机号、不做任何外部网页跳转、不收集联系方式。
云能力只保留两条链路：**意见反馈**（云函数校验入库）与**会员体系**（虚拟支付）。

> 由「工具大全（网站导航）」改造而来。原网站导航模块（sites 集合、详情页、精选、公告）
> 已移除；会员与反馈体系原样保留。改造前的完整代码备份在
> `D:/Project/goweb_backup_20261011_093105/`。

---

## 一、架构总览

```
goweb/
├── project.config.json          # 项目配置（miniprogramRoot → miniprogram/）
├── cloudfunctions/
│   ├── feedback/                # 意见反馈：非空校验 + 内容安全（msgSecCheck v2）
│   └── vip/                     # 会员：下单签名 / 查会员 / 兜底查单
├── scripts/                     # 本地运维工具（db.mjs 的 vip:* 命令仍用于会员套餐管理）
└── miniprogram/
    ├── app.js                   # wx.cloud.init + getDB()（仅供会员页读套餐价格）
    ├── app.json                 # 页面注册（无 tabBar）
    ├── app.wxss                 # 全局样式变量（★ 换肤只改这里）
    ├── config.js                # 环境 ID、反馈配置、会员配置、本地存储 key
    ├── utils/
    │   ├── tools.js             # ★ 工具注册表（唯一数据源，新增工具只改这里）
    │   ├── favorites.js         # 本地收藏（工具快照，storage）
    │   ├── history.js           # 使用记录（工具快照，storage）
    │   ├── util.js              # 防抖、时间格式化、图标兜底色
    │   └── vip.js               # 会员状态 / 支付环境校验 / 查单
    └── pages/
        ├── index/               # 首页：最近使用 + 分类分区 + 工具卡片网格 + 本地搜索
        ├── favorites/           # 收藏页（本地存储）
        ├── history/             # 使用记录（本地存储）
        ├── vip/                 # 会员中心（套餐 + 支付 + 权益说明）
        ├── agreement/           # 隐私政策与使用协议
        └── feedback/            # 意见反馈（云函数）
```

## 二、如何新增一个工具（核心流程）

工具箱的数据源是 `miniprogram/utils/tools.js`，页面代码只面向注册表接口，
不直接碰原始数组。

1. 在 `miniprogram/pages/` 下建工具页面四件套（`js/json/wxml/wxss`）；
2. 在 `app.json` 的 `pages` 里注册该页面；
3. 在 `tools.js` 的 `TOOLS` 数组里加一条记录：

```js
{
  id: 'unit-converter',          // 唯一标识（收藏/历史用它，定好不要再改）
  name: '单位换算',
  desc: '长度、重量、温度等常用单位一键换算',
  category: 'calc',              // 取自 CATEGORIES 的 key
  icon: '换',                    // 图片缺省时用名称首字兜底
  image: '../../assets/illustrations/unit-converter.png', // 可选：功能插画
  path: '/pages/unit-converter/unit-converter',
  keywords: ['unit', '长度'],    // 可选，额外搜索词
  vipOnly: false                 // 可选，true = 会员专属工具
}
```

首页分区、本地搜索、最近使用、收藏、历史全部自动生效，不需要改任何页面代码。

### 分类

`CATEGORIES` 目前定义 4 类（可增删）：计算换算 `calc` / 文本处理 `text` /
日期时间 `datetime` / 生活查询 `life`，每个分类带 `color`（强调色）与
`soft`（浅底色）用于工具图标。分类下没有工具时不会出现在首页。

### 会员专属工具

工具记录加 `vipOnly: true` 即标记为会员专属。首页对非会员只显示工具名与
「会员」标记，具体放行策略等工具上架后在详情/页面层实现（当前注册表为空，
放行逻辑尚未接入，接入位置：首页 `onToolTap` 与各工具页 onLoad）。

## 三、当前状态

- **已上线工具：颜值分析**（`beauty-scan`，生活查询类）——第一个需要云函数的工具，部署步骤见第六节；
- 收藏 / 历史已切换到工具维度（新 storage key：`toolbox_favorites` /
  `toolbox_history`），旧网站的收藏数据不再读取；
- 会员体系（`pages/vip`、云函数 `vip`、`utils/vip.js`）原样保留，
  权益文案已改为工具箱语境；
- 意见反馈链路未改动（`pages/feedback` + 云函数 `feedback`，需在
  云开发控制台保持 `feedback` 集合「仅管理端可读写」）；
- 协议页文案已更新为工具箱表述（含颜值分析的摄像头 / 相册 / 人脸信息声明）。

## 四、设计语言

采用清新甜系的「小小日常手帐」视觉：奶白底色 `#fffaf5`、蜜桃主色 `#ee9d8a`，搭配奶桃、香草黄与马卡龙紫；顶部标题区收短，让工具内容更早进入视野。全局色值集中在 `miniprogram/app.wxss` 的 `page{}` 变量中。
首页、颜值分析全流程、收藏、历史、会员与反馈等页面均以原生 WXML / WXSS 重新编排版式，并配套本地功能插画（`miniprogram/assets/illustrations/`），无需远程图片请求；插画的 SVG 源文件保存在 `scripts/artwork-src/`。仍为原生微信小程序，无第三方组件库。

## 五、会员功能

会员（虚拟支付）体系与改造前完全一致：`config.js` 的 `VIP_ENABLED` 控制开关，
部署步骤、支付链路、排查手册见备份目录中旧版 README 第十节，或直接看
`cloudfunctions/vip/` 与 `scripts/db.mjs` 的 `vip:*` 命令。

---

## 六、颜值分析工具（云函数 + 腾讯云人脸识别）

娱乐向颜值参考工具。照片链路：前端压缩归一化 → 上传云存储临时目录 →
云函数调腾讯云「人脸检测与分析」DetectFace → 规则生成综合分（70~95 区间）与评语 →
**finally 里删除云文件**。照片不落库、不留存、不提取人脸特征；结果仅供娱乐参考。

### 页面

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 工具首页 | `pages/beauty/beauty` | 功能介绍 + 隐私承诺卡（可展开）+ 开始按钮 |
| 分析页 | `pages/beauty-analyze/beauty-analyze` | 拍照/相册选图 → OffscreenCanvas 归一化（EXIF 方向校正 + 最长边 720px + JPEG）→ 上传 → 调云函数 |
| 结果页 | `pages/beauty-result/beauty-result` | 综合分 + 年龄/性别/脸型 + 清晰度/协调度维度条 + 气质评语 + 免责声明 |

### 字段映射（腾讯云 DetectFace → 展示结果）

| 腾讯云字段 | 用途 |
| --- | --- |
| `FaceAttributesInfo.Beauty`（0~100） | 颜值基础分（权重 80%） |
| `FaceAttributesInfo.Age` | 年龄感 |
| `FaceAttributesInfo.Gender`（0女/1男） | 性别 + 气质文案分支 |
| `FaceQualityInfo.Score`（0~100） | 面部清晰度（权重 10%） |
| `FaceInfos[].Width/Height` 宽高比 | 脸型娱乐向估算（≥1.18 瓜子脸 / ≤0.94 圆脸 / 其余鹅蛋脸） |

> 腾讯云 DetectFace 不返回脸型，脸型由人脸框宽高比估算（纯娱乐向）；
> 协调度按脸型固定映射（82~92），权重 10%。

### 部署步骤

1. **开通腾讯云人脸识别**：<https://console.cloud.tencent.com/aiface> →
   同意《人脸识别服务规则》即开通（免费，个人实名认证即可）。
   **每月自动发放 1 万次免费额度**，超出后 0.0005 元/次（另有 10 万次 19.9 元的新用户资源包）。
   ⚠️ 别进「人脸核身（慧眼）」（`/faceid`）——那是另一个产品，需要**企业**实名认证，
   本工具用不到它；认准「人脸识别」控制台（`/aiface`）；
2. **创建密钥**：访问管理 CAM → API 密钥管理
   （<https://console.cloud.tencent.com/cam/capi>）→ 新建密钥，
   拿到 **SecretId** 与 **SecretKey**（建议用子账号，只授权 `QcloudFaceIDAccess`）；
3. **配置密钥**：复制 `cloudfunctions/beauty/secret.example.json` 为
   `secret.json`，填入两个密钥（或配置云函数环境变量
   `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`；secret.json 优先）；
4. **部署云函数**：开发者工具左侧 `cloudfunctions/beauty` 右键 →
   「上传并部署：云端安装依赖」（`config.json` 已设 60s 超时）；
5. **隐私声明**：mp 后台「设置 → 服务内容声明 → 用户隐私保护指引」勾选
   **摄像头**（拍摄照片进行颜值分析）、**相册**（选择照片进行颜值分析）、
   **用户填写的信息**，并如实说明照片会传输至腾讯云人脸识别接口完成当次分析、
   分析后立即删除；
6. **类目**：工具 → 图片处理；版本描述中说明：娱乐向工具，照片分析后立即删除，
   不做身份认证，不调用人脸核身接口；
7. 真机走全流程：选图 → 分析 → 结果 → 云开发控制台「存储」里确认
   `beauty-tmp/` 目录无残留文件。

### 异常处理对照

| 情况 | 腾讯云错误码 | 用户看到 |
| --- | --- | --- |
| 未检测到人脸 | `FailedOperation.NoFaceInPhoto` | 「未检测到人脸，请上传清晰的正面照片」 |
| 人脸识别失败 | `FailedOperation.ImageFacedetectFailed` | 同上 |
| 图片解码失败 | `FailedOperation.ImageDecodeFailed` 等 | 「照片读取失败，请换一张重新试试」 |
| 限额 / 限流 | `LimitExceeded` / `RequestLimitExceeded` | 「分析服务繁忙，请稍后再试」 |
| 密钥错误 | `AuthFailure.*` | 「分析服务还没配置好，请稍后再试」（云函数控制台有日志） |
| 网络 / 超时 | — | 「网络异常，请稍后重试」 |
| 任何情况 | — | 云函数 finally 中删除云存储临时文件，照片零残留 |
