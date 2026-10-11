/**
 * utils/vip.js —— 会员状态（前端侧）
 *
 * 设计原则（三条，缺一不可）：
 *
 * 1. **权益判定以云函数为准**，本地缓存只用于「秒开渲染」和「减少请求」。
 *    绝不能因为本地缓存写着 isMember: true 就真的放行内容 ——
 *    那等于任何人改一下storage 就能白嫖。
 *
 * 2. **本地缓存不含任何身份信息**。只存 isMember / expireAt / planId，
 *    不存 openid、不存订单号、不存 sessionKey。即使被读出来也只是个有效期。
 *
 * 3. **微信 openid 全程不出现**。云函数用 getWXContext() 拿可信 openid，
 *    前端连自己是谁都不需要知道。
 */

const config = require('../config.js');

const KEY = config.VIP_STATE_KEY;
const DAY = 24 * 60 * 60 * 1000;

/** 会员状态在内存里的镜像，避免同一次会话内反复读storage */
let memory = null;

/* ---------------------------------------------------------------- */
/* 本地缓存读写                                                     */
/* ---------------------------------------------------------------- */

function readCache() {
  if (memory) return memory;
  try {
    const raw = wx.getStorageSync(KEY) || null;
    memory = raw && typeof raw === 'object' ? raw : null;
  } catch (e) {
    memory = null;
  }
  return memory;
}

function writeCache(state) {
  memory = state;
  try {
    if (state) {
      wx.setStorageSync(KEY, {
        isMember: !!state.isMember,
        expireAt: state.expireAt || 0,
        planId: state.planId || '',
        cachedAt: Date.now(),
      });
    } else {
      wx.removeStorageSync(KEY);
    }
  } catch (e) {
    /* 缓存写不进就算了，不影响主流程 */
  }
}

/* ---------------------------------------------------------------- */
/* 对外接口                                                         */
/* ---------------------------------------------------------------- */

/**
 * 会员是否有效。
 * @param {object} state setData 里的vipState
 * @returns {boolean}
 */
function isActive(state) {
  if (!state) return false;
  return !!state.isMember && Number(state.expireAt || 0) > Date.now();
}

/**
 * 立即可用的会员状态（不发请求）。
 * 用于首屏渲染：先按缓存决定要不要显示会员角标 / 锁定区，
 * 随后 refresh() 拉到真实状态后再更新。
 */
function currentState() {
  const c = readCache();
  if (!c) return { isMember: false, expireAt: 0, planId: '' };
  return {
    isMember: isActive(c),
    expireAt: c.expireAt || 0,
    planId: c.planId || '',
    planName: c.planName || '',
  };
}

/**
 * 拉取真实会员状态（以云函数返回为准）。
 * @returns {Promise<{isMember:boolean, expireAt:number, planId:string, planName:string}>}
 */
function refresh() {
  if (!config.VIP_ENABLED) {
    const s = { isMember: false, expireAt: 0, planId: '', planName: '' };
    writeCache(s);
    return Promise.resolve(s);
  }

  return wx.cloud
    .callFunction({ name: config.VIP_FUNCTION, data: { action: 'queryMember' } })
    .then((res) => {
      const r = (res && res.result) || {};
      if (r.code !== 0) throw new Error(r.msg || 'query failed');
      const d = r.data || {};
      const state = {
        isMember: isActive(d),
        expireAt: Number(d.expireAt || 0),
        planId: d.planId || '',
        planName: d.planName || '',
        // 运行环境由云函数告知（1 = 沙箱）。只用于页面提示，不进本地缓存 ——
        // 缓存里存环境标记没意义，环境以服务端当前状态为准。
        sandbox: d.sandbox === true,
      };
      writeCache(state);
      return state;
    })
    .catch(() => {
      // 拉取失败：保守处理 —— 用缓存，但不主动发权益（避免服务异常时误放行）
      return currentState();
    });
}

