/**
 * config.js —— 全局唯一配置入口
 *
 * 工具箱版本：工具全部内置在小程序包里（utils/tools.js 注册表），
 * 首页、收藏、历史、搜索都不再依赖云数据库。
 * 云能力只保留两条链路：
 *   1. 意见反馈（用户提交 → 云函数校验 → 入库）
 *   2. 会员体系（虚拟支付 / 查会员 / 查订单，全走云函数）
 */

module.exports = {
  // ⚠️ 必填：你的云开发环境 ID（反馈与会员两条云函数链路共用）
  ENV_ID: 'cloud1-d9g8pk8fs1d3149d7',

  // 意见反馈（用户提交 → 云函数校验 → 入库）
  //   FEEDBACK_FUNCTION   云函数名，非空校验 + 内容安全全在云函数里做
  //   FEEDBACK_COLLECTION 反馈记录集合（⚠️ 权限必须设为「仅管理端可读写」）
  //   记录里会写入 _openid 用于区分反馈来源（匿名标识，换小程序即不同，无法联系用户本人）
  FEEDBACK_FUNCTION: 'feedback',
  FEEDBACK_COLLECTION: 'feedback',

  // 本地收藏存储 key（存的是工具快照，仅保存在用户手机上）
  FAVORITES_KEY: 'toolbox_favorites',

  // 本地使用记录存储 key（最近用过哪些工具，仅保存在用户手机上）
  HISTORY_KEY: 'toolbox_history',

  /* ============================================================
   * 会员（虚拟支付 · 道具直购）
   * ============================================================
   * ⚠️ 安全边界：这个文件会打进小程序包，**绝对不能**放 OfferID / AppKey /
   * AppSecret / sessionKey。这些只在 cloudfunctions/vip/secret.json 里。
   * 前端只拿得到针对单次订单的签名（signData / paySig / signature），用完即弃。
   *
   * 会员状态只有一种来源：云函数 queryMember（按真实 openid 判定）。
   * 未开通就是非会员，界面显示锁定态——这是正确行为，不是 bug。
   */
  VIP_ENABLED: true,

  // 虚拟支付云函数名（下单 / 查会员 / 兜底查单都走它）
  VIP_FUNCTION: 'vip',

  // 会员数据本地缓存 key（只存「是不是会员 + 到期时间」，不含任何身份信息）
  VIP_STATE_KEY: 'toolbox_vip_state',

  /**
   * 会员权益
   * 这里是「展示用」的文案；**真实权益判定在云函数**。
   * 工具箱语境下，会员权益指向「会员专属工具」——具体哪些工具标记为
   * 会员专属，等工具上架后在 utils/tools.js 的 vipOnly 字段里定义。
   */
  VIP_BENEFITS: {
    month: '解锁全部会员专属工具',
    year: '解锁全部会员专属工具',
    footer: '会员专属工具持续上新，会员可优先体验新工具'
  },

  // 会员到期前多少天开始提醒（天）
  VIP_RENEW_REMIND_DAYS: 7
};
