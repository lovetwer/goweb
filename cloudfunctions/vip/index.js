/**
 * cloudfunctions/vip —— 会员开通（虚拟支付 · 道具直购）
 *
 * ============================ 安全红线 ============================
 * AppKey（现网支付密钥）和 sessionKey（用户会话密钥）**只能存在云函数里**。
 * 任何一处泄漏都等于「任何人可以伪造支付请求 / 冒用用户身份」，所以：
 *   1. 它们不写进任何前端文件、不写进 config.js、不进 Git 仓库；
 *   2. 放在云函数根目录的 secret.json（已被 .gitignore 忽略）；
 *   3. 前端拿到的只有 signData / paySig / signature 三个字符串，
 *      全部是针对这一次订单的签名，用完即弃。
 * ==================================================================
 *
 * 八个 action：
 *   createOrder  前端点购买 → 生成 outTradeNo + 双签名 → 返回 payData 给前端拉起支付
 *   queryMember  前端查自己的会员状态（前端 success 回调不可信，以此为准）
 *   verifyOrder  兜底查单：推送丢失时主动调 query_order 确认并补发权益
 *   readSite     读单条站点详情 —— **会员专属内容的唯一入口**（非会员只给开头40 字）
 *   listSites    首页列表分页查询（非会员时 vipOnly 条目剥掉 url / 封面 / 简介全文）
 *   listPicks    今日精选（同上，picks 关联的 sites 在服务端剥离后再下发）
 *   queryOrders  我的凭证：查自己已支付订单的双单号（对账 / 自证用）
 *
 * ⚠️ 为什么会员内容必须走云函数而不是客户端直查：
 *   sites 集合权限是「所有用户可读」（首页列表需要），所以客户端
 *   db.collection('sites').doc(id).get() 是绕不过的 —— 抓包或用开发者工具
 *   就能直接读到 vipOnly:true 记录的全文。前端「不显示」只是障眼法。
 *   把读取收到云函数、服务端按 openid 判定后才决定返回哪些字段，
 *   才算真正拦住。
 *
 * sites 集合新增字段（vipOnly 可选，缺省 = false = 公开）：
 *   vipOnly    boolean  true = 仅会员可见完整内容
 *   detailDesc string   会员专属的详细介绍（可选，长文放这里）
 *
 * 发货另有「消息推送」入口（xpay_goods_deliver_notify），
 * 走 MP 后台配置的消息推送 URL，由腾讯云开发 Skills 部署，
 * 不在本文件内（那个URL 指向的是平台侧配置的接收服务，不是 wx.cloud.callFunction）。
 *
 * 官方文档：
 * https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html
 */

const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/* ============================ 集合名 ============================ */
const COLL_PLANS = 'vip_plans'; // 套餐配置（可被管理后台读写）
const COLL_ORDERS = 'vip_orders'; // 订单（唯一可信的支付凭据）
const COLL_MEMBERS = 'vip_members'; // 会员状态（由订单推导出来）

/* ============================ 密钥 ============================ */
/**
 * 从云函数根目录的 secret.json 读取。
 * 文件结构：{ "offerId": "...", "appKeyProd": "...", "appKeySandbox": "..." }
 * 部署时新建（已 gitignore）：
 *   {
 *     "offerId": "虚拟支付 → 基本配置 → OfferID",
 *     "appKeyProd": "虚拟支付 → 基本配置 → 现网AppKey",
 *     "appKeySandbox": "虚拟支付 → 基本配置 → 沙箱AppKey",
 *     "appSecret": "MP 后台 → 开发管理 → 开发设置 → AppSecret"
 *   }
 *
 * 为什么AppSecret 也放在这里而不是云函数环境变量：
 * 环境变量需要在控制台单独配一遍，漏配时code2Session 会静默失败（报 openid 获取失败），
 * 排查成本高。放在同一个文件里，四项密钥一处管理、一处校验，
 * 少一个「以为配了其实没配」的场景。注意本文件已被 .gitignore 忽略。
 */
let SECRET = null;
function loadSecret() {
  if (SECRET) return SECRET;
  try {
    // eslint-disable-next-line global-require
    SECRET = require('./secret.json');
  } catch (e) {
    SECRET = null;
  }
  return SECRET;
}

/** 缺配置时立刻失败，不要带着空密钥继续跑 */
function requireSecret() {
  const s = loadSecret();
  const missing = [];
  if (!s || !s.offerId) missing.push('offerId');
  if (!s || !s.appSecret) missing.push('appSecret');
  if (!s || !pickAppKey(s)) missing.push(isSandbox(s) ? 'appKeySandbox' : 'appKeyProd');
  if (missing.length) {
    const err = new Error('VIP_NOT_CONFIGURED');
    err.code = -100;
    err.missing = missing;
    throw err;
  }
  return s;
}

/**
 * 沙箱开关：secret.json 里 "sandbox": true 即切到沙箱。
 *
 * ⚠️ 官方限制：iOS **不支持沙箱**，只能在现网真扣钱测（-15011 就是填了 env:1 被拒）。
 * 所以沙箱只用于 Android 联调。切回去务必记得把 "sandbox" 删掉或改成 false，
 * 否则会在沙箱环境下单、用户付款到沙箱，钱收不到。
 *
 * 另有一条官方硬规则：**现网 AppKey 只能配 env=0，沙箱 AppKey 只能配 env=1**。
 * 两个 Key 弄反了会报 -15006 paySig 错误。这里按同一个开关联动取值，
 * 省掉「env 改了、Key 忘了换」这类组合错误。
 */
function isSandbox(s) {
  return !!(s && s.sandbox === true);
}

function pickAppKey(s) {
  if (!s) return '';
  return isSandbox(s) ? s.appKeySandbox || s.appKeyProd : s.appKeyProd;
}

/** env：0 现网 / 1 沙箱（必须与使用的 AppKey 配套） */
function envOf(s) {
  return isSandbox(s) ? 1 : 0;
}

