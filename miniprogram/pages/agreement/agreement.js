// pages/agreement/agreement.js
// 纯静态展示页：隐私政策 + 用户协议，不含任何网络请求与用户信息获取。
// 隐私政策内容随功能变化更新（会员功能上线后新增了身份标识与支付相关条款）。
Page({
  data: {
    tab: 0, // 0 = 隐私政策，1 = 用户协议
    // 功能改版（网站导航 → 工具箱）时更新此日期
    updatedAt: '2026-10-11',
    // 与 config.VIP_ENABLED 无关：条款始终展示。
    // 理由是「有则必说」—— 开关关闭时页面无任何会员痕迹，但条款里保留说明，
    // 避免提审时政策与实际功能对不上被追问。
    hasVip: true
  },

  onTabTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.tab) return;
    this.setData({ tab: index });
  },

  onBackHome() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  }
});
