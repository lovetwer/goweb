// pages/favorites/favorites.js
// 收藏完全存在本地（wx.setStorageSync），不上传、不联网、不涉及任何用户信息。
// 收藏对象是工具（utils/tools.js 注册表），存的是工具快照。
const util = require('../../utils/util.js');
const tools = require('../../utils/tools.js');
const favorites = require('../../utils/favorites.js');
const history = require('../../utils/history.js');

Page({
  data: {
    list: [],
    loading: true,
    count: 0,
    countText: '00'
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  onShareAppMessage() {
    return {
      title: '工具箱 · 实用小工具都在这儿',
      path: '/pages/index/index'
    };
  },

  onShareTimeline() {
    return {
      title: '工具箱 · 实用小工具都在这儿',
      query: ''
    };
  },

  /**
   * 读取本地收藏快照，并从注册表补全分类色等渲染字段。
   * 工具已下架时保留快照展示（点开时提示），不静默删除用户的收藏。
   */
  refresh() {
    const local = favorites.getAll();
    this.setData({
      list: local.map((item) => this.decorate(item)),
      count: local.length,
      countText: local.length < 10 ? `0${local.length}` : `${local.length}`,
      loading: false
    });
  },

  decorate(raw) {
    const item = raw || {};
    const t = tools.getTool(item.id);
    const cat = tools.getCategory(item.category);
    return {
      id: item.id,
      name: (t && t.name) || item.name || '未命名工具',
      desc: (t && t.desc) || item.desc || '',
      icon: (t && t.icon) || item.icon || util.firstChar(item.name),
      image: (t && t.image) || item.image || '',
      path: (t && t.path) || item.path || '',
      categoryName: (cat && cat.name) || '',
      soft: (cat && cat.soft) || '#f4e7e8',
      color: (cat && cat.color) || '#8c7b91',
      alive: !!t,
      addedText: item.addedAt ? util.fromNow(item.addedAt) : ''
    };
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const tool = tools.getTool(id);
    if (!tool) {
      wx.showToast({ title: '该工具已下架', icon: 'none', duration: 1500 });
      return;
    }
    // 从收藏进入也算一次使用：记录历史后再跳转
    history.push({
      id: tool.id,
      name: tool.name,
      desc: tool.desc,
      icon: tool.icon,
      image: tool.image,
      path: tool.path,
      category: tool.category
    });
    wx.navigateTo({ url: tool.path });
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    favorites.remove(id);
    this.refresh();
    wx.showToast({ title: '已取消收藏', icon: 'none', duration: 1200 });
  },

  onClearAll() {
    if (!this.data.count) return;
    wx.showModal({
      title: '清空收藏',
      content: `确定要清空全部 ${this.data.count} 条本地收藏吗？收藏只存在这台设备上，清空后无法恢复。`,
      confirmText: '清空',
      confirmColor: '#a97079',
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
