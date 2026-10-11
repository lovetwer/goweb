// pages/vip/vip.js —— 会员中心
//
// 支付链路（官方要求的顺序，不能改）：
//   1. wx.login 拿 code
//   2. 云函数 createOrder：生成 outTradeNo + 双签名（AppKey/sessionKey 全在云函数）
//   3. wx.requestVirtualPayment(payData) 拉起支付
//   4. success 回调【不可信、可能丢失】→ 不作为发货依据
//      而是延时调用 verifyOrder 兜底查单（正常主通道是平台的发货推送）
//   5. 会员状态一律以云函数 queryMember 为准
//
// 价格永远来自数据库（云函数读取），前端不传金额、不显示可改写的价格字段。

const config = require('../../config.js');
const vip = require('../../utils/vip.js');
const util = require('../../utils/util.js');

/**
 * 【诊断用】在开发者工具 Console 里粘贴调用即可逐环定位问题：
 *   wx.vipDiag()
 *
 * 支付链路有三环（密钥 / 数据库 / 签名），坏掉时前端都只显示「服务异常」，
 * 无从下手。这个函数把每环单独测一遍并打印结果，不产生任何订单、不扣钱。
 * 修好后可以删掉这个文件。
 */
wx.vipDiag = function () {
  return new Promise((resolve) => {
    wx.login({
      success: (lr) => {
        wx.cloud
          .callFunction({
            name: config.VIP_FUNCTION,
            data: { action: 'diag', code: lr.code },
          })
          .then((res) => {
            const r = (res && res.result) || {};
            if (r.code !== 0) {
              console.error('[诊断] 云函数返回错误', r);
              return resolve(r);
            }
            const d = r.data || {};
            console.log('%c[goweb 会员诊断] ' + d.summary, 'font-weight:bold;font-size:14px');
            console.table(d.checks);
            if (d.openid) console.log('你的 openid：', d.openid);
            return resolve(d);
          })
          .catch((e) => {
            console.error('[诊断] 云函数调用失败（可能没部署）', e);
            resolve(null);
          });
      },
      fail: (e) => {
        console.error('[诊断] wx.login 失败', e);
        resolve(null);
      },
    });
  });
};

/**
 * 把 wx.requestVirtualPayment 的错误码翻成人话。
 *
 * 绝大部分「拉不起支付」都不是代码问题，而是 MP 后台的配置问题，
 * 所以这里逐个指出「该去后台哪个位置改」—— 光看到一个错误码仍然没法动手。
 *
 * 官方错误码表：
 * https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html
 *
 * @param {number} code fail 回调里的 errCode
 * @param {string} msg  fail 回调里的 errMsg
 */
function payErrorText(code, msg) {
  const map = {
    1001: '参数不完整，请返回会员页重试',
    '-1': '支付失败，请稍后再试',
    '-4': '支付被风控拦截，请更换网络或稍后再试',
    '-5': '签约状态未知，请稍后再试',
    '-15001': '支付参数有误，请重新下单',
    '-15002': '订单号重复，请返回会员页重新开通',
    '-15003': '支付系统异常，请稍后再试',
    '-15004': '币种只能是 CNY（服务端配置问题）',
    '-15005': '用户态签名无效：退出重进会员页再试',
    '-15006': '支付签名无效：检查 MP 后台现网 AppKey 是否填对',
    '-15007': '登录态已过期，请返回会员页重新开通',
    '-15008': '二级商户未开通：MP → 虚拟支付 → 完成开通签约',
    '-15009': '代币未发布，请到付费管理发布',
    '-15010': '道具未发布：MP → 虚拟支付 → 道具管理，发布后约 10 分钟生效',
    '-15011': '当前用户是现网版本，env 只能填 0（服务端配置问题）',
    '-15012': '下单失败：名额紧张，可以再试一下',
    '-15013': '道具价格与后台不一致：核对 vip_plans 的 price 与 MP 道具价格是否相同',
    '-15014': '道具刚发布还没生效，官方约 10 分钟后可用',
    '-15016': 'signData 格式错误（服务端配置问题）',
    '-15017': '商家涉嫌违规，收款功能已被限制',
    '-15018': '道具审核未通过：MP → 虚拟支付 → 道具管理查看驳回原因',
    '-15019': '商户支付受限，请打开微信支付商家助手小程序查看',
    '-15020': '操作过快，请稍候再试',
    '-15021': '小程序交易被限频，请稍后再试'
  };

  // 这些是「照着改就能修好」的配置类错误，不必再挂一个错误码扰人视线
  const actionable = ['-15010', '-15013', '-15018', '-15006', '-15008'];
  const hint = map[String(code)];
  if (hint) {
    return actionable.indexOf(String(code)) > -1 ? hint : `${hint}（${code}）`;
  }
  return `支付未完成，请重试（错误码 ${code || '未知'}）`;
}

