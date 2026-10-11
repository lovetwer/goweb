// pages/mine/mine.js —— 我的
const config = require('../../config.js');
const favorites = require('../../utils/favorites.js');
const history = require('../../utils/history.js');
const vip = require('../../utils/vip.js');

Page({
  data: {
    favoriteCount: 0,
    historyCount: 0,
    vipEnabled: config.VIP_ENABLED,
    isMember: false
  },

  onShow() {
    this.setData({
      favoriteCount: favorites.count(),
      historyCount: history.count(),
      isMember: vip.isActive(vip.currentState())
    });

    if (config.VIP_ENABLED && wx.cloud) {
      vip.refresh().then((state) => {
        this.setData({ isMember: vip.isActive(state) });
      });
    }
  },

  onShareAppMessage() {
    return {
      title: '工具箱 · 把日常收好',
      path: '/pages/index/index'
    };
  },

  onFavoritesTap() {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  onHistoryTap() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  onVipTap() {
    wx.navigateTo({ url: '/pages/vip/vip' });
  },

  onFeedbackTap() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  onLegalTap() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  }
});
