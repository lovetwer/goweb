// pages/beauty/beauty.js —— 颜值分析 · 工具首页（功能介绍 + 隐私提示 + 开始按钮）
const util = require('../../utils/util.js');

Page({
  data: {
    privacyExpanded: false
  },

  onShareAppMessage() {
    return {
      title: '工具箱 · 颜值分析（仅供娱乐参考）',
      path: '/pages/beauty/beauty'
    };
  },

  onShareTimeline() {
    return {
      title: '工具箱 · 颜值分析（仅供娱乐参考）',
      query: ''
    };
  },

  onTogglePrivacy() {
    this.setData({ privacyExpanded: !this.data.privacyExpanded });
  },

  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  },

  onStart() {
    wx.navigateTo({ url: '/pages/beauty-analyze/beauty-analyze' });
  }
});