/* ============================ 签名 ============================ */
/**
 * 支付签名 paySig = hex(hmac_sha256(appKey, uri + '&' + postBody))
 *
 * ⚠️ 三个容易踩的坑：
 *   1. uri 不带问号参数；C 端下单固定为字符串 'requestVirtualPayment'（无斜杠），
 *      B 端服务端接口才带斜杠（如 '/xpay/query_order'）。
 *   2. postBody 必须与「真正发出去的那串字符」逐字节一致 ——
 *      不能 JSON.stringify 两次、不能格式化、不能改键顺序。
 *      本文件所有签名都先构造 const body = JSON.stringify(obj)，
 *      再用同一个 body 去签名和发请求，杜绝二次序列化。
 *   3. appKey 按 env 取：env=0 现网，env=1 沙箱。
 */
function calcPaySig(uri, postBody, appKey) {
  return crypto
    .createHmac('sha256', appKey)
    .update(`${uri}&${postBody}`, 'utf8')
    .digest('hex');
}

/**
 * 用户态签名 signature = hex(hmac_sha256(sessionKey, postBody))
 * sessionKey 由 code2Session 换取，只能存在服务端。
 */
function calcSignature(postBody, sessionKey) {
  return crypto
    .createHmac('sha256', sessionKey)
    .update(postBody, 'utf8')
    .digest('hex');
}

/**
 * 发起 HTTPS GET 并解析 JSON。
 *
 * ⚠️ 为什么不用 cloud.http.request：
 *   wx-server-sdk 并没有 `http` 这个 API（它只提供 database / openapi /
 *   callFunction / uploadFile 等）。写了会报
 *   「Cannot read properties of undefined (reading 'request')」。
 *   云函数跑在 Node.js 上，直接用内置 https 模块最稳、零额外依赖。
 *
 * 微信的错误码放在响应体里（HTTP 200 + errcode），所以这里不做状态码判断，
 * 由调用方检查 errcode。
 */
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let raw = '';
      res.on('data', (c) => {
        raw += c;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`响应不是合法 JSON（status ${res.statusCode}）：${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求微信接口超时（8s）'));
    });
    req.on('error', (e) => reject(new Error(`请求微信接口失败：${e.message}`)));
  });
}

/**
 * 发起 HTTPS POST（JSON body）并解析 JSON。
 * 用途：调用 /xpay/query_order、/xpay/notify_provide_goods 这类服务端接口。
 *
 * @param {string} url 完整 URL（需自带 access_token / pay_sig 查询参数）
 * @param {object} body 会被 JSON.stringify —— 签名用的必须是**同一份字符串**
 */
function httpPostJson(url, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const u = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 10000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`响应不是合法 JSON（status ${res.statusCode}）：${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求微信接口超时（10s）'));
    });
    req.on('error', (e) => reject(new Error(`请求微信接口失败：${e.message}`)));
    req.write(payload);
    req.end();
  });
}

/**
 * 用 code 换 sessionKey（服务端调用 code2Session）。
 * 官方要求：sessionKey 用于用户态签名，不能由前端自行保管。
 *
 * openid 不从这里取 —— 云开发的 getWXContext() 已经给了可信 openid，
 * 这里的返回值只用来拿 session_key。
 */
async function code2Session(code, appSecret) {
  const appid = cloud.getWXContext().APPID;
  const qs = querystring.stringify({
    appid: appid,
    secret: appSecret,
    js_code: code,
    grant_type: 'authorization_code',
  });
  const data = await httpGetJson(`https://api.weixin.qq.com/sns/jscode2session?${qs}`);

  if (!data || !data.session_key) {
    const code2 = data && data.errcode;
    const err = new Error(`code2session failed errcode=${code2} errmsg=${(data && data.errmsg) || '未知'}`);
    // 40029 invalid code / 40163 code been used → code 无效或已用过，可提示用户重试
    err.code = code2 === 40029 || code2 === 40163 ? -15 : -16;
    err.wechatCode = code2;
    throw err;
  }
  return data;
}

/* ============================ 工具 ============================ */

/**
 * 生成业务单号 outTradeNo。
 * 官方要求：8-32 位、唯一、不能以下划线开头。
 * 这里用 vip + 毫秒时间戳(base36) + 6 位随机，共约 20 位。
 */
function genTradeNo() {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e6).toString(36).padStart(6, '0');
  return `vip${t}${r}`;
}

/** 支付成功 → 权益到期时间。月/年按自然月推进，不是「从现在起30 天」。
 *
 *  月末溢出必须 clamp：JS 的 setMonth 遇到「目标月没有这一天」会直接
 *  溢出到下个月（1/31 + 1 月 = 3/2 或 3/3），比行业惯例「收到目标月
 *  最后一天」（应为 2/28 或 2/29）多给一到两天。写法：先记下原「日」，
 *  把日归 1 再推进月份（避免溢出干扰月份进位），最后 min(原日, 月末)。
 *  年费同理处理 2/29 → 次年 2/28。
 */
function calcExpireAt(planId, from) {
  const base = from || Date.now();
  const d = new Date(base);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + (planId === 'vip_year' ? 12 : 1));
  // 目标月最后一天：new Date(y, m + 1, 0) 即「下月第 0 天」= 本月月末
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.getTime();
}

/** 统一返回体 */
function ok(data) {
  return { code: 0, msg: 'ok', data: data || null };
}
function fail(code, msg, extra) {
  return Object.assign({ code: code, msg: msg }, extra || {});
}

/* ============================================================ 主入口 */

