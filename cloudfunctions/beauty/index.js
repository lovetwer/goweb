/**
 * cloudfunctions/beauty —— 颜值分析（娱乐向）· 腾讯云版
 *
 * 职责链路（照片用完即删，不落库、不留存、不建画像）：
 *   前端压缩后上传云存储临时文件 → 传 fileID 到本云函数
 *   → 下载文件转 base64 → 调腾讯云「人脸检测与分析」DetectFace
 *   → 解析 Beauty / Age / Gender / 质量分
 *   → 规则生成综合分（0~100）与预置评语
 *   → 无论成功失败，finally 里删除云存储临时文件
 *
 * 接口：iai.tencentcloudapi.com / DetectFace / Version 2020-03-03（人脸识别）
 *   - 每月 1 万次免费额度（自动发放），超出 0.0005 元/次
 *   - 返回字段：Gender(0女/1男)、Age、Beauty(0~100)、
 *     FaceQualityInfo.Score(质量分 0~100)、Occlusion、Completeness
 *   - 不返回脸型：用人脸框宽高比做娱乐向估算（瓜子脸/鹅蛋脸/圆脸）
 *
 * ⚠️ 合规红线：
 *   - 不调用微信人脸核身 / 活体检测等企业级接口；
 *   - 不保存照片、不保存人脸特征、不写入任何数据库集合；
 *   - 照片仅传输至腾讯云人脸识别接口完成当次分析。
 *
 * 密钥配置（二选一）：
 *   1. 复制 secret.example.json 为 secret.json，填入腾讯云 SecretId / SecretKey；
 *   2. 或在云函数「配置 → 环境变量」里设置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY。
 *   secret.json 优先级更高。⚠️ 密钥绝不放进小程序包。
 */

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/* ---------------------------------------------------------------- */
/* 腾讯云接口常量                                                    */
/* ⚠️ 注意：用「人脸识别」产品（iai），不是「人脸核身/慧眼」（faceid）。  */
/*    人脸核身需要企业实名认证；人脸识别个人实名即可开通。               */
/* ---------------------------------------------------------------- */

const TC_HOST = 'iai.tencentcloudapi.com';
const TC_SERVICE = 'iai';
const TC_VERSION = '2020-03-03';
const TC_ACTION = 'DetectFace';
const TC_REGION_DEFAULT = 'ap-guangzhou';

/* ---------------------------------------------------------------- */
/* 密钥                                                              */
/* ---------------------------------------------------------------- */

let cachedSecret = null;

function loadSecret() {
  if (cachedSecret) return cachedSecret;
  let fileSecret = {};
  try {
    fileSecret = require('./secret.json') || {};
  } catch (e) {
    fileSecret = {};
  }
  cachedSecret = {
    secretId: fileSecret.secretId || process.env.TENCENT_SECRET_ID || '',
    secretKey: fileSecret.secretKey || process.env.TENCENT_SECRET_KEY || '',
    region: fileSecret.region || process.env.TENCENT_REGION || TC_REGION_DEFAULT
  };
  return cachedSecret;
}

/** 业务级失败：带用户可读文案，不把技术细节暴露给前端（debug 仅进日志/排查用） */
function bizError(msg, code, debug) {
  const err = new Error(msg);
  err.code = code || 1;
  err.friendly = true;
  if (debug) err.debug = String(debug).slice(0, 150);
  return err;
}

