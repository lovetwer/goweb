// pages/favorites/favorites.js
// 收藏完全存在本地（wx.setStorageSync），不上传、不联网、不涉及任何用户信息。
const app = getApp();
const config = require('../../config.js');
const util = require('../../utils/util.js');
const favorites = require('../../utils/favorites.js');

Page({
  data: {
    list: [],
    loading: true,
    count: 0
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  /**
   * 读取本地收藏，并尽量从数据库补齐最新的封面 / 简介
   * （补齐失败不影响展示：本地快照本身就是完整可用的数据）
   */
  refresh() {
    const local = favorites.getAll();
    this.setData({
      list: local.map((item) => this.decorate(item)),
      count: local.length,
      loading: false
    });

    if (!local.length) return Promise.resolve();

    const db = app.getDB();
    if (!db) return Promise.resolve();

    const ids = local.map((item) => item.id).filter(Boolean);
    if (!ids.length) return Promise.resolve();

    return db
      .collection(config.COLLECTION)
      .where({ _id: db.command.in(ids) })
      .field({ name: true, url: true, category: true, description: true, coverUrl: true })
      .limit(100)
      .get()
      .then((res) => {
        const fresh = {};
        ((res && res.data) || []).forEach((item) => {
          fresh[item._id] = item;
        });
        const merged = local.map((item) => {
          const latest = fresh[item.id];
          return this.decorate(latest ? Object.assign({}, item, latest, { _id: item.id }) : item);
        });
        this.setData({ list: merged });
      })
      .catch((err) => {
        // 静默失败：离线或权限问题时依然展示本地快照
        console.warn('[favorites] 补齐最新信息失败，使用本地快照', err);
      });
  },

  decorate(item) {
    const raw = item || {};
    return {
      _id: raw._id || raw.id,
      name: raw.name || '未命名网站',
      url: raw.url || '',
      category: raw.category || '未分类',
      description: raw.description || '暂无简介',
      coverUrl: raw.coverUrl || '',
      hasCover: !!raw.coverUrl,
      initial: util.firstChar(raw.name),
      bgColor: util.colorOf(raw.name),
      addedText: raw.addedAt ? util.fromNow(raw.addedAt) : ''
    };
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    favorites.remove(id);
    this.refresh();
    wx.showToast({ title: '已取消收藏', icon: 'none', duration: 1200 });
  },

  onCoverError(e) {
    const id = e.currentTarget.dataset.id;
    const index = this.data.list.findIndex((item) => item._id === id);
    if (index < 0) return;
    this.setData({ [`list[${index}].hasCover`]: false });
  },

  onClearAll() {
    if (!this.data.count) return;
    wx.showModal({
      title: '清空收藏',
      content: `确定要清空全部 ${this.data.count} 条本地收藏吗？收藏只存在这台设备上，清空后无法恢复。`,
      confirmText: '清空',
      confirmColor: '#e5484d',
      cancelText: '再想想',
      success: (res) => {
        if (!res.confirm) return;
        favorites.clear();
        this.refresh();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  },

  onGoIndex() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
