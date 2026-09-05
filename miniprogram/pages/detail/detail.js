// pages/detail/detail.js
const app = getApp();
const config = require('../../config.js');
const util = require('../../utils/util.js');
const favorites = require('../../utils/favorites.js');

Page({
  data: {
    id: '',
    site: null,
    loading: true,
    errorText: '',
    isFavorite: false,
    coverFailed: false,
    copied: false
  },

  onLoad(options) {
    const id = util.trim((options && options.id) || '');
    this.setData({ id });

    if (!id) {
      this.setData({
        loading: false,
        errorText: '缺少站点 id 参数'
      });
      return;
    }

    this.fetchSite(id);
  },

  onShow() {
    if (this.data.id) {
      this.setData({ isFavorite: favorites.has(this.data.id) });
    }
  },

  onShareAppMessage() {
    const site = this.data.site;
    return {
      title: site ? `${site.name} - ${site.category}` : '网站收录导航',
      path: `/pages/detail/detail?id=${encodeURIComponent(this.data.id)}`
    };
  },

  /* ------------------------------ 数据 ------------------------------ */

  /**
   * 按 id 查询 sites 集合（集合权限：所有用户可读，小程序端直接查，不走云函数）
   */
  fetchSite(id) {
    const db = app.getDB();
    if (!db) {
      this.setData({ loading: false, errorText: '云能力不可用，请检查基础库版本' });
      return;
    }

    this.setData({ loading: true, errorText: '' });

    db.collection(config.COLLECTION)
      .doc(decodeURIComponent(id))
      .get()
      .then((res) => {
        const raw = res && res.data;
        if (!raw) {
          this.setData({ loading: false, errorText: '这个网站可能已经被移除了' });
          return;
        }
        const site = this.decorate(raw);
        this.setData({
          site,
          loading: false,
          errorText: '',
          isFavorite: favorites.has(site._id)
        });
        // 页面标题：网站名 - 领域关键词
        this.setNavTitle(site);
      })
      .catch((err) => {
        console.error('[detail] 查询失败', err);
        const msg = ((err && (err.errMsg || err.message)) || '').toLowerCase();
        let text = '加载失败，请稍后重试';
        if (msg.indexOf('not exist') > -1 || msg.indexOf('-1 document') > -1) {
          text = '这个网站可能已经被移除了';
        } else if (msg.indexOf('permission') > -1 || msg.indexOf('access denied') > -1) {
          text = '没有读取权限，请在云开发控制台把 sites 集合权限设为「所有用户可读」';
        } else if (msg.indexOf('env') > -1) {
          text = '云环境未配置，请在 config.js 里填写你的 ENV_ID';
        }
        this.setData({ loading: false, errorText: text });
      });
  },

  decorate(raw) {
    const item = raw || {};
    return {
      _id: item._id,
      name: item.name || '未命名网站',
      url: item.url || '',
      category: item.category || '未分类',
      description: item.description || '暂无简介',
      coverUrl: item.coverUrl || '',
      createTime: item.createTime,
      timeText: util.formatDate(item.createTime, 'YYYY-MM-DD'),
      initial: util.firstChar(item.name),
      bgColor: util.colorOf(item.name),
      inkColor: util.inkOf(item.name),
      hasCover: !!item.coverUrl,
      hostText: this.hostOf(item.url)
    };
  },

  /**
   * 从 url 中取出域名，仅用于界面展示，不做任何跳转
   */
  hostOf(url) {
    const s = String(url || '');
    const m = s.match(/^(?:https?:\/\/)?([^/?#]+)/i);
    return m ? m[1] : s;
  },

  /**
   * wx.setNavigationBarTitle 把标题设为「网站名 - 领域关键词」
   * 领域关键词取站点分类；分类为空时退化为站点域名主词
   */
  setNavTitle(site) {
    const keyword = site.category || site.hostText || '网站详情';
    const title = `${site.name}${config.DETAIL_TITLE_SEP}${keyword}`;
    // 导航栏标题有长度限制，超长时截断
    const safeTitle = title.length > 30 ? `${title.slice(0, 29)}…` : title;
    wx.setNavigationBarTitle({
      title: safeTitle,
      fail: (err) => console.warn('[detail] setNavigationBarTitle 失败', err)
    });
  },

  onCoverError() {
    this.setData({ coverFailed: true });
  },

  onPreviewCover() {
    const site = this.data.site;
    if (!site || !site.coverUrl || this.data.coverFailed) return;
    wx.previewImage({
      urls: [site.coverUrl],
      current: site.coverUrl
    });
  },

  /* ------------------------------ 复制网址 ------------------------------ */

  onCopyUrl() {
    const site = this.data.site;
    if (!site || !site.url) {
      wx.showToast({ title: '暂无网址', icon: 'none' });
      return;
    }

    const done = () => {
      this.setData({ copied: true });
      wx.showToast({
        title: '网址已复制',
        icon: 'success',
        duration: 1500
      });
      setTimeout(() => {
        if (this.data.copied) this.setData({ copied: false });
      }, 2000);
    };

    wx.setClipboardData({
      data: site.url,
      success: done,
      fail: () => {
        // 极少数机型失败时兜底：系统 API 自身会弹提示，这里补一个轻提示
        wx.showToast({ title: '复制失败，请长按网址手动复制', icon: 'none' });
      }
    });
  },

  /**
   * 长按网址区域也可以复制（依然只有「复制」，没有任何跳转）
   */
  onUrlLongPress() {
    this.onCopyUrl();
  },

  /* ------------------------------ 收藏（本地存储） ------------------------------ */

  onToggleFavorite() {
    const site = this.data.site;
    if (!site) return;

    const added = favorites.toggle(site);
    this.setData({ isFavorite: added });

    wx.showToast({
      title: added ? '已加入收藏' : '已取消收藏',
      icon: 'none',
      duration: 1200
    });
  },

  onRetry() {
    if (this.data.id) this.fetchSite(this.data.id);
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