/**
 * 支付成功后的兜底查单。
 *
 * ⚠️ 官方明确：wx.requestVirtualPayment 的 success 回调**可能丢失**
 * （用户异常退出、微信进程被杀），所以不能拿它当「已支付」的依据。
 * 正常流程靠「发货推送」发权益；这个方法用于推送还没到达时让用户
 * 立刻看到结果，避免「付了钱但还是非会员」的困惑。
 *
 * @param {string} outTradeNo 下单时返回的业务单号
 */
function verifyOrder(outTradeNo) {
  if (!outTradeNo || !config.VIP_ENABLED) return Promise.resolve(null);
  return wx.cloud
    .callFunction({
      name: config.VIP_FUNCTION,
      data: { action: 'verifyOrder', outTradeNo: outTradeNo },
    })
    .then((res) => {
      const r = (res && res.result) || {};
      if (r.code !== 0) return null;
      return r.data || null;
    })
    .catch(() => null);
}

/* ---------------------------------------------------------------- */
/* 展示用文案                                                       */
/* ---------------------------------------------------------------- */

/** 到期文案：还剩多久 / 已过期多久 */
function expireText(expireAt) {
  if (!expireAt) return '';
  const diff = Number(expireAt) - Date.now();
  if (diff <= 0) return '已过期';
  const days = Math.ceil(diff / DAY);
  if (days <= 1) return '今天到期';
  if (days <= config.VIP_RENEW_REMIND_DAYS) {
    return `${days} 天后到期`;
  }
  return `${formatDate(expireAt)} 到期`;
}

/** 是否处于「即将到期」的提醒区间 */
function isExpiring(expireAt) {
  if (!expireAt) return false;
  const diff = Number(expireAt) - Date.now();
  return diff > 0 && diff <= config.VIP_RENEW_REMIND_DAYS * DAY;
}

function formatDate(ts) {
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * iOS 支付前置校验。
 * 官方要求：iOS 端需微信客户端 8.0.68 及以上，否则无法拉起支付。
 * 不校验直接调支付会失败并给出难以理解的错误。
 *
 * @returns {{ok:boolean, needUpdate:boolean}}
 */
function checkPayEnvironment() {
  let sys = null;
  try {
    sys = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
  } catch (e) {
    return { ok: true, needUpdate: false }; // 拿不到信息就不拦，让支付自己报错
  }

  if (!sys || sys.platform !== 'ios') return { ok: true, needUpdate: false };

  const ver = String(sys.version || '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const base = [8, 0, 68];
  for (let i = 0; i < 3; i += 1) {
    const c = ver[i] || 0;
    if (c > base[i]) return { ok: true, needUpdate: false };
    if (c < base[i]) return { ok: false, needUpdate: true };
  }
  return { ok: true, needUpdate: false };
}

/** 清除本地缓存（用户主动退出登录场景会用到；本项目暂无登录，故少用） */
function clear() {
  writeCache(null);
  memory = null;
}

/**
 * 我的凭证：自己名下已支付订单（最近 3 笔）。
 * outTradeNo 是系统内唯一凭证，wxOrderId 是微信支付侧官方凭证，
 * 「已支付未到账」纠纷时用户报这两个单号即可快速核对。
 * @returns {Promise<Array<{outTradeNo, wxOrderId, planName, amount, status, createTime}>>}
 */
function myOrders() {
  return wx.cloud
    .callFunction({
      name: config.VIP_FUNCTION,
      data: { action: 'queryOrders' },
    })
    .then((res) => {
      const r = (res && res.result) || {};
      if (r.code !== 0) throw new Error(r.msg || '订单读取失败');
      return (r.data && r.data.list) || [];
    });
}

module.exports = {
  isActive,
  currentState,
  refresh,
  verifyOrder,
  myOrders,
  expireText,
  isExpiring,
  checkPayEnvironment,
  clear,
};
