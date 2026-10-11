// pages/index/index.js —— 工具箱首页
// 数据全部来自 utils/tools.js 注册表（内置本地），无网络请求、无数据库查询。
const config = require('../../config.js');
const util = require('../../utils/util.js');
const tools = require('../../utils/tools.js');
const favorites = require('../../utils/favorites.js');
const history = require('../../utils/history.js');
const vip = require('../../utils/vip.js');

const RECENT_MAX = 8;

Page({
  data: {
    // 注册表状态
    toolTotal: 0,
    sections: [],

    // 最近使用（本地历史，最多 8 个）
    recent: [],

    // 搜索（本地过滤，300ms 防抖）
    keyword: '',
    searchFocus: false,
    results: [],

    // 收藏 / 历史入口角标
    favCount: 0,
    histCount: 0,

    // 会员（vipEnabled=false 时整块隐藏，页面上看不到任何会员痕迹）
    vipEnabled: config.VIP_ENABLED,
    isMember: false
  },

  onLoad() {
    this._isMember = false;

    this.buildRegistry();

    this._debouncedSearch = util.debounce(() => {
      this.runSearch();
    }, 300);
  },

  onShow() {
    // 从工具页 / 收藏页返回时同步本地计数与最近使用（纯本地存储，无网络请求）
    this.setData({
      favCount: favorites.count(),
      histCount: history.count(),
      recent: this.decorateRecent(history.getAll().slice(0, RECENT_MAX))
    });

    // 会员状态：从会员页返回时可能已变化
    if (config.VIP_ENABLED) {
      vip.refresh().then((state) => {
        const isMember = vip.isActive(state);
        if (this._isMember !== isMember) {
          this._isMember = isMember;
          this.setData({ isMember });
        }
      });
    }
  },

  /**
   * 从注册表构建首页分区数据。
   * 注册表为空时 sections=[]，页面显示「工具上架中」空状态。
   */
  buildRegistry() {
    const sections = tools.getSections().map((sec) => ({
      key: sec.category.key,
      name: sec.category.name,
      en: sec.category.en,
      color: sec.category.color,
      tools: sec.tools.map((t, i) => Object.assign(t, { no: i + 1 }))
    }));

    this.setData({
      toolTotal: tools.count(),
      sections,
      results: this.data.keyword ? tools.searchTools(this.data.keyword) : []
    });
  },

  decorateRecent(list) {
    return list.map((item) => {
      const t = tools.getTool(item.id);
      // 工具已下架时仍显示本地快照，但点击后提示
      const colorCat = t || tools.getCategory(item.category) || {};
      return {
        id: item.id,
        name: item.name || '未命名工具',
        icon: (t && t.icon) || item.icon || util.firstChar(item.name),
        image: (t && t.image) || item.image || '',
        soft: colorCat.soft || '#f4e7e8',
        color: colorCat.color || '#8c7b91',
        alive: !!t
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

  /* ------------------------------ 搜索 ------------------------------ */

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

  runSearch() {
    const kw = util.trim(this.data.keyword);
    if (!kw) {
      this.setData({ results: [] });
      return;
    }
    this.setData({ results: tools.searchTools(kw) });
  },

  onReset() {
    this.setData({ keyword: '', results: [] });
  },

  /* ------------------------------ 交互 ------------------------------ */

  /**
   * 打开工具：先记一笔使用历史（本地），再跳到工具页面。
   * @param {Object} tool 已装饰的工具对象（注册表条目或本地收藏/历史快照）
   */
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
    if (!id) return;
    const tool = tools.getTool(id);
    if (tool) {
      this.openTool(tool);
      return;
    }
    // 注册表里找不到：工具已下架
    wx.showToast({ title: '该工具已下架', icon: 'none', duration: 1500 });
  },

  onRecentTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const tool = tools.getTool(id);
    if (tool) {
      this.openTool(tool);
      return;
    }
    wx.showToast({ title: '该工具已下架', icon: 'none', duration: 1500 });
  },

  onVipTap() {
    wx.navigateTo({ url: '/pages/vip/vip' });
  },

  onFavEntryTap() {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  onHistoryTap() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  onFeedbackTap() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  onLegalTap() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  }
});
