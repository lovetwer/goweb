// pages/feedback/feedback.js  意见反馈
//
// 前端只做最基本的非空提示（前端校验都可以被绕过，真正拦得住的在服务端），
// 提交后由云函数做内容安全校验并入库。
// 说明：入库时会由云函数写入 _openid（微信匿名标识，换小程序即不同、无法关联真人），
//       仅用于区分反馈来源；小程序端不主动获取、也不持有该标识。

const config = require('../../config.js');

Page({
  data: {
    content: '',
    submitting: false,
    sent: false,     // 本次刚提交成功
    error: ''
  },

  onInput(e) {
    this.setData({
      content: (e && e.detail && e.detail.value) || '',
      error: ''
    });
  },

  onSubmit() {
    if (this.data.submitting) return;

    const text = String(this.data.content || '').trim();
    if (!text) {
      this.setData({ error: '请先写点什么' });
      return;
    }

    this.setData({ submitting: true, error: '' });
    wx.showLoading({ title: '提交中', mask: true });

    wx.cloud
      .callFunction({
        name: config.FEEDBACK_FUNCTION,
        data: { action: 'submit', content: text }
      })
      .then((res) => {
        wx.hideLoading();
        const r = (res && res.result) || {};

        if (r.code === 0) {
          this.setData({ submitting: false, sent: true, content: '' });
          wx.showToast({ title: '已收到，谢谢反馈', icon: 'success' });
          return;
        }

        const tip = r.debug
          ? (r.msg || '提交失败') + '（' + (r.debug.errCode || '?') + '）'
          : (r.msg || '提交失败，请稍后重试');

        this.setData({ submitting: false, error: tip });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false, error: '提交失败，请检查网络后重试' });
      });
  },

  // 提交成功后「再写一条」
  onAgain() {
    this.setData({ sent: false, content: '', error: '' });
  }
});
