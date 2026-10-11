// app.js
// 全站无登录、无授权、不获取任何用户信息。
// 工具箱版本：工具全部内置本地，云能力只服务「意见反馈」与「会员」两条链路。
const config = require('./config.js');

App({
  globalData: {
    db: null
  },

  onLaunch() {
    if (!wx.cloud) {
      return;
    }

    // 云能力初始化：不传 traceUser，避免采集用户信息
    // （反馈提交走云函数 feedback，会员走云函数 vip，工具本身完全离线）
    wx.cloud.init({
      env: config.ENV_ID,
      traceUser: false
    });

    // 右上角菜单开启「发送给朋友 + 分享到朋友圈」两个入口
    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: false,
        menus: ['shareAppMessage', 'shareTimeline']
      });
    }
  },

  /**
   * 统一的数据库句柄获取方法
   * 当前唯一用途：会员页直查 vip_plans 集合展示套餐价格
   * （真实扣费以云函数下单时读取的数据库价格为准）。
   * @returns {object|null} 云开发数据库实例
   */
  getDB() {
    if (!this.globalData.db && wx.cloud) {
      wx.cloud.init({ env: config.ENV_ID, traceUser: false });
      this.globalData.db = wx.cloud.database({ env: config.ENV_ID });
    }
    return this.globalData.db;
  },

  onError() {}
});