exports.main = async (event) => {
  const action = (event && event.action) || '';
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;

  // 云函数必须能拿到调用者 openid：它既是会员判定的唯一依据，
  // 也是订单归属的依据。拿不到说明环境异常，直接报清楚。
  if (!openid) {
    return fail(-1, '无法识别用户身份', {
      debug: { action: action, hasAppId: !!wxCtx.APPID, env: cloud.DYNAMIC_CURRENT_ENV },
    });
  }

  try {
    if (action === 'createOrder') return await createOrder(openid, event);
    if (action === 'queryMember') return await queryMember(openid);
    if (action === 'verifyOrder') return await verifyOrder(openid, event);
    if (action === 'readSite') return await readSite(openid, event);
    if (action === 'listSites') return await listSites(openid, event);
    if (action === 'listPicks') return await listPicks(openid);
    if (action === 'queryOrders') return await queryOrders(openid);
    if (action === 'diag') return await diag(openid, event);
    return fail(-3, '未知操作', { debug: { received: action } });
  } catch (e) {
    // ① 部署没做完：secret.json 缺项。这类必须明确报出来，
    //    否则用户只会看到「服务异常」，无法定位。
    if (e && e.message === 'VIP_NOT_CONFIGURED') {
      return fail(-100, '支付尚未配置完成，请联系开发者', {
        debug: { missing: e.missing || [] },
      });
    }

    // ② code2Session 失败：分两种给用户看
    if (e && e.code === -15) {
      return fail(-15, '登录凭证已失效，请返回重试', {
        debug: { msg: e.message, wechatCode: e.wechatCode },
      });
    }
    if (e && e.code === -16) {
      // 40125 = AppSecret 无效/已被重置，40013 = appid 不对 → 都是服务端配置问题
      return fail(-16, '服务暂时不可用，请稍后重试', {
        debug: { msg: e.message, wechatCode: e.wechatCode, hint: '检查 secret.json 的 appSecret 与小程序 AppID 是否匹配' },
      });
    }

    // ③ 套餐不存在（collection vip_plans 为空，或 actve 全false）
    if (e && e.code === -10) {
      return fail(-10, e.message || '套餐不存在', { debug: { planId: event && event.planId } });
    }
    // ④ 兜底：把真实错误带出去，否则用户只看到「服务异常」无法排查。
    //    云函数 HTTP 请求失败时 message 常是 "request:fail" 这类笼统描述，
    //    所以额外带上 body / statusCode —— 真正的线索通常在里面。
    return fail(-99, '服务异常，请稍后重试', {
      debug: {
        msg: (e && e.message) || String(e),
        body: e && e.errMsg,
        statusCode: e && e.statusCode,
        errno: e && e.errno,
        stack: e && e.stack ? String(e.stack).split('\n').slice(0, 4).join(' | ') : '',
      },
    });
  }
};

/* ---------------------------------------------------------------- */
/* 诊断：一次性把「密钥 / 数据库 / 签名」三环都测一遍                    */
/* ---------------------------------------------------------------- */
/**
 * 【仅开发期使用，不影响生产逻辑】
 *
 * 支付链路有三环，任一环坏了前端都只显示「服务异常」，无从下手。
 * 这个 action 把每一环单独测一遍并回报结果，定位问题不用真付钱。
 *
 * 安全考量：只回报「有没有 / 长度 / 前后各 2 位」，绝不把密钥原文吐出去；
 * 且不调用任何会产生订单的接口。
 */
async function diag(openid, event) {
  const report = { checks: [] };
  const add = (name, ok, detail) => report.checks.push({ name, ok: !!ok, detail: detail || '' });

  // ① 密钥文件
  const secret = loadSecret();
  if (!secret) {
    add('secret.json 读取', false, '文件不存在或无法读取（部署时没带上去？）');
  } else {
    add('secret.json 读取', true, '文件已加载');
    ['offerId', 'appKeyProd', 'appKeySandbox', 'appSecret'].forEach((k) => {
      const v = secret[k];
      add(`密钥 ${k}`, !!v, v ? `已填写（${String(v).length} 字符）` : '★ 空');
    });
  }

  // ② 数据库可读 + 套餐存在（最容易出错的一环：集合没建 / 权限不对 / 没 seed）
  try {
    const r = await db.collection(COLL_PLANS).where({ active: true }).limit(10).get();
    const rows = (r && r.data) || [];
    add('读 vip_plans 集合', true, `读到 ${rows.length} 个在售套餐`);
    rows.forEach((p) =>
      add(
        `  套餐 ${p.planId}`,
        !!p.productId && Number(p.price) > 0,
        `${(Number(p.price) / 100).toFixed(2)} 元，道具 ${p.productId}（必须与 MP 后台一致）`
      )
    );
    if (!rows.length) add('  ⚠️套餐数据', false, '集合为空：请跑 node scripts/db.mjs vip:seed');
  } catch (e) {
    add('读 vip_plans 集合', false, `★ ${e.errMsg || e.message}（集合不存在或云函数无权限）`);
  }

  // ②b 当前运行环境（现网/沙箱）—— 排查 -15011 / -15006 必看
  add(
    '运行环境 env',
    true,
    isSandbox(secret)
      ? '★ 沙箱（env=1，用 appKeySandbox）。iOS 不支持沙箱，且下单不会真扣钱；上线前务必改回'
      : '现网（env=0，用 appKeyProd）'
  );

  // ③ code2Session：拿本次的 code 试一次
  const code = (event && event.code) || '';
  if (!code) {
    add('code2Session', null, '未传 code，跳过（前端需先 wx.login）');
  } else if (!secret || !secret.appSecret) {
    add('code2Session', null, '缺 appSecret，跳过');
  } else {
    try {
      const s = await code2Session(code, secret.appSecret);
      add('code2Session', true, `✓ 换到 session_key（${String(s.session_key).length} 字符）`);
    } catch (e) {
      add('code2Session', false, `★ ${e.message}`);
    }
  }

  // ④ 签名自检：验证签名函数本身能跑通（不发给平台，纯本地）
  try {
    const body = JSON.stringify({ offerId: 'x', env: 0 });
    const sig = calcPaySig('requestVirtualPayment', body, pickAppKey(secret) || 'k');
    add('签名函数自检', sig.length === 64, `产出 ${sig.length} 位十六进制（应为 64）`);
  } catch (e) {
    add('签名函数自检', false, `★ ${e.message}`);
  }

  report.openid = openid ? openid.slice(0, 6) + '…' + openid.slice(-4) : '(空)';
  report.summary = report.checks.filter((c) => c.ok === false).length
    ? `✗ ${report.checks.filter((c) => c.ok === false).length} 项失败`
    : report.checks.some((c) => c.ok === null)
      ? '△ 部分跳过'
      : '✓ 全部通过';
  return ok(report);
}