Page({
  data: {
    // 会员状态
    isMember: false,
    expireAt: 0,
    planId: '',
    planName: '',
    expireLabel: '',
    expiringSoon: false,

    // 套餐（从云函数读取，前端不写死价格）
    plans: [],
    selectedPlanId: 'vip_month',

    // 交互态
    loading: true,
    paying: false,
    error: '',

    // 协议同意：默认不勾选（审核要求由用户主动选择，不得默认同意）
    agreed: false,

    // 我的凭证：已支付订单的双单号（对账 / 自证用，仅会员态展示）
    orders: [],

    // 环境提示（iOS 微信版本过低时展示）
    needWechatUpdate: false,

    // 沙箱环境提示（由云函数告知；页面明确提示沙箱不代表付款免费）
    sandbox: false
  },

  onLoad() {
    if (!config.VIP_ENABLED) {
      // 开关关闭：静默降级为普通页面，不展示任何购买入口
      this.setData({ loading: false, plans: [] });
      return;
    }

    // 先用本地缓存渲染，避免白屏
    const cached = vip.currentState();
    this.applyState(cached);

    this.loadPlans();
    this.loadMember();

    // iOS 前置校验：版本不够就直接提示，不让用户点了才失败
    const env = vip.checkPayEnvironment();
    this.setData({ needWechatUpdate: !env.ok && env.needUpdate });
  },

  onShow() {
    if (!config.VIP_ENABLED) return;
    // 从支付页返回时刷新一次（用户可能刚买完）
    this.loadMember();
  },

  /* ---------------------------------------------------------------- */
  /* 数据                                                             */
  /* ---------------------------------------------------------------- */

  loadMember() {
    return vip
      .refresh()
      .then((state) => {
        this.applyState(state);
        // 会员态顺带拉凭证（非会员没有已支付订单，拉也是空）
        if (vip.isActive(state)) this.loadOrders();
      });
  },

  /** 我的凭证：最近 3 笔已支付订单，双单号 + 金额 + 时间 */
  loadOrders() {
    return vip
      .myOrders()
      .then((list) => {
        this.setData({
          orders: list.map((o) => ({
            outTradeNo: o.outTradeNo,
            wxOrderId: o.wxOrderId || '',
            planName: o.planName,
            priceText: this.formatPrice(o.amount),
            refunded: o.status === 'refunded',
            timeText: o.createTime ? util.formatDate(o.createTime, 'YYYY-MM-DD HH:mm') : '',
          })),
        });
      })
      .catch(() => {
        // 凭证加载失败不影响主流程（会员状态照常显示），下次刷新再试
      });
  },

  applyState(state) {
    this.setData({
      isMember: vip.isActive(state),
      expireAt: state.expireAt || 0,
      planId: state.planId || '',
      planName: state.planName || '',
      expireLabel: vip.expireText(state.expireAt),
      expiringSoon: vip.isExpiring(state.expireAt),
      // 沙箱环境只展示环境标记与谨慎付款提示，不对是否扣款作承诺
      sandbox: !!state.sandbox,
      loading: false,
    });
  },

  /**
   * 读套餐。价格从 vip_plans 集合读取 ——
   * 真实扣费金额以云函数下单时读取的数据库价格为准，
   * 这里的数字仅供用户看，改了也影响不到实际支付。
   *
   * 折扣文案不存数据库：只存月价和年价两个数字，折扣在页面上按
   * 「年价 vs 12 × 月价」实时算出来。这样你在后台改价格时不用同步改文案，
   * 也不会出现「价格改了、角标还写着旧折扣」这种虚假宣传（审核会判违规）。
   */
  loadPlans() {
    const db = getApp().getDB();
    if (!db) {
      this.setData({ loading: false, error: '数据库未就绪' });
      return Promise.resolve();
    }
    return db
      .collection('vip_plans')
      .where({ active: true })
      .orderBy('sort', 'asc')
      .limit(10)
      .get()
      .then((res) => {
        const rows = (res && res.data) || [];
        const plans = rows.map((p) => ({
          planId: p.planId,
          name: p.name,
          price: Number(p.price || 0),
          priceText: this.formatPrice(p.price),
          period: p.period || '',
          benefit: p.benefit || '',
        }));
        this.setData({
          plans: this.withDiscount(plans),
          loading: false,
        });
      })
      .catch(() => {
        this.setData({ loading: false, error: '套餐信息加载失败' });
      });
  },

  /**
   * 给年费套餐算折扣角标。
   * 公式：省 = (12 × 月价 − 年价) / (12 × 月价)
   * 例：9.9 × 12 = 118.8，99 → 16.67% → 显示「省 16%」
   *
   * 用 floor 向下取整（宁可少说不可多说，避免虚假宣传），
   * 算出来不足 1% 或为负就不显示角标（不打折不该标"省"）。
   */
  withDiscount(plans) {
    const month = plans.find((p) => p.planId === 'vip_month');
    const year = plans.find((p) => p.planId === 'vip_year');
    if (!month || !year || !month.price || !year.price) return plans;

    const twelveMonths = month.price * 12;
    const saved = twelveMonths - year.price;
    const percent = Math.floor((saved / twelveMonths) * 100);

    return plans.map((p) => {
      if (p.planId !== 'vip_year' || percent < 1) return p;
      return Object.assign({}, p, { badge: `省 ${percent}%` });
    });
  },

  /** 分 → 显示文本。整数不显示小数，非整数保留两位 */
  formatPrice(fen) {
    const n = Number(fen || 0) / 100;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  },

  /* ---------------------------------------------------------------- */
  /* 交互                                                             */
  /* ---------------------------------------------------------------- */

  onSelectPlan(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ selectedPlanId: id, error: '' });
  },

  /** 协议勾选框：由用户主动切换，默认不勾选 */
  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed, error: '' });
  },

  onBuy() {
    if (!config.VIP_ENABLED) return;
    if (this.data.paying) return;

    // 未勾选协议不得开通：明确提示并中止，不做任何默认同意
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选同意《用户协议》与《隐私政策》', icon: 'none', duration: 2000 });
      return;
    }

    // 已是会员就不重复购买
    if (this.data.isMember) {
      wx.showToast({ title: '你已经是会员了', icon: 'none' });
      return;
    }

    const plan = this.data.plans.find((p) => p.planId === this.data.selectedPlanId);
    if (!plan) {
      this.setData({ error: '请先选择套餐' });
      return;
    }

    // iOS 前置校验
    const env = vip.checkPayEnvironment();
    if (!env.ok && env.needUpdate) {
      this.setData({ needWechatUpdate: true });
      wx.showModal({
        title: '请先更新微信',
        content: 'iOS 端购买会员需要微信 8.0.68 及以上版本，请更新后重试。',
        showCancel: false,
      });
      return;
    }

    // 接口可用性校验（官方硬性要求）。
    // wx.requestVirtualPayment 从基础库 2.19.2 起支持，低版本客户端上根本不存在这个方法，
    // 直接调用会抛 TypeError —— 表现同样是「点了没反应」。先兜一层，至少能说清原因。
    if (!wx.requestVirtualPayment) {
      this.setData({ error: '当前微信版本不支持虚拟支付，请更新后再试' });
      return;
    }

    this.setData({ paying: true, error: '' });

    // 第1 步：wx.login 拿 code
    wx.login({
      success: (loginRes) => {
        if (!loginRes || !loginRes.code) {
          this.setData({ paying: false, error: '获取登录凭证失败，请重试' });
          return;
        }
        // 第 2 步：云函数下单 + 双签名
        wx.cloud
          .callFunction({
            name: config.VIP_FUNCTION,
            data: { action: 'createOrder', planId: plan.planId, code: loginRes.code },
          })
          .then((res) => {
            const r = (res && res.result) || {};
            if (r.code !== 0) {
              // 云函数返回了业务错误：把 debug 一并打到 console，
              // 这样开发者工具 Console 里能直接看到失败原因，不用去翻云端日志。
              if (r.debug) {
                console.error('[vip] 下单失败', r.code, r.msg, r.debug);
              }
              this.setData({ paying: false, error: r.msg || '下单失败，请稍后重试' });
              return;
            }
            // 第 3 步：拉起支付
            this.requestPay(r.data, r.data && r.data.outTradeNo);
          })
          .catch((err) => {
            // 网络层失败 / 云函数不存在
            console.error('[vip] callFunction 异常', err);
            this.setData({ paying: false, error: '下单失败，请检查网络后重试' });
          });
      },
      fail: () => {
        this.setData({ paying: false, error: '获取登录凭证失败，请重试' });
      },
    });
  },

  /**
   * 第 3 步：wx.requestVirtualPayment
   * ⚠️ success 回调「可能丢失」，绝不能在这里直接开通会员。
   *    这里只做：提示 + 延时兜底查单。
   */
  requestPay(payData, outTradeNo) {
    if (!payData || !payData.payData) {
      this.setData({ paying: false, error: '支付参数异常，请重试' });
      return;
    }

    wx.requestVirtualPayment({
      mode: payData.payData.mode,
      signData: payData.payData.signData,
      paySig: payData.payData.paySig,
      signature: payData.payData.signature,
      success: () => {
        // 弱确认：只提示，不发权益
        wx.showToast({ title: '支付完成', icon: 'success' });
        this.setData({ paying: false });
        // 发货推送/查单可能还没同步完，延时兜底查一次，让用户立刻看到结果。
        // 就算这一步丢了也不要紧 —— 云函数 queryMember 自带扫单补发货。
        setTimeout(() => this.confirmOrder(outTradeNo), 1500);
      },
      fail: (err) => {
        this.setData({ paying: false });
        const msg = (err && err.errMsg) || '';
        const code = err && err.errCode;

        // ⚠️ 这里原本只判断字符串里有没有 cancel，把 errCode 整个丢掉了。
        //    微信给的错误码非常具体（-15006 paySig 错、-15010 道具没发布、
        //    -15013 价格不一致…），全丢掉就只剩「支付未完成，请重试」，
        //    等于让人蒙着眼睛排查。现在把错误码翻成能直接照做的提示。
        console.error('[vip] 支付失败', { errMsg: msg, errCode: code }, err);

        if (code === -2 || msg.indexOf('cancel') > -1) {
          wx.showToast({ title: '已取消支付', icon: 'none' });
          return;
        }
        this.setData({ error: payErrorText(code, msg) });
      },
      complete: () => {
        this.setData({ paying: false });
      },
    });
  },

  /**
   * 兜底查单（第 4 步）。
   * 正常主通道是平台的发货推送；这里应对「推送还没到」的窗口期。
   * 查完仍以云函数 queryMember 的结果为准。
   */
  confirmOrder(outTradeNo) {
    if (!outTradeNo) return;
    vip
      .verifyOrder(outTradeNo)
      .then(() => this.loadMember())
      .catch(() => {});
  },

  /** 手动刷新会员状态 */
  onRefreshState() {
    this.loadMember();
    wx.showToast({ title: '已刷新', icon: 'none', duration: 1000 });
  },

  /** 复制单号到剪贴板（凭证自证用） */
  onCopyNo(e) {
    const no = e.currentTarget.dataset.no;
    if (!no) return;
    wx.setClipboardData({ data: no });
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onOpenFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },
});
