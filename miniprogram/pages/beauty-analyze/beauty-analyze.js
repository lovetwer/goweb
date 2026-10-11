// pages/beauty-analyze/beauty-analyze.js —— 选图 → 压缩校正 → 上传 → 云函数分析
//
// 照片链路（全程不留存）：
//   wx.chooseMedia（压缩模式）→ OffscreenCanvas 归一化
//   （校正 EXIF 方向 + 最长边 720px + 统一 JPEG，失败则回退原图）
//   → 上传云存储临时目录 → 调云函数 beauty → 云函数用完即删
const util = require('../../utils/util.js');

const MAX_EDGE = 720;          // 归一化后最长边（像素）
const JPEG_QUALITY = 0.85;     // 画布导出质量

Page({
  data: {
    imgPath: '',
    analyzing: false,
    errorText: '',
    // 分析中给用户的体感提示
    statusText: ''
  },

  onShareAppMessage() {
    return {
      title: '工具箱 · 颜值分析（仅供娱乐参考）',
      path: '/pages/beauty/beauty'
    };
  },

  /* ------------------------------ 选图 ------------------------------ */

  onChooseCamera() {
    this.choose('camera');
  },

  onChooseAlbum() {
    this.choose('album');
  },

  choose(sourceType) {
    if (this.data.analyzing) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [sourceType],
      sizeType: ['compressed'],
      camera: 'front',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        this.setData({ imgPath: file.tempFilePath, errorText: '' });
      },
      fail: () => {
        // 用户取消选图：不做任何操作（wx.chooseMedia 取消也会走 fail）
      }
    });
  },

  onRechoose() {
    if (this.data.analyzing) return;
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        this.choose(res.tapIndex === 0 ? 'camera' : 'album');
      },
      fail: () => {}
    });
  },

  onClearImage() {
    if (this.data.analyzing) return;
    this.setData({ imgPath: '', errorText: '' });
  },

  /* ------------------------------ 分析 ------------------------------ */

  async onAnalyze() {
    if (!this.data.imgPath || this.data.analyzing) return;

    this.setData({ analyzing: true, errorText: '', statusText: '正在处理照片…' });

    let localFile = null;
    try {
      // 1. 归一化：校正方向 + 缩放 + 统一 JPEG（分析准确的前提）
      localFile = await this.normalizeImage(this.data.imgPath);

      // 2. 上传云存储临时目录（分析完由云函数删除）
      this.setData({ statusText: '正在上传…' });
      const cloudPath = `beauty-tmp/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: localFile });
      if (!up || !up.fileID) {
        throw { friendly: '上传失败，请检查网络后重试' };
      }

      // 3. 调云函数分析（云函数负责删除云端临时文件）
      this.setData({ statusText: 'AI 分析中，约需 2~3 秒…' });
      const res = await wx.cloud.callFunction({ name: 'beauty', data: { fileID: up.fileID } });
      const r = (res && res.result) || {};
      if (r.code !== 0 || !r.data) {
        // debug 字段是排查用的真实错误码（上线稳定后可去掉）
        throw { friendly: r.msg + (r.debug ? `（${r.debug}）` : '') };
      }

      // 4. 成功 → 结果页
      this.setData({ analyzing: false, statusText: '' });
      this.gotoResult(r.data);
    } catch (e) {
      const msg = (e && e.friendly) || '网络异常，请稍后重试';
      this.setData({ errorText: msg, analyzing: false, statusText: '' });
    } finally {
      // 本地临时文件顺手清掉（微信本身也会清理）
      if (localFile && localFile.indexOf(wx.env.USER_DATA_PATH) === 0) {
        try {
          wx.getFileSystemManager().unlinkSync(localFile);
        } catch (e2) {
          /* 忽略 */
        }
      }
    }
  },

  /**
   * 归一化照片：OffscreenCanvas 画一遍，等效完成
   * EXIF 方向校正 + 最长边缩放到 720px + 重编码 JPEG。
   * 任一步失败则回退原图（chooseMedia 已带 compressed 压缩）。
   */
  normalizeImage(src) {
    return new Promise((resolve) => {
      wx.getImageInfo({
        src,
        success: async (info) => {
          try {
            const scale = Math.min(1, MAX_EDGE / Math.max(info.width, info.height));
            const w = Math.max(1, Math.round(info.width * scale));
            const h = Math.max(1, Math.round(info.height * scale));

            const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
            const ctx = canvas.getContext('2d');
            const img = canvas.createImage();
            await new Promise((res2, rej2) => {
              img.onload = res2;
              img.onerror = rej2;
              img.src = src;
            });
            ctx.drawImage(img, 0, 0, w, h);

            const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
            const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
            const path = `${wx.env.USER_DATA_PATH}/beauty_${Date.now()}.jpg`;
            wx.getFileSystemManager().writeFileSync(path, base64, 'base64');
            resolve(path);
          } catch (e) {
            resolve(src);
          }
        },
        fail: () => resolve(src)
      });
    });
  },

  /** 携结果跳结果页：eventChannel 主通道 + storage 兜底 */
  gotoResult(data) {
    try {
      wx.setStorageSync('beauty_result_tmp', JSON.stringify(data));
    } catch (e) {
      /* 存不上就只走 eventChannel */
    }
    wx.navigateTo({
      url: '/pages/beauty-result/beauty-result',
      success: (res) => {
        res.eventChannel.emit('beautyResult', data);
      },
      fail: () => {}
    });
  },

  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  }
});
