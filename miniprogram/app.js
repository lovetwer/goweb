// app.js
// 全站无登录、无授权、不获取任何用户信息。
const config = require('./config.js');

App({
  globalData: {
    db: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[goweb] 当前基础库版本过低，请使用 2.2.3 及以上基础库以使用云能力');
      return;
    }

    // 云能力初始化：不传 traceUser，避免采集用户信息
    wx.cloud.init({
      env: config.ENV_ID,
      traceUser: false
    });

    this.globalData.db = wx.cloud.database({
      env: config.ENV_ID
    });
  },

  /**
   * 统一的数据库句柄获取方法
   * @returns {object|null} 云开发数据库实例
   */
  getDB() {
    if (!this.globalData.db && wx.cloud) {
      wx.cloud.init({ env: config.ENV_ID, traceUser: false });
      this.globalData.db = wx.cloud.database({ env: config.ENV_ID });
    }
    return this.globalData.db;
  },

  onError(err) {
    console.error('[goweb] App onError:', err);
  }
});
