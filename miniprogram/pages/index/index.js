// pages/index/index.js
const app = getApp();
const config = require('../../config.js');
const util = require('../../utils/util.js');
const favorites = require('../../utils/favorites.js');

Page({
  data: {
    // 分类 Tab（编号在 onLoad 里预计算，WXML 里不再做表达式运算）
    categories: config.CATEGORIES || [],
    tabs: [],
    tabCount: (config.CATEGORIES || []).length + 1,
    activeIndex: 0,
    activeCategory: '',

    // 搜索
    keyword: '',
    searchFocus: false,

    // 列表
    sites: [],
    page: 0,
    pageSize: config.PAGE_SIZE,
    hasMore: false,
    loading: true,
    loadingMore: false,
    firstLoaded: false,
    errorText: '',

    // 统计
    totalText: '',

    // 收藏入口
    favCount: 0
  },

  onLoad() {
    this.setData({
      tabs: (config.CATEGORIES || []).map((name, i) => ({
        name,
        no: i < 9 ? `0${i + 1}` : `${i + 1}`
      }))
    });

    this._debouncedSearch = util.debounce(() => {
      this.loadData({ reset: true });
    }, config.SEARCH_DEBOUNCE || 300);

    this.loadData({ reset: true });
  },

  onShow() {
    // 从详情页返回时同步收藏数量（纯本地存储，无网络请求）
    this.setData({ favCount: favorites.count() });
  },

  onPullDownRefresh() {
    this.loadData({ reset: true }).then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) {
      this.loadData({ reset: false });
    }
  },

  onShareAppMessage() {
    return {
      title: '网站收录导航 · 好用的网站都在这儿',
      path: '/pages/index/index'
    };
  },

  /* ------------------------------ 交互 ------------------------------ */

  onSearchInput(e) {
    const keyword = util.trim(e.detail.value);
    this.setData({ keyword: e.detail.value });
    if (this._debouncedSearch) this._debouncedSearch(keyword);
  },

  onSearchConfirm() {
    if (this._debouncedSearch && this._debouncedSearch.cancel) this._debouncedSearch.cancel();
    this.loadData({ reset: true });
  },

  onSearchFocus() {
    this.setData({ searchFocus: true });
  },

  onSearchBlur() {
    this.setData({ searchFocus: false });
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.loadData({ reset: true });
  },

  onTabTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.activeIndex) return;
    const category = index === 0 ? '' : this.data.categories[index - 1];
    this.setData({ activeIndex: index, activeCategory: category });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    this.loadData({ reset: true });
  },

  onCardTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
  },

  onReset() {
    this.setData({ keyword: '', activeIndex: 0, activeCategory: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    this.loadData({ reset: true });
  },

  onRetry() {
    this.loadData({ reset: true });
  },

  onLoadMore() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadData({ reset: false });
    }
  },

  onFavEntryTap() {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  /**
   * 封面加载失败（常见于 fileID 不属于当前环境）→ 降级为色块占位
   */
  onCoverError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const index = this.data.sites.findIndex((item) => item._id === id);
    if (index < 0) return;
    const key = `sites[${index}].hasCover`;
    this.setData({ [key]: false });
  },

  /* ------------------------------ 数据 ------------------------------ */

  /**
   * 构建查询条件：分类过滤 + 名称/简介模糊搜索（db.RegExp）
   */
  buildWhere() {
    const db = app.getDB();
    const keyword = util.trim(this.data.keyword);
    const conditions = [];

    if (this.data.activeCategory) {
      conditions.push({ category: this.data.activeCategory });
    }

    if (keyword) {
      const reg = db.RegExp({
        regexp: util.escapeRegExp(keyword),
        options: 'i'
      });
      conditions.push(
        db.command.or([{ name: reg }, { description: reg }])
      );
    }

    if (!conditions.length) return {};
    if (conditions.length === 1) return conditions[0];
    return db.command.and(conditions);
  },

  /**
   * 加载站点列表
   * @param {{reset:boolean}} options reset=true 表示重新从第一页开始
   * @returns {Promise<void>}
   */
  loadData(options = {}) {
    const reset = !!options.reset;
    const db = app.getDB();

    if (!db) {
      this.setData({
        loading: false,
        firstLoaded: true,
        errorText: '云能力不可用，请检查基础库版本'
      });
      return Promise.resolve();
    }

    const page = reset ? 0 : this.data.page;
    this.setData(reset ? { loading: true, errorText: '' } : { loadingMore: true });

    const where = this.buildWhere();
    const collection = db.collection(config.COLLECTION);

    return collection
      .where(where)
      .count()
      .then((countRes) => {
        const total = (countRes && countRes.total) || 0;
        return collection
          .where(where)
          .field({
            name: true,
            url: true,
            category: true,
            description: true,
            coverUrl: true,
            createTime: true
          })
          .orderBy('createTime', 'desc')
          .skip(page * this.data.pageSize)
          .limit(this.data.pageSize)
          .get()
          .then((res) => ({ total, list: (res && res.data) || [] }));
      })
      .then(({ total, list }) => {
        const base = reset ? 0 : this.data.sites.length;
        const decorated = list.map((item, i) =>
          Object.assign(this.decorate(item), {
            no: base + i < 9 ? `0${base + i + 1}` : `${base + i + 1}`
          })
        );
        const sites = reset ? decorated : this.data.sites.concat(decorated);
        const loaded = (page + 1) * this.data.pageSize;

        this.setData({
          sites,
          page: page + 1,
          hasMore: loaded < total,
          loading: false,
          loadingMore: false,
          firstLoaded: true,
          errorText: '',
          totalText: this.buildTotalText(total)
        });
      })
      .catch((err) => {
        console.error('[index] 查询失败', err);
        const msg = this.friendlyError(err);
        this.setData({
          loading: false,
          loadingMore: false,
          firstLoaded: true,
          sites: reset ? [] : this.data.sites,
          errorText: msg,
          totalText: ''
        });
      });
  },

  buildTotalText(total) {
    const kw = util.trim(this.data.keyword);
    const cat = this.data.activeCategory;
    const parts = [];
    if (cat) parts.push(cat);
    if (kw) parts.push(`「${kw}」`);
    const prefix = parts.length ? `${parts.join(' · ')} ` : '';
    return `${prefix}共 ${total} 个网站`;
  },

  decorate(item) {
    const raw = item || {};
    return {
      _id: raw._id,
      name: raw.name || '未命名网站',
      url: raw.url || '',
      category: raw.category || '未分类',
      description: raw.description || '暂无简介',
      coverUrl: raw.coverUrl || '',
      createTime: raw.createTime,
      timeText: util.fromNow(raw.createTime),
      initial: util.firstChar(raw.name),
      bgColor: util.colorOf(raw.name),
      inkColor: util.inkOf(raw.name),
      hostText: this.hostOf(raw.url),
      hasCover: !!raw.coverUrl
    };
  },

  /**
   * 从 url 中取出域名，仅用于界面展示，不做任何跳转
   */
  hostOf(url) {
    const s = String(url || '');
    const m = s.match(/^(?:https?:\/\/)?([^\/?#]+)/i);
    return m ? m[1] : s;
  },

  friendlyError(err) {
    const msg = (err && (err.errMsg || err.message)) || '';
    if (/collection not exists|database collection/i.test(msg)) {
      return '还没有 sites 集合，请先在云开发控制台创建集合并导入示例数据';
    }
    if (/env/i.test(msg)) {
      return '云环境未配置，请在 config.js 里填写你的 ENV_ID';
    }
    if (/permission|access denied|-502005/i.test(msg)) {
      return '没有读取权限，请在云开发控制台把 sites 集合权限设为「所有用户可读」';
    }
    return '加载失败，请下拉刷新重试';
  }
});
