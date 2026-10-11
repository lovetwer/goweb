// pages/tools/tools.js —— 工具目录
// 工具数据、分类与搜索均来自 utils/tools.js 本地注册表。
const util = require('../../utils/util.js');
const tools = require('../../utils/tools.js');
const history = require('../../utils/history.js');

Page({
  data: {
    toolTotal: 0,
    sections: [],
    keyword: '',
    searchFocus: false,
    results: []
  },

  onLoad() {
    this.buildRegistry();
    this._debouncedSearch = util.debounce(() => this.runSearch(), 300);
  },

  buildRegistry() {
    const sections = tools.getSections().map((section) => ({
      key: section.category.key,
      name: section.category.name,
      en: section.category.en,
      color: section.category.color,
      tools: section.tools.map((tool, index) => Object.assign(tool, { no: index + 1 }))
    }));
    this.setData({
      toolTotal: tools.count(),
      sections,
      results: this.data.keyword ? tools.searchTools(this.data.keyword) : []
    });
  },

  onShareAppMessage() {
    return {
      title: '工具箱 · 实用小工具都在这儿',
      path: '/pages/tools/tools'
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
  }
});