/* ---------------------------------------------------------------- */
/* 1. 创建订单：生成 outTradeNo + 双签名，返回 payData                 */
/* ---------------------------------------------------------------- */
async function createOrder(openid, event) {
  const secret = requireSecret();
  const planId = String((event && event.planId) || '').trim();

  // ---- 1.1 读套餐：价格一律以数据库为准，绝不信任前端传来的金额 ----
  // 这是防篡改的关键：前端只能传「要买哪个套餐」，不能传「多少钱」。
  const planRes = await db
    .collection(COLL_PLANS)
    .where({ planId: planId, active: true })
    .limit(1)
    .get();
  const plan = planRes && planRes.data && planRes.data[0];
  if (!plan) return fail(-10, '该套餐不存在或已下架');

  // ---- 1.2 已经是有效会员，且买的不是更长周期 → 拒绝重复付费 ----
  // 年费升级这里放行（补差价逻辑太复杂，先提示用户到期后再买）
  const current = await readMember(openid);
  if (current && current.expireAt > Date.now() && planId !== 'vip_year') {
    return fail(-11, '你已经是会员了，可直接查看权益，到期后再续费');
  }
  if (current && current.expireAt > Date.now() && planId === 'vip_year') {
    // ⚠️ 文案不能出现「顺延 / 自动续费」暗示：道具直购没有自动扣款能力，
    // 用户看了会以为到期会自动续上（实际什么都不会发生），审核也容易
    // 被认定暗示订阅服务。明确说「订单未创建、需要到期后再买」。
    return fail(-12, '你已是会员，本次未创建订单，到期后再续费即可');
  }

  // ---- 1.3 换 sessionKey（用户态签名用，只在服务端） ----
  const code = (event && event.code) || '';
  if (!code) return fail(-14, '缺少登录凭证');
  const session = await code2Session(code, secret.appSecret);
  const sessionKey = session.session_key;

  // ---- 1.4 落订单（状态 pending） ----
  const outTradeNo = genTradeNo();
  const now = Date.now();

  await db.collection(COLL_ORDERS).add({
    data: {
      _openid: openid, // 云函数以管理员身份写入，_openid 必须手动写
      outTradeNo: outTradeNo,
      wxOrderId: '', // 平台单号，发货推送回来时补
      planId: plan.planId,
      planName: plan.name,
      amount: plan.price, // 分
      status: 'pending', // pending → paid → delivered→ refunded
      attach: openid, // 透传字段：发货时原样带回，作为二次校验
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
    },
  });

  // ---- 1.5 构造 signData 并双签名 ----
  // ⚠️ body 只 stringify 一次，签名和「返回给前端的字符串」用同一份
  // ⚠️ 字段顺序与官方示例保持一致（offerId → buyQuantity → env → currencyType
  //    → productId → goodsPrice → outTradeNo → attach）。
  //   虽然平台校验的是「签名串逐字节一致」，理论上顺序无所谓，但保持一致
  //   能在人肉比对 signData 时一眼看出差异，排查 -15016 / -15013 时很省事。
  const signObj = {
    offerId: secret.offerId,
    buyQuantity: 1,
    env: envOf(secret), // 现网 0 / 沙箱 1，必须与 pickAppKey 取的 Key 配套
    currencyType: 'CNY',
    productId: plan.productId, // 必须与 MP 后台道具ID 完全一致
    goodsPrice: Number(plan.price), // 分，必须与 MP 后台道具价格一致（-15013）
    outTradeNo: outTradeNo,
    attach: openid,
  };
  const signData = JSON.stringify(signObj);

  const paySig = calcPaySig('requestVirtualPayment', signData, pickAppKey(secret));
  const signature = calcSignature(signData, sessionKey);

  return ok({
    payData: {
      mode: 'short_series_goods', // 道具直购
      signData: signData,
      paySig: paySig,
      signature: signature,
    },
    outTradeNo: outTradeNo,
    env: envOf(secret), // 回传给前端，方便确认到底跑在哪个环境
  });
}

/* ---------------------------------------------------------------- */
/* 2. 查会员状态（前端唯一可信的「我是不是会员」依据）                 */
/* ---------------------------------------------------------------- */
/**
 * ⚠️ 这里是整个会员链路里最关键的一处补丁。
 *
 * 官方规定发货有两条通道：平台的「发货推送」（主）+ 开发者主动查单（兜底），
 * 两者至少实现其一：
 *   路径 A「发货推送」需要你在 MP 后台配一个公网 URL 并部署接收服务；
 *   路径 B「主动查单」只要能调 /xpay/query_order 就行。
 * 本项目选择了路径 B —— 全项目找不到任何 xpay_goods_deliver_notify 接收端，
 * 也就是说发货这个动作本来就没有任何代码去做：
 * 支付成功、钱扣了，会员却永远不到账。
 *
 * 解决办法：把补发货挂到 queryMember 上。前端每次查会员状态时，顺手把该用户
 * 名下还没发货（status=pending）的订单拿去问一次平台，确认已支付就立刻发货。
 * 这样只要用户回到小程序，权益就会自动补上，不依赖 MP 后台那个 URL。
 *
 * 幂等保证：发货以 wx_order_id 去重（deliver 内部实现），重复查多少次都只发一次。
 */
async function queryMember(openid) {
  const sweep = await sweepPendingOrders(openid).catch(() => null);

  /*
   * 把运行环境一并返回给前端。
   * 目的：让用户**在点支付之前**就能在页面上看到自己到底在现网还是沙箱。
   * 之前只能靠开发者工具 Console 打日志判断，而真机「预览」模式根本不回传日志，
   * 等于让人蒙着眼睛决定要不要点付款。
   */
  const env = envOf(loadSecret() || {});

  const member = await readMember(openid);
  if (!member || member.expireAt <= Date.now()) {
    return ok({ isMember: false, expireAt: 0, planId: '', sweep: sweep, env: env, sandbox: env === 1 });
  }
  return ok({
    isMember: true,
    expireAt: member.expireAt,
    planId: member.planId,
    planName: member.planName,
    sweep: sweep,
    env: env,
    sandbox: env === 1,
  });
}

