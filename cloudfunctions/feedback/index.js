// 云函数 feedback —— 用户意见反馈
//
// 小程序端调用：
//   wx.cloud.callFunction({ name: 'feedback', data: { action: 'submit', content: 'xxx' } })
//
// 设计说明：
//   1. 不设字数上下限：用户想写多长写多长（前端也不截断）。唯一的门槛是非空。
//   2. 记录 openid（写入 _openid）：openid 是匿名的用户标识，只在当前小程序内唯一，
//      换个小程序就是另一个值，无法反向关联到真人，不属于敏感个人信息。
//      用途仅两点：① 区分反馈来自哪个人；② msgSecCheck v2 要求必传 openid。
//      ⚠️ 云函数以管理员身份写入时，_openid 不会自动带上，必须手动写入。
//   3. 内容安全照做：反馈属 UGC，入库前必须过 security.msgSecCheck，
//      否则提审会被拒（常见驳回理由：「涉及 UGC 自定义发布内容，但未接入内容安全识别能力」）。
//   4. 写库走云函数的管理员权限，集合权限设为「仅管理端可读写」，
//      客户端绕不过云函数，下面的校验才不会被跳过。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLL = 'feedback';

exports.main = async (event) => {
  const action = (event && event.action) || 'submit';
  if (action !== 'submit') return { code: -3, msg: '未知操作' };

  // 基础归一化：行首行尾空白去掉，连续空格压成一个，连续空行最多留一行
  const content = String((event && event.content) || '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  /* ---------- 校验：非空（唯一的门槛） ---------- */
  if (!content) return { code: 1, msg: '请先写点什么' };

  // msgSecCheck 的正文上限是 2500 字，超了接口会直接报错。
  // 这里只做"送检前"的截断，入库仍存完整内容（不限字数，只是想写多少写多少）。
  const toCheck = content.length > 2500 ? content.slice(0, 2500) : content;

  /* ---------- 用户标识 + 内容安全（UGC 必需，scene=2 评论/留言） ----------
     openid 有两个用途：① 写入 _openid 用于区分反馈来自哪个人；
     ② msgSecCheck v2 的 openid 是【必填】参数，官方要求传"近两小时访问过小程序的用户"的
     真实 openid，传占位字符串会直接返回 40003 invalid openid。 */
  const wxCtx = cloud.getWXContext();
  const OPENID = wxCtx && wxCtx.OPENID;
  if (!OPENID) return { code: -1, msg: '无法识别用户，请稍后重试' };

  try {
    const r = await cloud.openapi.security.msgSecCheck({
      content: toCheck,
      version: 2,
      scene: 2,
      openid: OPENID
    });
    // 云调用命中风险内容时不一定抛异常，返回体里带 suggest 也要拦
    const suggest = r && r.result && r.result.suggest;
    if (suggest && suggest !== 'pass') {
      return { code: 5, msg: '内容包含不当信息，请修改后再提交' };
    }
  } catch (e) {
    const errCode = e && (e.errCode || e.errcode);
    if (errCode === 87014) return { code: 5, msg: '内容包含不当信息，请修改后再提交' };
    // 把真实 errCode / errMsg 带回前端，方便定位（提审前可改回统一文案）
    return {
      code: -6,
      msg: '内容校验失败',
      debug: {
        errCode: errCode || null,
        errMsg: (e && (e.errMsg || e.errmsg)) || String(e),
        stage: 'msgSecCheck'
      }
    };
  }

  /* ---------- 写库 ----------
     ⚠️ 云函数以管理员身份写入时 _openid 不会自动带上，必须手动写入。
     客户端在「仅管理端可读写」权限下读不到这个字段，只有云函数和管理端能取到。 */
  try {
    await db.collection(COLL).add({
      data: {
        _openid: OPENID,
        content: content,
        createTime: db.serverDate()
      }
    });
  } catch (e) {
    return { code: -7, msg: '保存失败，请稍后重试' };
  }

  return { code: 0, msg: '已收到，谢谢你的反馈' };
};
