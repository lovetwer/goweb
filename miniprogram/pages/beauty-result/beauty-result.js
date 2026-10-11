// pages/beauty-result/beauty-result.js —— 分析结果展示（数据来自云函数，本地仅渲染）
Page({
  data: {
    ready: false,
    // 云函数返回的展示数据：score / bandTitle / age / gender / shapeText /
    // clarity / harmony / styleText / comments / uncertain
    result: null
  },

  onLoad() {
    let got = false;

    // 主通道：eventChannel
    const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ec && ec.on) {
      ec.on('beautyResult', (data) => {
        got = true;
        this.apply(data);
      });
    }

    // 兜底：eventChannel 偶发丢失时从 storage 读取（分析页写入的同一份）
    setTimeout(() => {
      if (got || this.data.ready) return;
      try {
        const raw = wx.getStorageSync('beauty_result_tmp');
        if (raw) {
          this.apply(typeof raw === 'string' ? JSON.parse(raw) : raw);
        }
      } catch (e) {
        /* 读不到就停留在空状态，用户可以返回重测 */
      }
    }, 150);
  },

  onUnload() {
    // 结果用完即清：不留分析数据或临时头像在本机。
    try {
      wx.removeStorageSync('beauty_result_tmp');
    } catch (e) {
      /* 忽略 */
    }
    const avatarPath = this.data.result && this.data.result.avatarPath;
    if (avatarPath && wx.env && avatarPath.indexOf(wx.env.USER_DATA_PATH) === 0) {
      try {
        wx.getFileSystemManager().unlinkSync(avatarPath);
      } catch (e) {
        /* 临时目录由微信后续清理 */
      }
    }
  },

  apply(data) {
    if (!data || !data.score) return;
    this.setData({ ready: true, result: data });
  },

  onShareAppMessage() {
    return {
      title: '我用工具箱测了下颜值，你也来试试（仅供娱乐）',
      path: '/pages/beauty-analyze/beauty-analyze'
    };
  },

  onShareTimeline() {
    return {
      title: '工具箱 · 颜值分析（仅供娱乐参考）',
      query: ''
    };
  },

  /** 再测一张：回到分析页重新选图 */
  onRetake() {
    wx.redirectTo({ url: '/pages/beauty-analyze/beauty-analyze' });
  }
});