/**
 * 扫这个用户名下所有「待发货」订单，问平台有没有付款成功，成功就补发货。
 *
 * 节流：同一个 openid 10 秒内只扫一次。避免用户反复进出会员页时把
 * query_order 打爆（官方对这类接口有限频，超了会报 -15021）。
 *
 * @returns {Promise<{checked:number, recovered:number}|null>}
 */
const sweepLock = new Map();
async function sweepPendingOrders(openid) {
  const secret = loadSecret();
  if (!secret || !secret.appSecret || !pickAppKey(secret)) return null;

  const last = Number(sweepLock.get(openid) || 0);
  if (Date.now() - last < 10000) return null;
  sweepLock.set(openid, Date.now());

  let rows = [];
  try {
    const res = await db
      .collection(COLL_ORDERS)
      .where({ _openid: openid, status: 'pending' })
      // 按创建时间倒序：limit(3) 只扫最新几单。不加排序的话取到的
      // 不保证是最近的订单，旧 pending 单会把新单挤出这 3 个名额。
      .orderBy('createTime', 'desc')
      .limit(3)
      .get();
    rows = (res && res.data) || [];
  } catch (e) {
    return null;
  }
  if (!rows.length) return null;

  let recovered = 0;
  for (const order of rows) {
    try {
      const platformData = await queryPlatformOrder(openid, order.outTradeNo, secret);
      if (platformData) {
        await deliver(openid, order.outTradeNo, platformData);
        recovered += 1;
      }
    } catch (e) {
      // 单笔查单失败不拖累整体（可能只是限频或网络抖动），下一轮再试
    }
  }
  return { checked: rows.length, recovered: recovered };
}

/**
 * 调 /xpay/query_order 确认一笔订单是否已支付。
 *
 * @returns {Promise<object|null>} 已支付则返回平台响应原文（交给 deliver 取 wx_order_id），未支付返回 null
 */
async function queryPlatformOrder(openid, outTradeNo, secret) {
  const body = JSON.stringify({
    openid: openid,
    env: envOf(secret),
    order_id: outTradeNo,
  });
  const uri = '/xpay/query_order';
  const paySig = calcPaySig(uri, body, pickAppKey(secret));
  const token = await getAccessToken(secret.appSecret);

  const data = await httpPostJson(
    `https://api.weixin.qq.com${uri}?access_token=${token}&pay_sig=${paySig}`,
    body
  );

  // errcode 非 0 = 这次查单本身没成功（签名错 / token 失效 / 限频），不是「未支付」
  if (!data || data.errcode !== 0) return null;

  /*
   * ============ 真实返回结构（2026-10-06 实测原样抄录，勿凭印象改） ============
   * {
   *   "errcode": 0, "errmsg": "OK",
   *   "order": {
   *     "order_id":   "vipmuwfjppe001rln",
   *     "status":     3,                       ← 数字枚举，不是 "ORDER_STATUS_SUCCESS" 字符串
   *     "order_fee":  990,
   *     "paid_fee":   990,                     ← 实付金额
   *     "paid_time":  1791276123,              ← 已支付时间；未支付时为 0
   *     "wx_order_id":"VPO261006164152002695963",  ← 平台单号
   *     "biz_meta":   "{\"attach\":\"o6I4...\"}",   ← 下单时的 attach 原样带回
   *     "env_type":   2, "sett_state": 3, ...
   *   }
   * }
   * ==========================================================================
   *
   * ⚠️ 这里连续踩过两次坑，都源于对上面结构的错误假设，务必看完再改：
   *
   *   第一次：以为状态在**顶层**且叫 order_status，值是 "SUCCESS" 字符串。
   *     写成 `if (st && st.indexOf('SUCCESS') === -1) return null;`
   *     → 实际取不到该字段，st 为空串，那个 `st &&` 让判断被整体跳过，
   *       函数直接 return data，把**从未支付**的订单当成已支付发了会员。
   *
   *   第二次：改成「必须明确见到 SUCCESS 才认」
   *     → 同样取不到 → 这次反过来，**真付了钱的订单也发不出去**，
   *       用户钱扣了却一直显示非会员。
   *
   *   两次的共同错误：在猜某个状态字符串，而不是去认**语义无歧义的支付证据**。
   *   下面改用 paid_time + wx_order_id —— 这两个字段只在真正付款成功后才会同时有值，
   *   既不依赖枚举含义，也不依赖字段路径的猜测；缺任何一个就当作未支付（fail-closed）。
   */
  const o = data.order;
  if (!o) return null;

  // 单号必须对得上，防止张冠李戴（判了别的订单）
  if (o.order_id && String(o.order_id) !== String(outTradeNo)) return null;

  // 支付证据：已支付时间 + 平台单号，缺一不可
  const paidTime = Number(o.paid_time || 0);
  const wxOrderId = String(o.wx_order_id || '');
  if (!paidTime || !wxOrderId) return null;

  // 实付金额必须不小于标价，避免少付也算数
  const paidFee = Number(o.paid_fee || 0);
  const orderFee = Number(o.order_fee || 0);
  if (paidFee && orderFee && paidFee < orderFee) return null;

  // 返回 order 本体：wx_order_id / paid_time / biz_meta 都在里面，交给 deliver 用
  return o;
}

/** 读会员记录（不过滤过期，过期判断交给调用方，方便显示「已于X 过期」） */
async function readMember(openid) {
  try {
    const res = await db
      .collection(COLL_MEMBERS)
      .where({ _openid: openid })
      .limit(1)
      .get();
    return (res && res.data && res.data[0]) || null;
  } catch (e) {
    return null;
  }
}

/* ---------------------------------------------------------------- */
/* 3. 兜底查单：推送丢失时确认支付状态并补发权益                       */
/* ---------------------------------------------------------------- */
/**
 * 前端支付 success 回调**可能丢失**（用户异常退出、微信被杀），
 * 所以「发货推送」是主通道，本action 是兜底。
 * 前端在支付成功后延时调用一次，用户手动刷新会员页时也可以再调。
 */