/* ---------------------------------------------------------------- */
/* TC3-HMAC-SHA256 签名请求（原生 https + crypto，不引第三方依赖）      */
/* ---------------------------------------------------------------- */

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacBuf(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * 发起一次腾讯云 API v3 请求（POST，JSON body）
 * 签名流程：CanonicalRequest → StringToSign → kSigning → Authorization
 */
function tencentRequest(payload) {
  return new Promise((resolve, reject) => {
    const s = loadSecret();
    if (!s.secretId || !s.secretKey) {
      console.error('[beauty] 缺少腾讯云密钥：复制 secret.example.json 为 secret.json 并填写，或配置环境变量');
      reject(bizError('分析服务还没配置好，请稍后再试', 2));
      return;
    }

    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    // TC3 签名里的日期是 UTC 日期（YYYY-MM-DD）
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    const canonicalHeaders =
      `content-type:application/json; charset=utf-8\n` +
      `host:${TC_HOST}\n` +
      `x-tc-action:${TC_ACTION.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';

    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      sha256hex(body)
    ].join('\n');

    const stringToSign = [
      'TC3-HMAC-SHA256',
      String(timestamp),
      `${date}/${TC_SERVICE}/tc3_request`,
      sha256hex(canonicalRequest)
    ].join('\n');

    const kDate = hmacBuf('TC3' + s.secretKey, date);
    const kService = hmacBuf(kDate, TC_SERVICE);
    const kSigning = hmacBuf(kService, 'tc3_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authorization =
      `TC3-HMAC-SHA256 Credential=${s.secretId}/${date}/${TC_SERVICE}/tc3_request, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const req = https.request(
      {
        hostname: TC_HOST,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Host: TC_HOST,
          'X-TC-Action': TC_ACTION,
          'X-TC-Version': TC_VERSION,
          'X-TC-Region': s.region,
          'X-TC-Timestamp': String(timestamp),
          Authorization: authorization,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 20000
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(new Error('BAD_RESPONSE'));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('TIMEOUT'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ---------------------------------------------------------------- */
/* 人脸检测                                                          */
/* ---------------------------------------------------------------- */

async function detectFace(imageBase64) {
  // DetectFace：base64 图片 ≤ 5MB；NeedFaceAttributes 返回属性，NeedQualityDetection 返回质量
  // ⚠️ 这两个布尔参数实测必须传 uint64（1/0），传 JSON true/false 会报 InvalidParameter
  const res = await tencentRequest({
    Image: imageBase64,
    FaceModelVersion: '3.0',
    NeedFaceAttributes: 1,
    NeedQualityDetection: 1,
    MaxFaceNum: 10
  });

  const resp = (res && res.Response) || {};
  if (resp.Error) {
    console.error('[beauty] 腾讯云人脸检测失败：', resp.Error.Code, resp.Error.Message);
    const code = String(resp.Error.Code || '');
    // 服务未开通 / 账号未授权：单独给出可操作的提示
    if (/UnOpenError|NotSignedUp|IsolateAccountError|Unauthorized/i.test(code)) {
      throw bizError('分析服务还没配置好（腾讯云人脸识别服务未开通），请稍后再试', 2, code);
    }
    throw bizError(mapTencentError(code), 4, `${code} ${resp.Error.Message || ''}`);
  }
  return resp;
}

/** 腾讯云错误码 → 用户可读文案（不暴露技术细节） */
function mapTencentError(code) {
  const c = String(code || '');
  if (/NoFaceInPhoto|ImageFacedetectFailed/i.test(c)) return '未检测到人脸，请上传清晰的正面照片';
  if (/ImageDecodeFailed|InvalidFileContent|InvalidImage/i.test(c)) return '照片读取失败，请换一张重新试试';
  if (/LimitExceeded|RequestLimitExceeded|Throttling/i.test(c)) return '分析服务繁忙，请稍后再试';
  if (/^AuthFailure/i.test(c)) return '分析服务还没配置好，请稍后再试';
  if (/InternalError/i.test(c)) return '分析服务繁忙，请稍后再试';
  return '分析未能完成，请换一张清晰正脸照再试试';
}

/* ---------------------------------------------------------------- */
/* 结果加工：综合分 + 维度 + 预置评语（纯规则，不接大模型）              */
/* ---------------------------------------------------------------- */

// 腾讯 Gender：0-女，1-男
const GENDER_KEY = { 0: 'female', 1: 'male' };
const GENDER_TEXT = { female: '女', male: '男' };

// 脸型（人脸框宽高比娱乐向估算）
const SHAPE_HARMONY = { oval: 92, heart: 90, round: 86, square: 85, triangle: 84 };

// 气质风格规则表（性别 × 脸型）
const STYLE_MAP = {
  female: {
    oval: '温婉耐看的鹅蛋脸气质',
    heart: '精致小巧的瓜子脸气质',
    round: '圆润亲和的邻家气质',
    square: '大气利落的骨相气质',
    triangle: '灵动上镜的清瘦气质'
  },
  male: {
    oval: '清爽干净的少年感',
    heart: '轮廓分明的上镜感',
    round: '憨厚亲和的可靠感',
    square: '硬朗大气的型格',
    triangle: '清瘦利落的少年感'
  }
};

// 分数段评语（0~100 原始分制；预置文案，全部带娱乐参考语气；低分段归因于拍摄而非人脸本身）
const BAND_COMMENTS = [
  {
    min: 90,
    title: '气质出众',
    lines: [
      '整体气质在镜头前很能打，五官比例让人过目难忘。',
      '这份从容的状态，可不是每张照片都拍得出来的。'
    ]
  },
  {
    min: 78,
    title: '越看越顺眼',
    lines: [
      '五官舒展、比例耐看，属于越看越顺眼的长相。',
      '镜头缘不错，随手一拍就很有生活感。'
    ]
  },
  {
    min: 62,
    title: '自然耐看',
    lines: [
      '长相偏自然亲和型，是人群中让人放松下来的那一类。',
      '气质干净，笑起来的样子应该很有感染力。'
    ]
  },
  {
    min: 0,
    title: '别太当真',
    lines: [
      '这张照片更多是输给了角度和光线，换个光线好的正面照再来一张？',
      '单次分数不作数，状态好的时候随手一拍，结果可能完全不一样。'
    ]
  }
];

function clamp(v, min, max) {
  const n = Number(v) || 0;
  return Math.min(max, Math.max(min, n));
}

/** 腾讯云错误码 → 用户可读文案见 mapTencentError；这里只做展示结果 */
function buildResult(faceInfo) {
  const attrs = faceInfo.FaceAttributesInfo || {};
  const quality = faceInfo.FaceQualityInfo || {};

  const genderKey = GENDER_KEY[attrs.Gender] || '';
  const gender = GENDER_TEXT[genderKey] || '';

  const age = Math.round(clamp(attrs.Age, 0, 100));

  // Beauty：腾讯魅力分 [0~100]；取不到时用中性值并弱化确定性
  const beautyRaw = Number(attrs.Beauty);
  const beauty = beautyRaw >= 0 ? clamp(beautyRaw, 0, 100) : 75;
  const beautyUncertain = !(beautyRaw >= 0);

  // 脸型：DetectFace 不返回脸型，用人脸框 高/宽 比做娱乐向估算
  const boxW = Math.max(1, Number(faceInfo.Width) || 0);
  const boxH = Math.max(1, Number(faceInfo.Height) || 0);
  const ratio = boxH / boxW;
  let shapeKey;
  let shapeText;
  if (ratio >= 1.18) {
    shapeKey = 'triangle';
    shapeText = '瓜子脸';
  } else if (ratio <= 0.94) {
    shapeKey = 'round';
    shapeText = '圆脸';
  } else {
    shapeKey = 'oval';
    shapeText = '鹅蛋脸';
  }
  const harmony = SHAPE_HARMONY[shapeKey] || 85;

  // 清晰度：优先用腾讯质量分 Score(0~100)；缺失时用遮挡 + 完整度折算兜底
  let clarity = Math.round(clamp(quality.Score, 0, 100));
  if (!clarity) {
    const occ = quality.Occlusion || {};
    const occKeys = ['LeftEye', 'RightEye', 'Nose', 'Mouth', 'LeftCheek', 'RightCheek', 'Chin'];
    const occVals = occKeys.map((k) => clamp(occ[k], 0, 1));
    const occAvg = occVals.length ? occVals.reduce((a, b) => a + b, 0) / occVals.length : 0;
    const completeness = Number(quality.Completeness) === 1 ? 40 : 15;
    clarity = Math.round(clamp((1 - occAvg) * 60 + completeness, 30, 100));
  }

  // 综合分（0~100 原始分直出）：颜值 80% + 清晰度 10% + 脸型协调 10%
  const base = beauty * 0.8 + clarity * 0.1 + harmony * 0.1;
  const score = Math.round(clamp(base, 0, 100));

  const band = BAND_COMMENTS.find((b) => score >= b.min) || BAND_COMMENTS[BAND_COMMENTS.length - 1];
  const comments = band.lines.slice();

  // 清晰度一般：补充拍摄建议（把注意力引到拍摄质量上，弱化对人脸的评价）
  if (clarity < 70) {
    comments.push('这张照片的光线和清晰度还有提升空间，找个光线好的场景重拍，分数可能更亮眼。');
  }

  const styleText =
    genderKey && STYLE_MAP[genderKey] && STYLE_MAP[genderKey][shapeKey]
      ? STYLE_MAP[genderKey][shapeKey]
      : '耐看的镜头气质';

  return {
    score,
    title: pickTitle(score, genderKey),
    age,
    gender,
    shapeText,
    clarity,
    harmony,
    styleText,
    comments,
    // 置信度不足时前端弱化「精确感」
    uncertain: beautyUncertain
  };
}

/* ---------------------------------------------------------------- */
/* 称号系统：九个分数段 + 整活彩蛋区                                   */
/* g: '' 男女通用 / 'm' 男生专用 / 'f' 女生专用；选定时跳过性别不符项    */
/* ---------------------------------------------------------------- */

const TITLE_ZONES = [
  {
    min: 0, max: 29,
    titles: [
      { t: '女娲草稿', g: '' },
      { t: '上帝手滑作品', g: '' },
      { t: '女娲毕设废案', g: '' },
      { t: '吴彦祖未渲染版', g: 'm' },
      { t: '刘亦菲加载失败', g: 'f' },
      { t: '五官各自为政', g: '' },
      { t: '五官离家出走', g: '' },
      { t: '抽象派掌门人', g: '' },
      { t: '行走的表情包', g: '' },
      { t: '人类多样性样本', g: '' }
    ]
  },
  {
    min: 30, max: 49,
    titles: [
      { t: '丑萌天花板', g: '' },
      { t: '丑帅预备役', g: '' },
      { t: '丑帅潜力股', g: '' },
      { t: '抽象帅哥', g: 'm' },
      { t: '抽象美女', g: 'f' },
      { t: '喜剧脸担当', g: '' },
      { t: '安全感战神', g: 'm' },
      { t: '好人脸天花板', g: '' },
      { t: '丑得很有礼貌', g: '' },
      { t: '丑得挺洋气', g: '' }
    ]
  },
  {
    min: 50, max: 59,
    titles: [
      { t: '大众脸本脸', g: '' },
      { t: '路人甲气质', g: '' },
      { t: '普通但自信', g: '' },
      { t: '清秀未遂', g: '' },
      { t: '帅哥预科班', g: 'm' },
      { t: '美女预科班', g: 'f' },
      { t: '颜值潜力股', g: '' },
      { t: '五官努力型', g: '' },
      { t: '长相很有想法', g: '' },
      { t: '越看越顺眼型', g: '' }
    ]
  },
  {
    min: 60, max: 69,
    titles: [
      { t: '邻家普通款', g: '' },
      { t: '同学录大众脸', g: '' },
      { t: '耐看型选手', g: '' },
      { t: '干净顺眼型', g: '' },
      { t: '亲和力满分', g: '' },
      { t: '气质在线', g: '' },
      { t: '普通人天花板', g: '' },
      { t: '素人帅哥', g: 'm' },
      { t: '素人美女', g: 'f' },
      { t: '低调耐看型', g: '' }
    ]
  },
  {
    min: 70, max: 79,
    titles: [
      { t: '顺眼型选手', g: '' },
      { t: '阳光大男孩', g: 'm' },
      { t: '邻家甜妹', g: 'f' },
      { t: '氧气美女', g: 'f' },
      { t: '清爽男生', g: 'm' },
      { t: '温柔姐姐', g: 'f' },
      { t: '初恋脸', g: '' },
      { t: '盐系少年', g: 'm' },
      { t: '甜盐皆可', g: '' },
      { t: '氛围感选手', g: '' }
    ]
  },
  {
    min: 80, max: 84,
    titles: [
      { t: '小帅哥', g: 'm' },
      { t: '小美女', g: 'f' },
      { t: '校草', g: 'm' },
      { t: '校花', g: 'f' },
      { t: '撕漫男', g: 'm' },
      { t: '撕漫女', g: 'f' },
      { t: '侧颜杀手', g: '' },
      { t: '眉眼杀', g: '' },
      { t: '微笑唇', g: '' },
      { t: '下颌线战神', g: '' }
    ]
  },
  {
    min: 85, max: 89,
    titles: [
      { t: '大帅哥', g: 'm' },
      { t: '大美女', g: 'f' },
      { t: '行走的画报', g: '' },
      { t: '氛围感战神', g: '' },
      { t: '骨相美代表', g: '' },
      { t: '浓颜天菜', g: '' },
      { t: '淡颜天菜', g: '' },
      { t: '清冷美人', g: 'f' },
      { t: '阳光男神', g: 'm' },
      { t: '温柔女神', g: 'f' }
    ]
  },
  {
    min: 90, max: 94,
    titles: [
      { t: '吴彦祖分祖', g: 'm' },
      { t: '彭于晏分晏', g: 'm' },
      { t: '金城武分武', g: 'm' },
      { t: '刘德华分华', g: 'm' },
      { t: '梁朝伟分伟', g: 'm' },
      { t: '刘亦菲分菲', g: 'f' },
      { t: '高圆圆分圆', g: 'f' },
      { t: '王祖贤分贤', g: 'f' },
      { t: '林青霞分霞', g: 'f' },
      { t: '迪丽热巴分巴', g: 'f' }
    ]
  },
  {
    min: 95, max: 100,
    titles: [
      { t: '女娲毕设', g: '' },
      { t: '上帝炫技之作', g: '' },
      { t: '颜值天花板', g: '' },
      { t: '神颜降世', g: '' },
      { t: '吴彦祖本祖', g: 'm' },
      { t: '刘亦菲本菲', g: 'f' },
      { t: '建模脸', g: '' },
      { t: '电影脸', g: '' },
      { t: '杂志脸', g: '' },
      { t: '高级脸', g: '' }
    ]
  }
];

// 整活彩蛋区：小概率随机掉落，替换正常称号
const TITLE_EGG = [
  { t: '吴彦祖青春版', g: 'm' },
  { t: '吴彦祖 Pro Max', g: 'm' },
  { t: '刘亦菲体验版', g: 'f' },
  { t: '高圆圆试用装', g: 'f' },
  { t: '女娲开会员作品', g: '' },
  { t: '小说男主脸', g: 'm' },
  { t: '小说女主脸', g: 'f' },
  { t: '白月光', g: 'f' },
  { t: '朱砂痣', g: 'f' },
  { t: '防伪标志脸', g: '' }
];

const TITLE_EGG_CHANCE = 0.06;

/** 按性别过滤称号池：genderKey 是 'male'/'female'，称号标记是缩写 'm'/'f'，先归一再比对 */
function titlePool(titles, genderKey) {
  const g = genderKey === 'male' ? 'm' : genderKey === 'female' ? 'f' : '';
  if (!g) return titles;
  const filtered = titles.filter((x) => !x.g || x.g === g);
  return filtered.length ? filtered : titles;
}

/**
 * 按分数取称号：分数在段内的位置决定用第几个称号（同分同称号，越高越靠后）。
 * 6% 概率整活掉落彩蛋称号。
 */
function pickTitle(score, genderKey) {
  const g = genderKey === 'male' || genderKey === 'female' ? genderKey : '';

  if (Math.random() < TITLE_EGG_CHANCE) {
    const pool = titlePool(TITLE_EGG, g);
    return pool[Math.floor(Math.random() * pool.length)].t;
  }

  const zone = TITLE_ZONES.find((z) => score >= z.min && score <= z.max);
  if (!zone) return '神秘颜值选手';
  const pool = titlePool(zone.titles, g);
  const idx = Math.min(
    pool.length - 1,
    Math.floor(((score - zone.min) / (zone.max - zone.min + 1)) * pool.length)
  );
  return pool[idx].t;
}

/* ---------------------------------------------------------------- */
/* 入口                                                             */
/* ---------------------------------------------------------------- */

exports.main = async (event) => {
  const fileID = event && event.fileID;

  try {
    if (!fileID || typeof fileID !== 'string') {
      throw bizError('参数有误，请重新选择照片', 1);
    }

    // 1. 下载临时文件（前端已压缩，正常在 500KB 内；腾讯云 base64 上限 5MB）
    const dl = await cloud.downloadFile({ fileID });
    const base64 = (dl && dl.fileContent ? dl.fileContent : Buffer.alloc(0)).toString('base64');
    if (!base64 || base64.length < 100) {
      throw bizError('照片读取失败，请重新选择', 1);
    }
    if (base64.length > 5 * 1024 * 1024) {
      throw bizError('照片太大了，请换一张小一点的照片', 1);
    }

    // 2. 调腾讯云人脸检测与分析
    const result = await detectFace(base64);

    // 3. 人脸数量校验
    const faces = result.FaceInfos || [];
    if (!faces.length) {
      throw bizError('未检测到人脸，请上传清晰的正面照片', 4);
    }
    if (faces.length > 1) {
      throw bizError('照片里人脸太多啦，请上传只包含一张人脸的照片', 4);
    }

    // 4. 加工展示结果
    return { code: 0, data: buildResult(faces[0]) };
  } catch (err) {
    if (err && err.friendly) {
      return { code: err.code, msg: err.message, debug: err.debug || '' };
    }
    // 非业务错误（网络 / 超时 / 未预期）：控制台留痕 + debug 字段带回，便于定位
    console.error('[beauty] 未预期错误：', err && (err.stack || err.message || err));
    const isNet =
      err && (err.message === 'TIMEOUT' || err.message === 'BAD_RESPONSE');
    return {
      code: 5,
      msg: isNet ? '网络异常，请稍后重试' : '分析未能完成，请稍后重试',
      debug: String((err && (err.errMsg || err.message)) || err || '').slice(0, 150)
    };
  } finally {
    // 5. 用完即删：无论成功失败都清理云存储临时文件，不留任何照片
    if (fileID) {
      try {
        await cloud.deleteFile({ fileList: [fileID] });
      } catch (e) {
        // 删除失败不阻塞返回；文件在临时目录，云存储生命周期内不会影响用户
        console.error('[beauty] 临时文件删除失败：', fileID, e && e.message);
      }
    }
  }
};
