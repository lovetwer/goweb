// pages/index/index.js —— 首页
// 首页保留快速搜索、最近使用与轻量推荐；完整工具目录位于「工具」Tab。
const util = require('../../utils/util.js');
const tools = require('../../utils/tools.js');
const history = require('../../utils/history.js');

const RECENT_MAX = 8;

Page({
  data: {
    toolTotal: 0,
    featuredTool: null,
    recent: [],
    keyword: '',
    searchFocus: false,
    results: []
  },

  onLoad() {
    this.buildRegistry();
    this._debouncedSearch = util.debounce(() => this.runSearch(), 300);
  },

  onShow() {
    this.setData({
      recent: this.decorateRecent(history.getAll().slice(0, RECENT_MAX))
    });
  },

  buildRegistry() {
    const first = tools.getAllTools()[0];
    this.setData({
      toolTotal: tools.count(),
      featuredTool: first ? tools.getTool(first.id) : null,
      results: this.data.keyword ? tools.searchTools(this.data.keyword) : []
    });
  },

  decorateRecent(list) {
    return list.map((item) => {
      const tool = tools.getTool(item.id);
      const category = tool || tools.getCategory(item.category) || {};
      return {
        id: item.id,
        name: item.name || '未命名工具',
        icon: (tool && tool.icon) || item.icon || util.firstChar(item.name),
        image: (tool && tool.image) || item.image || '',
        soft: category.soft || '#ffe9e1',
        color: category.color || '#967baa',
        alive: !!tool
      };
    });
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

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
    if (this._debouncedSearch) this._debouncedSearch();
  },

  onSearchConfirm() {
    this.runSearch();
  },

  onSearchFocus() {
    this.setData({ searchFocus: true });
  },

  onSearchBlur() {
    this.setData({ searchFocus: false });
  },

  onClearKeyword() {
    this.setData({ keyword: '', results: [] });
  },

  onReset() {
    this.onClearKeyword();
  },

  runSearch() {
    const keyword = util.trim(this.data.keyword);
    this.setData({ results: keyword ? tools.searchTools(keyword) : [] });
  },

  openTool(tool) {
    if (!tool || !tool.path) return;
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

  onToolTap(e) {
    const id = e.currentTarget.dataset.id;
    const tool = id && tools.getTool(id);
    if (tool) {
      this.openTool(tool);
      return;
    }
    wx.showToast({ title: '该工具已下架', icon: 'none', duration: 1500 });
  },

  onRecentTap(e) {
    const id = e.currentTarget.dataset.id;
    const tool = id && tools.getTool(id);
    if (tool) {
      this.openTool(tool);
      return;
    }
    wx.showToast({ title: '该工具已下架', icon: 'none', duration: 1500 });
  },

  onGoTools() {
    wx.switchTab({ url: '/pages/tools/tools' });
  }
});