async function verifyOrder(openid, event) {
  const secret = requireSecret();
  const outTradeNo = String((event && event.outTradeNo) || '').trim();

  // 没传订单号 = 查这个用户名下所有待发货订单（手动刷新时走这条）
  if (!outTradeNo) {
    const sweep = await sweepPendingOrders(openid);
    return ok({ delivered: !!(sweep && sweep.recovered), sweep: sweep });
  }

  // 只允许查自己的订单
  const orderRes = await db
    .collection(COLL_ORDERS)
    .where({ outTradeNo: outTradeNo, _openid: openid })
    .limit(1)
    .get();
  const order = orderRes && orderRes.data && orderRes.data[0];
  if (!order) return fail(-21, '订单不存在');

  // 已发货的直接返回，幂等
  if (order.status === 'delivered') {
    return ok({ delivered: true, order: order });
  }

  // 调平台 query_order 确认
  const platformData = await queryPlatformOrder(openid, outTradeNo, secret);
  if (platformData) {
    await deliver(openid, outTradeNo, platformData);
    return ok({ delivered: true, compensated: true });
  }

  // 查到了还没付：把平台原文带回去，方便确认到底走到哪一步
  return ok({ delivered: false, order: order });
}

/* ---------------------------------------------------------------- */
/* 4. 读取单条站点详情：会员专属内容的唯一入口                          */
/* ---------------------------------------------------------------- */
/**
 * 为什么必须有这个 action，而不是让客户端直接查 sites 集合：
 *
 * 小程序端的 `db.collection('sites').doc(id).get()` 是**绕不过**的 ——
 * 只要集合权限是「所有用户可读」，任何人用开发者工具或抓包都能直接读到
 * vipOnly: true 的记录全文，前端「不显示」只是障眼法。
 *
 * 正确做法：把会员专属内容的读取收到云函数，服务端按 openid 判定后再决定
 * 返回多少字段。前端拿不到原始数据，就不存在绕过。
 *
 * 返回策略（非会员读 vipOnly 条目时）：
 *   - description 截断为 40字（给一个开头，不给全文）
 *   - 不返回 detailDesc / url / tags
 *   - 返回 needVip: true，前端据此显示锁定态
 * 这样卡片上能看见「有这个工具」，但真正的内容必须付费才能拿。
 */
async function readSite(openid, event) {
  const siteId = String((event && event.siteId) || '').trim();
  if (!siteId) return fail(-30, '缺少站点 id');

  let raw = null;
  try {
    const res = await db.collection('sites').doc(siteId).get();
    raw = (res && res.data) || null;
  } catch (e) {
    return fail(-31, '这个工具可能已经被移除了');
  }
  if (!raw) return fail(-31, '这个工具可能已经被移除了');

  const member = await readMember(openid);
  const isMember = !!(member && member.expireAt > Date.now());
  const vipOnly = raw.vipOnly === true;

  // 非会员读会员专属条目：只给开头，不给全文与关键字段
  if (vipOnly && !isMember) {
    const desc = String(raw.description || '');
    return ok({
      _id: raw._id,
      name: raw.name || '未命名工具',
      category: raw.category || '未分类',
      description: desc.length > 40 ? `${desc.slice(0, 40)}…` : desc,
      createTime: raw.createTime || null,
      vipOnly: true,
      needVip: true,
      // 以下字段刻意不下发
      url: '',
      tags: [],
      coverUrl: '',
    });
  }

  return ok({
    _id: raw._id,
    name: raw.name || '未命名工具',
    url: raw.url || '',
    category: raw.category || '未分类',
    description: raw.description || '',
    detailDesc: raw.detailDesc || '',
    coverUrl: raw.coverUrl || '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    createTime: raw.createTime || null,
    vipOnly: vipOnly,
    needVip: false,
  });
}

/* ---------------------------------------------------------------- */
/* 5. 首页列表 / 6. 今日精选：vipOnly 条目在服务端剥离后下发            */
/* ---------------------------------------------------------------- */
/**
 * 为什么列表也必须走云函数（readSite 只堵详情页是不够的）：
 *
 * sites 集合权限是「所有用户可读」，首页列表原来的客户端直查
 * db.collection('sites').where(...).field({ url: true, ... }).get()
 * 会把 vipOnly 条目的 url / 简介全文 / 封面原样下发到客户端 ——
 * 前端 decorate() 里「不显示域名和封面」只是障眼法，抓包即可拿全量数据，
 * 会员墙在列表层等于不存在。今日精选（picks 关联查询）同理。
 * 所以列表和精选也收到云函数：服务端按 openid 判定后，非会员拿到的
 * vipOnly 条目只有 name / category / 简介前 40 字，url 与封面根本不出网。
 *
 * ⚠️ 注意 createTime 统一转毫秒时间戳返回：客户端直查时 SDK 会把 Date
 * 还原成 Date 对象，而云函数返回值走 JSON 序列化会变成 ISO 字符串，
 * 前端 util.fromNow() 的字符串分支在 iOS 上解析 ISO 字符串不稳。
 * 转成 number 后前端 fromNow / formatDate 都有原生分支，跨平台一致。
 */

/** 转义正则特殊字符（keyword 进 db.RegExp 前必须过一遍，防注入） */
function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 按会员状态裁剪一条站点记录（列表 / 精选 / 详情共用同一套策略）。
 * 非会员读 vipOnly 条目：description 截 40 字，url / coverUrl / detailDesc
 * / tags 一律不下发 —— 与 readSite 的口径完全一致。
 */
function sanitizeSite(raw, isMember) {
  if (!raw) return null;
  const vipOnly = raw.vipOnly === true;
  if (vipOnly && !isMember) {
    const desc = String(raw.description || '');
    return {
      _id: raw._id,
      name: raw.name || '未命名工具',
      category: raw.category || '未分类',
      description: desc.length > 40 ? `${desc.slice(0, 40)}…` : desc,
      createTime: raw.createTime ? new Date(raw.createTime).getTime() : null,
      vipOnly: true,
      // url / coverUrl / detailDesc / tags 刻意不下发
    };
  }
  return {
    _id: raw._id,
    name: raw.name || '未命名工具',
    url: raw.url || '',
    category: raw.category || '未分类',
    description: raw.description || '',
    coverUrl: raw.coverUrl || '',
    createTime: raw.createTime ? new Date(raw.createTime).getTime() : null,
    vipOnly: vipOnly,
  };
}

