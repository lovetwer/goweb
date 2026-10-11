// pages/beauty-analyze/beauty-analyze.js —— 选图 → 压缩校正 → 上传 → 云函数分析
//
// 照片链路（全程不留存）：
//   wx.chooseMedia（压缩模式）→ OffscreenCanvas 归一化
//   （校正 EXIF 方向 + 最长边 720px + 统一 JPEG，失败则回退原图）
//   → 上传云存储临时目录 → 调云函数 beauty → 云函数用完即删
const util = require('../../utils/util.js');

const MAX_EDGE = 720;          // 归一化后最长边（像素）
const JPEG_QUALITY = 0.85;     // 画布导出质量
const AVATAR_SIZE = 256;       // 本机漫画头像尺寸

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** 按云端仅临时返回的人脸框扩出头像裁切区域，不将照片再上传。 */
function getAvatarCrop(imageWidth, imageHeight, faceBox) {
  const minSide = Math.min(imageWidth, imageHeight);
  let size = minSide * 0.78;
  let centerX = imageWidth / 2;
  let centerY = imageHeight * 0.44;

  if (faceBox && Number(faceBox.width) > 0 && Number(faceBox.height) > 0) {
    const faceWidth = clamp(Number(faceBox.width), 1, imageWidth);
    const faceHeight = clamp(Number(faceBox.height), 1, imageHeight);
    const faceX = clamp(Number(faceBox.x) || 0, 0, imageWidth - faceWidth);
    const faceY = clamp(Number(faceBox.y) || 0, 0, imageHeight - faceHeight);
    centerX = faceX + faceWidth / 2;
    centerY = faceY + faceHeight * 0.42;
    size = Math.min(minSide, Math.max(faceWidth * 1.7, faceHeight * 1.34));
  } else {
    size = Math.min(minSide, size);
  }

  return {
    x: clamp(centerX - size / 2, 0, imageWidth - size),
    y: clamp(centerY - size / 2, 0, imageHeight - size),
    size
  };
}

/** 轻量本机漫画化：提升色彩、分色并勾出柔和轮廓，不调用外部图像服务。 */
function cartoonize(ctx) {
  const imageData = ctx.getImageData(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const pixels = imageData.data;
  const luminance = new Uint8Array(AVATAR_SIZE * AVATAR_SIZE);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    luminance[p] = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
  }

  for (let y = 1; y < AVATAR_SIZE - 1; y += 1) {
    for (let x = 1; x < AVATAR_SIZE - 1; x += 1) {
      const p = y * AVATAR_SIZE + x;
      const i = p * 4;
      const edge = Math.abs(luminance[p + 1] - luminance[p - 1]) +
        Math.abs(luminance[p + AVATAR_SIZE] - luminance[p - AVATAR_SIZE]);
      const shade = edge > 118 ? 0.62 : (edge > 72 ? 0.84 : 1);
      const average = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      const quantize = (channel, warm) => {
        const saturated = clamp((average + (channel - average) * 1.12 + warm) * shade, 0, 255);
        return Math.round(saturated / 255 * 7) * 255 / 7;
      };
      pixels[i] = quantize(pixels[i], 5);
      pixels[i + 1] = quantize(pixels[i + 1], 1);
      pixels[i + 2] = quantize(pixels[i + 2], -2);
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

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
      path: '/pages/beauty-analyze/beauty-analyze'
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
      this.setData({ statusText: '正在上传照片…' });
      const cloudPath = `beauty-tmp/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: localFile });
      if (!up || !up.fileID) {
        throw { friendly: '上传失败，请检查网络后重试' };
      }

      // 3. 调云函数分析（云函数负责删除云端临时文件）
      this.setData({ statusText: '正在细看照片里的五官…' });
      const res = await wx.cloud.callFunction({ name: 'beauty', data: { fileID: up.fileID } });
      const r = (res && res.result) || {};
      if (r.code !== 0 || !r.data) {
        // debug 字段是排查用的真实错误码（上线稳定后可去掉）
        throw { friendly: r.msg + (r.debug ? `（${r.debug}）` : '') };
      }

      // 4. 成功后用本机照片制作漫画头像；该步骤失败不影响分析结果。
      const resultData = Object.assign({}, r.data);
      const faceBox = resultData.faceBox;
      delete resultData.faceBox;
      this.setData({ statusText: '正在把照片画成Q版头像…' });
      try {
        resultData.avatarPath = await this.createQAvatar(localFile, faceBox);
      } catch (avatarError) {
        resultData.avatarPath = '';
        console.warn('[beauty] 本机漫画头像生成失败：', avatarError && avatarError.message);
      }

      // 5. 成功 → 结果页
      this.setData({ analyzing: false, statusText: '' });
      this.gotoResult(resultData);
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

  /** 在本机用人脸框裁切一张柔和漫画头像；生图失败不影响颜值分析结果。 */
  createQAvatar(src, faceBox) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src,
        success: (info) => {
          try {
            const width = Math.max(1, Number(info.width) || 1);
            const height = Math.max(1, Number(info.height) || 1);
            const crop = getAvatarCrop(width, height, faceBox);
            const canvas = wx.createOffscreenCanvas({ type: '2d', width: AVATAR_SIZE, height: AVATAR_SIZE });
            const ctx = canvas.getContext('2d');
            const image = canvas.createImage();

            image.onload = () => {
              try {
                ctx.fillStyle = '#f8e8e2';
                ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
                ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
                try {
                  cartoonize(ctx);
                } catch (filterError) {
                  // 较旧设备若不支持像素读写，至少保留本机裁切头像。
                  console.warn('[beauty] 漫画滤镜不可用，使用裁切头像：', filterError && filterError.message);
                }

                // 柔白内圈，让头像放进结果页的圆形相框时边缘更干净。
                ctx.beginPath();
                ctx.arc(AVATAR_SIZE / 2, AVATAR_SIZE / 2, AVATAR_SIZE / 2 - 3, 0, Math.PI * 2);
                ctx.lineWidth = 6;
                ctx.strokeStyle = '#fffaf5';
                ctx.stroke();

                const dataUrl = canvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                const avatarPath = `${wx.env.USER_DATA_PATH}/beauty_avatar_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`;
                wx.getFileSystemManager().writeFileSync(avatarPath, base64, 'base64');
                resolve(avatarPath);
              } catch (e) {
                reject(e);
              }
            };
            image.onerror = reject;
            image.src = src;
          } catch (e) {
            reject(e);
          }
        },
        fail: reject
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
      fail: () => {
        try {
          wx.removeStorageSync('beauty_result_tmp');
        } catch (e) {
          /* 忽略 */
        }
        if (data.avatarPath && data.avatarPath.indexOf(wx.env.USER_DATA_PATH) === 0) {
          try {
            wx.getFileSystemManager().unlinkSync(data.avatarPath);
          } catch (e) {
            /* 临时目录由微信后续清理 */
          }
        }
        wx.showToast({ title: '结果页暂时打不开，请重试', icon: 'none' });
      }
    });
  },

  onOpenAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' });
  }
});
