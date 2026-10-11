// pages/history/history.js —— 工具使用记录（全部存在本机，不上传）
const util = require('../../utils/util.js');
const tools = require('../../utils/tools.js');
const history = require('../../utils/history.js');

Page({
  data: {
    list: [],
    count: 0,
    countText: '00',
    loading: true
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
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
   * 读取本地使用记录快照，并从注册表补全分类色等渲染字段。
   * 工具已下架时保留快照展示（点开时提示），不静默删除用户的记录。
   */
  refresh() {
    const local = history.getAll();
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
      path: (t && t.path) || item.path || '',
      categoryName: (cat && cat.name) || '',
      soft: (cat && cat.soft) || '#f5f0e8',
      color: (cat && cat.color) || '#8b8279',
      alive: !!t,
      timeText: item.usedAt ? util.fromNow(item.usedAt) : ''
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
    // 再次打开：把这条记录提到最前
    history.push({
      id: tool.id,
      name: tool.name,
      desc: tool.desc,
      icon: tool.icon,
      path: tool.path,
      category: tool.category
    });
    wx.navigateTo({ url: tool.path });
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    history.remove(id);
    this.refresh();
    wx.showToast({ title: '已移除', icon: 'none', duration: 1200 });
  },

  onClearAll() {
    wx.showModal({
      title: '清空使用记录',
      content: '清空后无法恢复，确定继续吗？',
      confirmText: '清空',
      confirmColor: '#b84827',
      success: (res) => {
        if (!res.confirm) return;
        history.clear();
        this.refresh();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  },

  onGoIndex() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