/** 与首页客户端版 buildWhere 相同的查询条件：分类 + 名称/简介模糊搜索 + 会员专属 */
function buildListWhere(event) {
  const category = String((event && event.category) || '').trim();
  const keyword = String((event && event.keyword) || '').trim().slice(0, 50);
  const vipOnly = (event && event.vipOnly) === true;

  const cond = [];
  if (category) cond.push({ category: category });
  if (vipOnly) cond.push({ vipOnly: true });
  if (keyword) {
    const reg = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
    cond.push(db.command.or([{ name: reg }, { description: reg }]));
  }
  if (!cond.length) return {};
  if (cond.length === 1) return cond[0];
  return db.command.and(cond);
}

/** 首页列表：分页 + 搜索 + 分类，vipOnly 条目按会员状态剥离 */
async function listSites(openid, event) {
  const page = Math.max(0, Number((event && event.page) || 0) || 0);
  const pageSize = Math.min(50, Math.max(1, Number((event && event.pageSize) || 20) || 20));
  const where = buildListWhere(event);

  const countRes = await db.collection('sites').where(where).count();
  const total = (countRes && countRes.total) || 0;

  const res = await db
    .collection('sites')
    .where(where)
    .field({
      name: true,
      url: true,
      category: true,
      description: true,
      coverUrl: true,
      createTime: true,
      vipOnly: true,
      // detailDesc 不取：纯会员长文，列表层永远不该带出来
    })
    .orderBy('createTime', 'desc')
    .skip(page * pageSize)
    .limit(pageSize)
    .get();
  const rows = (res && res.data) || [];

  const member = await readMember(openid);
  const isMember = !!(member && member.expireAt > Date.now());

  const list = rows.map((raw) => sanitizeSite(raw, isMember)).filter(Boolean);
  return ok({ total: total, list: list, page: page, pageSize: pageSize });
}

/** 今日精选：picks 集合（运营配置，无敏感字段）关联 sites，后者按会员状态剥离 */
async function listPicks(openid) {
  const res = await db
    .collection('picks')
    .orderBy('order', 'asc')
    .limit(12)
    .get();
  const rows = (res && res.data) || [];
  const ids = rows.map((x) => x && x.siteId).filter(Boolean);
  if (!ids.length) return ok({ list: [] });

  const siteRes = await db
    .collection('sites')
    .where({ _id: db.command.in(ids) })
    .field({
      name: true,
      url: true,
      category: true,
      description: true,
      coverUrl: true,
      createTime: true,
      vipOnly: true,
    })
    .get();
  const siteMap = {};
  ((siteRes && siteRes.data) || []).forEach((s) => {
    siteMap[s._id] = s;
  });

  const member = await readMember(openid);
  const isMember = !!(member && member.expireAt > Date.now());

  // 按 picks 的 order 顺序还原（与前端原逻辑一致）
  const list = ids
    .map((id) => sanitizeSite(siteMap[id], isMember))
    .filter(Boolean);
  return ok({ list: list });
}

/**
 * 我的凭证：查自己名下「已支付过」的订单（delivered / refunded），
 * 按 createTime 倒序最多 3 笔，给会员页「我的凭证」区块用。
 *
 * 只返回对账需要的字段：两个单号 + 套餐 + 金额 + 时间。
 * outTradeNo（业务单号，我们自己生成，genTradeNo：vip + base36 时间戳
 * + 6 位随机，约 20 位）是系统内的唯一凭证；wxOrderId（平台单号）
 * 是微信支付侧的官方凭证，退款 / 对账 / 客服申诉以它为准。
 * 只能查自己的（where 带 _openid），pending 未支付单不返回 ——
 * 那不是凭证，是没完成的意图。
 */
async function queryOrders(openid) {
  const res = await db
    .collection(COLL_ORDERS)
    .where({
      _openid: openid,
      status: db.command.in(['delivered', 'refunded']),
    })
    .orderBy('createTime', 'desc')
    .limit(3)
    .get();
  const rows = (res && res.data) || [];
  const list = rows.map((o) => ({
    outTradeNo: o.outTradeNo || '',
    wxOrderId: o.wxOrderId || '',
    planName: o.planName || o.planId || '',
    amount: o.amount || 0,
    status: o.status,
    createTime: o.createTime ? new Date(o.createTime).getTime() : null,
  }));
  return ok({ list: list });
}

/* ---------------------------------------------------------------- */
/* 发货：幂等核心。这里的逻辑必须与「消息推送」接收服务保持一致。      */
/* ---------------------------------------------------------------- */
/**
 * 发放会员权益。
 * 幂等保证：同outTradeNo / wxOrderId 重复调用只发一次。
 * 幂等键用 wxOrderId（官方指定：跟踪订单、发货、对账以平台单号为准）。
 */
async function deliver(openid, outTradeNo, platformData) {
  /**
   * 平台单号 wx_order_id 是官方指定的幂等键。
   * 推送 / 查单 / 手动补发三条路进来的字段名不一致，这里逐个兜一遍。
   */
  const wxOrderId =
    (platformData && platformData.wx_order_id) ||
    (platformData && platformData.wxOrderId) ||
    (platformData && platformData.order_id) ||
    (platformData &&
      platformData.WeChatPayInfo &&
      platformData.WeChatPayInfo.MchOrderNo) ||
    '';

  // 二次校验：下单时 attach 存的是 openid，发货时原样带回。
  // ⚠️ 平台不直接给 attach 字段，而是塞在 biz_meta 这个 JSON 字符串里：
  //     biz_meta: "{\"attach\":\"o6I424...\"}"  → 得解开一层才拿得到。
  let attach = (platformData && (platformData.attach || platformData.Attach)) || '';
  if (!attach && platformData && platformData.biz_meta) {
    try {
      const meta = JSON.parse(platformData.biz_meta);
      attach = (meta && meta.attach) || '';
    } catch (e) {
      /* biz_meta 不是合法 JSON 就算了，不影响主流程 */
    }
  }
  if (attach && attach !== openid) {
    return { code: -2, reason: 'attach mismatch' };
  }

  const res = await db
    .collection(COLL_ORDERS)
    .where({ outTradeNo: outTradeNo })
    .limit(1)
    .get();
  const order = res && res.data && res.data[0];
  if (!order) return { code: -1, reason: 'order not found' };

  // 金额交叉校验：平台实付金额必须够得上订单标价，防止少付也发货
  const paidFee = Number((platformData && platformData.paid_fee) || 0);
  const dbAmount = Number(order.amount || 0);
  if (paidFee && dbAmount && paidFee < dbAmount) {
    return { code: -3, reason: `paid_fee ${paidFee} < order.amount ${dbAmount}` };
  }

  // 幂等①：本单已发货
  if (order.status === 'delivered') {
    return { code: 0, reason: 'already delivered' };
  }
  // 已退款的单不再发货
  if (order.status === 'refunded') {
    return { code: 0, reason: 'refunded, skip' };
  }

  // 幂等②：官方要求以 wx_order_id 去重。同一个平台单号已经在别的业务单号下
  // 发过货（极端情况下可能重复提交），这里直接拦掉，防止重复发权益。
  if (wxOrderId) {
    try {
      const dup = await db
        .collection(COLL_ORDERS)
        .where({ wxOrderId: wxOrderId, status: 'delivered' })
        .limit(1)
        .get();
      if (dup && dup.data && dup.data.length) {
        return { code: 0, reason: 'duplicate wx_order_id, skip' };
      }
    } catch (e) {
      /* 查询失败不阻断，下面的条件更新还能保底 */
    }
  }

  // 先把订单标记为已发放。用 wxOrderId 做条件更新，天然防并发重复发货
  const upd = await db
    .collection(COLL_ORDERS)
    .where({ outTradeNo: outTradeNo, status: 'pending' })
    .update({
      data: {
        status: 'delivered',
        wxOrderId: wxOrderId,
        paidTime: (platformData && platformData.paid_time) || null,
        updateTime: db.serverDate(),
      },
    });
  if (!upd || upd.stats === undefined || upd.stats.updated === 0) {
    // 没更新到 = 已被并发处理过了，视为幂等成功
    return { code: 0, reason: 'concurrent, skip' };
  }

  // 更新会员状态：以「最长到期时间」为准，避免续费时把时间改短
  //
  // ⚠️ 起算点必须是「支付时间」而不是发货时刻：发货靠用户回访触发
  // （verifyOrder / queryMember 扫单），付完钱隔几天才回来很常见，
  // 从 now 起算等于让用户平白少几天会员。paid_time 是秒级时间戳
  // （见 queryPlatformOrder 的实测注释），×1000 转毫秒；缺失时才退回 now。
  const paidTimeRaw = Number(platformData && platformData.paid_time) || 0;
  const baseMs = paidTimeRaw > 0 ? paidTimeRaw * 1000 : Date.now();
  const now = Date.now();
  const baseExpire = calcExpireAt(order.planId, baseMs);

  const cur = await readMember(openid);
  const nextExpire =
    cur && cur.expireAt > now ? Math.max(cur.expireAt, baseExpire) : baseExpire;

  const memberData = {
    _openid: openid,
    planId: order.planId,
    planName: order.planName,
    expireAt: nextExpire,
    updateTime: db.serverDate(),
  };

  // 先条件更新、更新到 0 条再插入（update-then-add）。
  // 不能先查再写：同一用户两笔订单并发发货时，两边都 readMember 到
  // 「无记录」然后各自 add，会产生两条 vip_members 记录（readMember
  // 只取 limit(1)，另一条变孤儿）。条件更新至少保证已存在的记录
  // 总能被覆盖到；add 撞重复的概率被压缩到「两次 add 真正并发」这一
  // 极窄窗口。彻底根除需要给 _openid 建唯一索引（云开发控制台 →
  // vip_members → 索引管理），冲突时走下面的 update 兜底即可。
  const memberUpd = await db
    .collection(COLL_MEMBERS)
    .where({ _openid: openid })
    .update({ data: memberData });
  const updated = memberUpd && memberUpd.stats ? memberUpd.stats.updated : 0;
  if (!updated) {
    try {
      await db
        .collection(COLL_MEMBERS)
        .add({ data: Object.assign({}, memberData, { createTime: db.serverDate() }) });
    } catch (e) {
      // 唯一索引冲突（另一笔并发已插入）：降级为覆盖更新，保住幂等
      await db
        .collection(COLL_MEMBERS)
        .where({ _openid: openid })
        .update({ data: memberData });
    }
  }

  return { code: 0, reason: 'delivered' };
}

/* ---------------------------------------------------------------- */
/* access_token（服务端 API 鉴权用）                                   */
/* ---------------------------------------------------------------- */
let tokenCache = { value: '', expireAt: 0 };
async function getAccessToken(appSecret) {
  if (tokenCache.value && tokenCache.expireAt > Date.now()) {
    return tokenCache.value;
  }
  const appid = cloud.getWXContext().APPID;
  const qs = querystring.stringify({
    grant_type: 'client_credential',
    appid: appid,
    secret: appSecret,
  });
  const data = await httpGetJson(`https://api.weixin.qq.com/cgi-bin/token?${qs}`);
  if (!data || !data.access_token) {
    throw new Error(
      `getAccessToken failed errcode=${data && data.errcode} errmsg=${(data && data.errmsg) || '未知'}`
    );
  }
  tokenCache = {
    value: data.access_token,
    // 提前 1 分钟过期，避免边界失效
    expireAt: Date.now() + (data.expires_in || 7200) * 1000 - 60000,
  };
  return tokenCache.value;
}

/* ---------------------------------------------------------------- */
/* 供「消息推送接收服务」复用（部署 Skill 时会用到）                   */
/* ---------------------------------------------------------------- */
exports.deliver = deliver;
exports.calcPaySig = calcPaySig;
exports.calcSignature = calcSignature;
