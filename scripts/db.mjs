#!/usr/bin/env node
/**
 * scripts/db.mjs —— 云开发数据库命令行管理工具（微信云开发 HTTP API 版）
 *
 * 注意：本目录在 miniprogramRoot 之外，永远不会被打进小程序代码包。
 *
 * 命令：
 *   node scripts/db.mjs list [N]       列出前 N 条记录（默认 20，最大 100）
 *   node scripts/db.mjs count          统计 sites 集合总条数
 *   node scripts/db.mjs add <file>     从 JSON 数组 / 单个对象 / JSON Lines 文件批量添加
 *   node scripts/db.mjs del <_id>...   按 _id 删除一条或多条记录
 *   node scripts/db.mjs clear --yes    清空整个 sites 集合（危险操作，必须带 --yes）
 *   node scripts/db.mjs vip:seed                初始化会员套餐到 vip_plans（幂等）
 *   node scripts/db.mjs vip:mark <_id>          把某个收录标为/取消「仅会员可见」
 *   node scripts/db.mjs vip:list                列出 vip_plans 套餐
 *   node scripts/db.mjs vip:orders              查看会员订单（含状态与金额）
 *   node scripts/db.mjs vip:members             查看会员列表与到期时间
 *
 * 鉴权（二选一）：
 *   1. scripts/secret.local.json —— 内容：{ "appid": "wx...", "secret": "你的 AppSecret" }
 *   2. 环境变量 WX_APPID、WX_SECRET
 *
 * AppSecret 获取 / 重置：mp.weixin.qq.com → 开发 → 开发管理 → 开发设置 → AppSecret
 * ⚠️ AppSecret 是敏感凭据，等于数据库的管理员钥匙，不要提交到 git、不要发给别人。
 *    本脚本以「管理员身份」读写数据库，不受集合权限规则（如"所有用户可读"）限制。
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ------------------------------ 配置与鉴权 ------------------------------ */

function readConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'miniprogram', 'config.js'), 'utf8');
  const envId = (src.match(/ENV_ID:\s*['"]([^'"]+)['"]/) || [])[1];
  const collection = (src.match(/COLLECTION:\s*['"]([^'"]+)['"]/) || [])[1] || 'sites';
  if (!envId) throw new Error('无法从 miniprogram/config.js 读取 ENV_ID');
  return { envId, collection };
}

function readCredential() {
  const secretFile = path.join(__dirname, 'secret.local.json');
  if (fs.existsSync(secretFile)) {
    const j = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
    if (j.appid && j.secret) return { appid: j.appid, secret: j.secret };
  }
  if (process.env.WX_APPID && process.env.WX_SECRET) {
    return { appid: process.env.WX_APPID, secret: process.env.WX_SECRET };
  }
  console.error(
    [
      '',
      '缺少鉴权信息，二选一配置：',
      '  1. 复制 scripts/secret.local.example.json 为 scripts/secret.local.json，',
      '     填入 appid 和 secret（AppSecret：mp.weixin.qq.com → 开发 → 开发管理 → 开发设置）',
      '  2. 或设置环境变量 WX_APPID / WX_SECRET',
      ''
    ].join('\n')
  );
  process.exit(1);
}

const { envId, collection } = readConfig();
const { appid, secret } = readCredential();

const TOKEN_FILE = path.join(__dirname, '.token.cache.json');

async function getToken(force = false) {
  if (!force && fs.existsSync(TOKEN_FILE)) {
    try {
      const c = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (c.token && c.expiresAt > Date.now() + 60_000) return c.token;
    } catch {
      /* 缓存坏了就重新取 */
    }
  }
  const u =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const r = await (await fetch(u)).json();
  if (!r.access_token) {
    const hint =
      r.errcode === 40164
        ? '（把本机出口 IP 加进 mp 后台「开发设置 → IP 白名单」，或关闭 IP 白名单）'
        : r.errcode === 40013
          ? '（appid 不对，检查 secret.local.json）'
          : r.errcode === 40125 || r.errcode === 41004
            ? '（AppSecret 无效或已被重置，去 mp 后台重新生成）'
            : '';
    throw new Error(`获取 access_token 失败: ${r.errcode} ${r.errmsg} ${hint}`);
  }
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ token: r.access_token, expiresAt: Date.now() + (r.expires_in - 300) * 1000 })
  );
  return r.access_token;
}

async function api(pathName, body, retried = false) {
  const token = await getToken();
  const res = await (
    await fetch(`https://api.weixin.qq.com/${pathName}?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: envId, ...body })
    })
  ).json();
  if ((res.errcode === 40001 || res.errcode === 42001) && !retried) {
    await getToken(true);
    return api(pathName, body, true);
  }
  if (res.errcode) throw new Error(`API ${pathName} 失败: ${res.errcode} ${res.errmsg}`);
  return res;
}

/* ------------------------------ 数据处理 ------------------------------ */

/**
 * 把记录里的 createTime 转成服务端脚本的 Date 表达式：
 *   字符串日期 / { $date: ... } → new Date('...')
 *   '__NOW__'                  → db.command.serverDate()（当前时间）
 */
function prepareRecord(rec) {
  const r = { ...rec };
  if (typeof r.createTime === 'string') {
    r.createTime = r.createTime === '__NOW__' ? '__SERVERDATE__' : `__DATE__:${r.createTime}`;
  } else if (r.createTime && typeof r.createTime === 'object' && r.createTime.$date) {
    r.createTime = `__DATE__:${r.createTime.$date}`;
  } else if (!('createTime' in r)) {
    r.createTime = '__SERVERDATE__';
  }
  return r;
}

function buildAddQuery(records) {
  let json = JSON.stringify(records.map(prepareRecord));
  json = json
    .replace(/"__DATE__:(.+?)"/g, (_m, v) => `new Date('${v}')`)
    .replace(/"__SERVERDATE__"/g, 'new Date()');
  return `db.collection('${collection}').add({ data: ${json} })`;
}

function parseInputFile(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) throw new Error('文件是空的');
  if (text.startsWith('[')) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr) || !arr.length) throw new Error('JSON 里没有记录');
    return arr;
  }
  if (text.startsWith('{')) {
    return [JSON.parse(text)];
  }
  // JSON Lines：一行一条
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

function fmtTime(v) {
  if (!v) return '';
  // 服务端返回的 Date 有两种形态：{ $date: 1717...000 }（毫秒数）或 ISO 字符串
  let raw = typeof v === 'object' && v.$date !== undefined ? v.$date : v;
  const isNum = typeof raw === 'number' || /^\d{10,}$/.test(String(raw));
  const d = isNum ? new Date(Number(raw)) : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function printRows(rows) {
  for (const r of rows) {
    const id = (r._id || '').padEnd(34).slice(0, 34);
    const name = (r.name || '').padEnd(16).slice(0, 16);
    const cat = (r.category || '').padEnd(10).slice(0, 10);
    const url = (r.url || '').slice(0, 44);
    console.log(`${id}  ${name}  ${cat}  ${fmtTime(r.createTime)}  ${url}`);
  }
}

/* ------------------------------ 命令实现 ------------------------------ */

async function cmdList(n) {
  const limit = Math.min(Math.max(parseInt(n, 10) || 20, 1), 100);
  const res = await api('tcb/databasequery', {
    query: `db.collection('${collection}').limit(${limit}).get()`
  });
  const rows = (res.data || []).map((s) => (typeof s === 'string' ? JSON.parse(s) : s));
  const total = res.pager && (res.pager.Total ?? res.pager.total);
  console.log(`集合「${collection}」共 ${total ?? '?'} 条，显示前 ${rows.length} 条：\n`);
  console.log(`${'_id'.padEnd(34)}  ${'名称'.padEnd(16)}  ${'分类'.padEnd(10)}  收录时间     网址`);
  printRows(rows);
}

async function cmdCount() {
  const res = await api('tcb/databasequery', {
    query: `db.collection('${collection}').limit(1).get()`
  });
  const total = res.pager && (res.pager.Total ?? res.pager.total);
  console.log(`集合「${collection}」共 ${total ?? JSON.stringify(res)} 条`);
}

async function cmdAdd(file) {
  if (!file) throw new Error('用法：node scripts/db.mjs add <文件路径>');
  const abs = path.resolve(file);
  const records = parseInputFile(abs);
  const res = await api('tcb/databaseadd', { query: buildAddQuery(records) });
  const ids = res.id_list || res.idList || [];
  console.log(`成功添加 ${ids.length} 条记录（文件：${abs}）`);
  if (ids.length) console.log(ids.map((id, i) => `  ${records[i].name || '未命名'} → ${id}`).join('\n'));
}

async function cmdDel(ids) {
  if (!ids.length) throw new Error('用法：node scripts/db.mjs del <_id> [<_id>...]');
  let n = 0;
  for (const id of ids) {
    const res = await api('tcb/databasedelete', {
      query: `db.collection('${collection}').doc('${id}').remove()`
    });
    const deleted = res.deleted ?? 0;
    n += deleted;
    console.log(`${deleted ? '已删除' : '未找到'}：${id}`);
  }
  console.log(`共删除 ${n} 条`);
}

async function cmdClear() {
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const res = await api('tcb/databasedelete', {
      query: `db.collection('${collection}').where({ _id: db.command.neq('__none__') }).remove()`
    });
    const deleted = res.deleted ?? 0;
    total += deleted;
    if (!deleted) break;
  }
  console.log(`集合「${collection}」已清空，共删除 ${total} 条`);
}

/* ------------------------------ 会员相关命令 ------------------------------ */
/* 集合名独立于 readConfig() 里的 sites —— 会员这几个集合权限是「仅管理端可读写」，
   本脚本以管理员身份读写，不受权限限制。 */
const COLL_PLANS = 'vip_plans';
const COLL_ORDERS = 'vip_orders';
const COLL_MEMBERS = 'vip_members';

/**
 * 会员套餐定义。
 * ⚠️ productId 必须与 MP 后台【虚拟支付 → 道具管理】里的道具 ID 完全一致，
 *    对不上支付会被平台拒绝。先去后台建道具，再改这里的 productId。
 *
 * ⚠️ 改完价格要同步改两处，否则会出现「页面显示 A、实际扣 B」：
 *    1) 本文件 VIP_PLANS 的 price（单位：分）
 *    2) MP 后台【虚拟支付 → 道具管理】里对应道具的价格 —— **这个是真正扣钱的数**
 *    只改数据库不改编后台道具价，用户会按后台的价扣钱。
 *
 * 定价参考（官方费率 Android 1% / iOS 12%，iOS 结算约 45-60 天）：
 *    月 9.9 元 → iOS 到手约 8.7 元
 *    年 99 元  → iOS 到手约 87.1 元
 * 折扣角标**不入库**，由页面按「年价 vs 12×月价」实时算：
 *   (118.8 - 99) / 118.8 = 16.67% → 页面显示「省 16%」（向下取整，宁可少说）
 * 好处：改价格不用同步改文案，不会出现「价格改了、角标还是旧折扣」的虚假宣传。
 */
const VIP_PLANS = [
  {
    planId: 'vip_month',
    name: '月会员',
    productId: 'vip_month',
    price: 990, // 单位：分 = 9.9 元
    period: '/ 月',
    benefit: '查看全部会员专属条目',
    badge: '',
    sort: 1,
    active: true,
  },
  {
    planId: 'vip_year',
    name: '年会员',
    productId: 'vip_year',
    price: 9900, // 单位：分 = 99 元
    period: '/ 年',
    benefit: '查看全部会员专属条目',
    // 不存折扣角标：折扣由页面按「年价 vs 12×月价」实时算，
    // 改价格时不用同步改文案，也不会出现旧折扣（虚假宣传，审核会判违规）。
    badge: '',
    sort: 2,
    active: true,
  },
];

/** 插一条到任意集合 */
async function insertTo(coll, doc) {
  return api('tcb/databaseadd', {
    query: `db.collection('${coll}').add({ data: ${JSON.stringify(doc)} })`,
  });
}

/** 按 where 条件查任意集合 */
async function queryWhere(coll, whereJs, limit = 100) {
  const res = await api('tcb/databasequery', {
    query: `db.collection('${coll}').where(${whereJs}).limit(${limit}).get()`,
  });
  return (res.data || []).map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
}

/**
 * 初始化 / 更新套餐。
 *   - 不存在 → 插入
 *   - 已存在但价格或文案变了 → 更新（并打印变化，方便确认改对了）
 *   - 完全一致 → 跳过
 * 这样改完 VIP_PLANS 重跑一次就能生效，不用手动去控制台改数据库。
 */
async function cmdVipSeed() {
  for (const plan of VIP_PLANS) {
    const rows = await queryWhere(COLL_PLANS, `{ planId: '${plan.planId}' }`, 1);
    if (!rows.length) {
      await insertTo(COLL_PLANS, { ...plan, createTime: new Date() });
      console.log(`✓ ${plan.name}（${plan.planId}）已插入，价格 ${plan.price / 100} 元`);
      continue;
    }

    const cur = rows[0];
    const diffs = [];
    // 注意：price 单位是「分」，比较时用 Number 避免字符串误判
    const curPrice = Number(cur.price);
    if (curPrice !== plan.price) {
      diffs.push(`价格 ${(curPrice / 100).toFixed(2)} → ${(plan.price / 100).toFixed(2)} 元`);
    }
    if ((cur.name || '') !== plan.name) diffs.push(`名称「${cur.name}」→ 「${plan.name}」`);
    if ((cur.benefit || '') !== plan.benefit) diffs.push('权益文案');
    if (cur.active !== plan.active) diffs.push(`上架 ${cur.active} → ${plan.active}`);
    // 折扣角标不再入库；历史数据里若存过则顺手清掉
    const hasBadge = !!cur.badge;
    if (cur.active !== plan.active || hasBadge || diffs.length) {
      await api('tcb/databaseupdate', {
        query: `db.collection('${COLL_PLANS}').doc('${cur._id}').update({ data: ${JSON.stringify({
          name: plan.name,
          price: plan.price,
          period: plan.period,
          benefit: plan.benefit,
          badge: '',
          productId: plan.productId,
          sort: plan.sort,
          active: plan.active,
        })} })`,
      });
      if (hasBadge && !diffs.length) {
        console.log(`↻ ${plan.name}（${plan.planId}）已清除数据库里的折扣角标（改由页面计算）`);
      } else {
        console.log(`↻ ${plan.name}（${plan.planId}）已更新：${diffs.join('；') || '清理折扣角标'}`);
      }
      continue;
    }

    console.log(`· ${plan.name}（${plan.planId}）配置无变化，跳过`);
  }
  console.log('\n下一步：');
  console.log('  1. 确认 MP 后台【虚拟支付 → 道具管理】已创建同名道具，ID 与 productId 一致');
  console.log('  2. 复制 cloudfunctions/vip/secret.example.json 为 secret.json 并填入四项密钥');
  console.log('  3. 云函数 vip 右键 → 上传并部署：云端安装依赖');
  console.log('  4. miniprogram/config.js 里 VIP_ENABLED 改成 true');
}

/** 标记 / 取消标记某条收录为「仅会员可见」 */
async function cmdVipMark(id) {
  if (!id) throw new Error('用法：node scripts/db.mjs vip:mark <_id>');
  // 先读出这条记录，拿到 name 便于确认，同时判断当前状态做「切换」而非「设置」
  const res = await api('tcb/databasequery', {
    query: `db.collection('${collection}').doc('${id}').get()`,
  });
  const site = (res.data && (typeof res.data === 'string' ? JSON.parse(res.data) : res.data)) || null;
  if (!site || !site._id) {
    console.error(`✗ 找不到 _id = ${id} 的记录`);
    process.exitCode = 1;
    return;
  }
  const cur = site.vipOnly === true;
  const next = !cur;
  await api('tcb/databaseupdate', {
    query: `db.collection('${collection}').doc('${id}').update({ data: { vipOnly: ${next} } })`,
  });
  console.log(`${site.name}：vipOnly ${cur} → ${next}（${next ? '仅会员可见完整内容' : '已恢复公开'}）`);
}

/**
 * 列出套餐，并打印「MP 后台道具管理」的对照清单。
 *
 * 为什么要把后台要填的东西一起打出来：
 *   -15010（道具未发布）和 -15013（价格不一致）是接入期最常撞的两个错，
 *   根因都是「后台那个框里填的」与「这里读出来的」对不上。
 *   道具 ID 区分大小写、价格单位是分，手抄极易出错 —— 直接把待填值原样打印，
 *   照着复制即可，省掉一轮「报错 → 猜 → 再报错」。
 */
async function cmdVipList() {
  const rows = await queryWhere(COLL_PLANS, '{}', 50);
  if (!rows.length) {
    console.log(`集合「${COLL_PLANS}」为空，先跑：node scripts/db.mjs vip:seed`);
    return;
  }
  console.log('会员套餐：\n');
  for (const p of rows) {
    console.log(
      `  ${(p.planId || '').padEnd(12)} ${(p.name || '').padEnd(8)} ${(p.price / 100).toFixed(2).padStart(7)} 元  ` +
        `道具 ${(p.productId || '').padEnd(12)} ${p.active === false ? '[已下架]' : ''}`
    );
  }

  // 只列出了在售的（active !== false），下架的不该照抄到后台
  const live = rows.filter((p) => p.active !== false);
  if (!live.length) return;

  console.log('\n──────────────────────────────────────────────────');
  console.log('MP 后台对照表（虚拟支付 → 道具管理）');
  console.log('──────────────────────────────────────────────────');
  console.log('每个套餐建一个道具，下面两列必须逐字符一致：\n');
  console.log(`  ${'道具 ID'.padEnd(16)} ${'道具价格'.padEnd(20)} 套餐`);
  for (const p of live) {
    const price = `${Number(p.price)} 分（${(Number(p.price) / 100).toFixed(2)} 元）`;
    console.log(`  ${String(p.productId || '').padEnd(16)} ${price.padEnd(20)} ${p.name || p.planId}`);
  }
  console.log('\n  道具 ID 区分大小写，不能有多余空格；价格单位是「分」。');
  console.log('  建好后必须【提交审核并发布】—— 只保存为草稿会一直报 -15010 道具未发布。');
  console.log('  刚发布约 10 分钟后才生效（未生效时下单报 -15014）。');
  console.log('\n  若后台已有道具但 ID 与上表不同：道具 ID 建好通常不可改，');
  console.log('  反过来改 scripts/db.mjs 的 VIP_PLANS.productId 对齐后台，再跑一次：');
  console.log('    node scripts/db.mjs vip:seed');
}

/** 查看订单 */
async function cmdVipOrders() {
  const res = await api('tcb/databasequery', {
    query: `db.collection('${COLL_ORDERS}').limit(50).get()`,
  });
  const rows = (res.data || []).map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
  if (!rows.length) {
    console.log('暂无订单');
    return;
  }
  const STATUS = { pending: '待支付', delivered: '已发放', refunded: '已退款' };
  console.log(`会员订单（最近 ${rows.length} 条）：\n`);
  console.log(`${'订单号'.padEnd(22)} ${'套餐'.padEnd(10)} ${'金额'.padStart(8)}  ${'状态'.padEnd(8)} 时间`);
  for (const o of rows) {
    console.log(
      `${(o.outTradeNo || '').padEnd(22)} ${(o.planId || '').padEnd(10)} ${(String((o.amount || 0) / 100)).padStart(8)}  ` +
        `${(STATUS[o.status] || o.status || '?').padEnd(8)} ${fmtTime(o.createTime)}`
    );
  }
  // 汇总已发放金额（分 → 元），方便对账
  const total = rows.filter((o) => o.status === 'delivered').reduce((s, o) => s + (o.amount || 0), 0);
  console.log(`\n本页已发放合计：${(total / 100).toFixed(2)} 元`);
}

/**
 * 清空会员测试数据（vip_members + vip_orders），回到「从来没人买过」的状态。
 *
 * 为什么需要它：下单接口对已是会员的用户会直接拒绝（-11），而联调过程中难免
 * 产生假会员 / 未支付的废单。不清掉就再也走不了一遍完整的付款流程。
 *
 * ⚠️ 这是**联调专用**命令：它会删掉所有会员记录和订单。上线后不要执行，
 *    否则真实购买记录会被清光。这也是为什么必须显式加 --yes 才跑。
 *
 * 用法：node scripts/db.mjs vip:reset --yes
 */
async function cmdVipReset() {
  const members = await queryWhere(COLL_MEMBERS, '{}', 100);
  const orders = await queryWhere(COLL_ORDERS, '{}', 100);

  console.log('即将删除：');
  console.log(`  ${COLL_MEMBERS}：${members.length} 条会员记录`);
  console.log(`  ${COLL_ORDERS}：${orders.length} 条订单`);
  if (!members.length && !orders.length) {
    console.log('\n本来就是空的，无需清理。');
    return;
  }
  if (process.argv.indexOf('--yes') === -1) {
    console.log('\n▲ 未确认，什么都没做。真的要删请加 --yes：');
    console.log('  node scripts/db.mjs vip:reset --yes');
    return;
  }

  for (const coll of [COLL_MEMBERS, COLL_ORDERS]) {
    let total = 0;
    for (let i = 0; i < 50; i += 1) {
      const res = await api('tcb/databasedelete', {
        query: `db.collection('${coll}').where({ _id: db.command.neq('__none__') }).remove()`,
      });
      const deleted = res.deleted ?? 0;
      total += deleted;
      if (!deleted) break;
    }
    console.log(`✓ ${coll} 已清空，共删除 ${total} 条`);
  }
  console.log('\n现在可以重新走一遍完整付款流程了。');
}

/**
 * 重放：把数据库恢复成「用户刚付完钱、权益还没发」的状态。
 *
 * 为什么有用：验证「支付成功 → 自动到账」这条链路本来需要再付一次钱。
 * 但已经真实支付过的订单，平台那边付款记录还在 —— 只要把这边的状态重置回
 * pending 并清掉会员，再打开小程序， lodge 发货逻辑就会重新跑一遍真实的发货流程，
 * 全程由小程序自己完成，不需要命令行介入，也不需要再花一分钱。
 *
 * 与 vip:reset 的区别：reset 会**删掉订单**，replay **保留订单**、只把状态退回 pending，
 * 这样 outTradeNo 还在，才能去平台重新查到那笔真实支付。
 *
 * 用法：node scripts/db.mjs vip:replay --yes
 */
async function cmdVipReplay() {
  const members = await queryWhere(COLL_MEMBERS, '{}', 100);
  const orders = await queryWhere(COLL_ORDERS, '{}', 100);
  if (process.argv.indexOf('--yes') === -1) {
    console.log('即将执行：');
    console.log(`  清空 ${COLL_MEMBERS}（${members.length} 条会员）`);
    console.log(`  把 ${COLL_ORDERS} 里 ${orders.length} 条订单状态退回 pending（订单本身保留）`);
    console.log('\n▲ 未确认。确认要跑请加 --yes：');
    console.log('  node scripts/db.mjs vip:replay --yes');
    return;
  }

  // 会员：全部删掉，回到「没会员」
  for (const m of members) {
    await api('tcb/databasedelete', {
      query: `db.collection('${COLL_MEMBERS}').doc('${m._id}').remove()`,
    });
  }
  console.log(`✓ 已清空会员 ${members.length} 条`);

  // 订单：状态退回 pending，单号保留（靠它去平台重新查那笔真实支付）
  let n = 0;
  for (const o of orders) {
    if (o.status !== 'pending') {
      await api('tcb/databaseupdate', {
        query: `db.collection('${COLL_ORDERS}').doc('${o._id}').update({ data: ${JSON.stringify({
          status: 'pending',
          wxOrderId: '',
        })} })`,
      });
      n += 1;
    }
  }
  console.log(`✓ 已把 ${n} 条订单退回 pending（共 ${orders.length} 条）`);
  console.log('\n现在打开小程序会员页，应该由小程序自己完成发货 → 自动变成会员。');
  console.log('（前提：修好的云函数已经重新部署）');
}

/**
 * 会员发货 / 撤销 —— 管理员命令行救灾工具。
 *
 * 为什么要有这两个命令：
 *   发货判定一旦写错（读错平台返回字段），用户会出现「付了钱却不是会员」，
 *   修完还得等云函数重新部署才生效。这两个命令让你立刻纠偏，不必等部署。
 *
 * ⚠️ 安全阀（最重要）：
 *   vip:deliver **不会**凭命令行一句话就发会员。它必须先向平台 query_order，
 *   确认 paid_time + wx_order_id 这两个支付证据都有值才发货。拿不到证据就拒绝。
 *   ——之前正因为拿「没证据」当「已支付」，结果白送过会员，这个教训必须留在这儿。
 */

/** 读云函数侧的虚拟支付密钥（现网/沙箱/AppSecret） */
function readVipSecret() {
  const p = path.join(ROOT, 'cloudfunctions', 'vip', 'secret.json');
  if (!fs.existsSync(p)) throw new Error('缺少 cloudfunctions/vip/secret.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function paySig(uri, postBody, appKey) {
  return crypto.createHmac('sha256', appKey).update(`${uri}&${postBody}`, 'utf8').digest('hex');
}

/**
 * 向平台核实一笔订单到底付没付。
 * @returns {Promise<object|null>} 已支付则返回平台 order 对象，否则 null
 */
async function platformConfirmPaid(order) {
  const vip = readVipSecret();
  const useSandbox = vip.sandbox === true;
  const appKey = useSandbox ? vip.appKeySandbox || vip.appKeyProd : vip.appKeyProd;
  const env = useSandbox ? 1 : 0;
  if (!appKey) throw new Error('secret.json 缺少支付 AppKey');

  const body = JSON.stringify({ openid: order._openid, env, order_id: order.outTradeNo });
  const uri = '/xpay/query_order';
  const token = await getToken();
  const u = `https://api.weixin.qq.com${uri}?access_token=${token}&pay_sig=${paySig(uri, body, appKey)}`;
  const r = await (
    await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  ).json();

  if (!r || r.errcode !== 0) {
    console.log(`  平台查单失败：errcode=${r && r.errcode} ${r && r.errmsg}`);
    return null;
  }

  // 真实结构：所有信息在 r.order 里；status 是数字(3)，靠 enumerical 猜不可靠。
  // 只认语义明确的支付证据：paid_time + wx_order_id 同时有值才算真的付了。
  const o = r.order;
  if (!o) return null;
  if (Number(o.paid_time || 0) === 0 || !o.wx_order_id) return null;
  return o;
}

/** 给一笔已确认支付的订单补发会员权益 */
async function cmdVipDeliver(tradeNo) {
  if (!tradeNo) throw new Error('用法：node scripts/db.mjs vip:deliver <outTradeNo>');

  const rows = await queryWhere(COLL_ORDERS, `{ outTradeNo: '${tradeNo}' }`, 1);
  const order = rows[0];
  if (!order) throw new Error(`找不到订单 ${tradeNo}`);

  console.log(`订单 ${tradeNo}  当前状态：${order.status}  金额 ${order.amount} 分`);
  if (order.status === 'delivered') {
    console.log('这笔已经发过货了，如需重做请先 vip:reset');
    return;
  }

  console.log('正在向平台核实是否已支付…');
  const paid = await platformConfirmPaid(order);
  if (!paid) {
    console.log('✗ 平台侧查不到支付证据，拒绝发货（不能给没付钱的人开会员）。');
    return;
  }
  console.log(
    `✓ 平台确认已支付：wx_order_id=${paid.wx_order_id} 实付 ${paid.paid_fee} 分`
  );

  // 实付金额不能少于订单标价
  if (Number(paid.paid_fee || 0) < Number(order.amount || 0)) {
    console.log(`✗ 实付 ${paid.paid_fee} < 标价 ${order.amount}，拒绝发货。`);
    return;
  }

  // 起算点用「支付时间」而不是补发时刻：手动补发往往发生在支付后好几天，
  // 从 now 起算等于让用户平白少几天会员（paid_time 是秒级，×1000 转毫秒）。
  const paidMs = Number(paid.paid_time) > 0 ? Number(paid.paid_time) * 1000 : Date.now();
  // 月/年按自然单位推进；月末溢出 clamp 到目标月最后一天
  // （1/31 开月度 → 2 月末，而不是 setMonth 溢出出来的 3/2；2/29 + 1 年 → 次年 2/28）
  const from = new Date(paidMs);
  const day = from.getDate();
  from.setDate(1);
  from.setMonth(from.getMonth() + (order.planId === 'vip_year' ? 12 : 1));
  const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  from.setDate(Math.min(day, lastDay));
  const expireAt = from.getTime();

  await api('tcb/databaseupdate', {
    query: `db.collection('${COLL_ORDERS}').doc('${order._id}').update({ data: ${JSON.stringify({
      status: 'delivered',
      wxOrderId: paid.wx_order_id,
      paidTime: new Date(Number(paid.paid_time) * 1000),
    })} })`,
  });

  const existing = await queryWhere(COLL_MEMBERS, `{ _openid: '${order._openid}' }`, 1);
  const data = {
    _openid: order._openid,
    planId: order.planId,
    planName: order.planName,
    expireAt: Math.max(expireAt, existing[0] ? Number(existing[0].expireAt || 0) : 0),
  };

  if (existing[0]) {
    await api('tcb/databaseupdate', {
      query: `db.collection('${COLL_MEMBERS}').doc('${existing[0]._id}').update({ data: ${JSON.stringify(data)} })`,
    });
  } else {
    await insertTo(COLL_MEMBERS, Object.assign({}, data, { createTime: new Date() }));
  }

  console.log(`\n✓ 已发货：到期时间 ${fmtTime(expireAt)}`);
  console.log('  重新进入会员页即可看到会员状态（判定走服务端，不依赖本地缓存）。');
}

/**
 * 撤销会员（退款配套）。
 *
 * ⚠️ 为什么必须做这一步：
 *   平台退款成功后只会在云端记账，**不会**自动改我们数据库，
 *   而本项目没有实现 xpay_refund_notify 接收端。结果是：
 *   钱退给用户了，vip_members 里他还是会员 —— 白嫖。
 *   所以在 MP 后台退款之后，必须跑一次这个命令把会员收回去。
 *
 * 用法：node scripts/db.mjs vip:revoke <openid>
 */
async function cmdVipRevoke(openid) {
  if (!openid) throw new Error('用法：node scripts/db.mjs vip:revoke <openid>');
  const rows = await queryWhere(COLL_MEMBERS, `{ _openid: '${openid}' }`, 1);
  if (!rows.length) {
    console.log('该用户没有会员记录，无需处理。');
    return;
  }
  const res = await api('tcb/databasedelete', {
    query: `db.collection('${COLL_MEMBERS}').doc('${rows[0]._id}').remove()`,
  });
  console.log(`✓ 已撤销会员（删除 ${res.deleted ?? 0} 条）`);

  // 同时把相关订单标成已退款，避免去重逻辑误判
  const orders = await queryWhere(COLL_ORDERS, `{ _openid: '${openid}' }`, 100);
  let n = 0;
  for (const o of orders) {
    if (o.status === 'delivered') {
      await api('tcb/databaseupdate', {
        query: `db.collection('${COLL_ORDERS}').doc('${o._id}').update({ data: ${JSON.stringify({
          status: 'refunded',
        })} })`,
      });
      n += 1;
    }
  }
  if (n) console.log(`✓ 已将 ${n} 笔已发货订单标记为退款状态`);
  console.log('\n提示：请确认 MP 后台退款已实际完成，两边状态要一致。');
}

/** 查看会员 */
async function cmdVipMembers() {
  const rows = await queryWhere(COLL_MEMBERS, '{}', 100);
  if (!rows.length) {
    console.log('暂无会员');
    return;
  }
  const now = Date.now();
  const rows2 = rows.sort((a, b) => (b.expireAt || 0) - (a.expireAt || 0));
  console.log(`会员列表（共 ${rows2.length} 人）：\n`);
  console.log(`${'openid（脱敏）'.padEnd(22)} ${'套餐'.padEnd(10)} ${'到期'.padEnd(12)} 状态`);
  for (const m of rows2) {
    const oid = String(m._openid || '');
    const mask = oid.length > 10 ? `${oid.slice(0, 6)}…${oid.slice(-4)}` : oid;
    const expired = (m.expireAt || 0) <= now;
    console.log(
      `${mask.padEnd(22)} ${(m.planId || '').padEnd(10)} ${fmtTime(m.expireAt).padEnd(12)} ${expired ? '已过期' : '有效'}`
    );
  }
  const active = rows2.filter((m) => (m.expireAt || 0) > now).length;
  console.log(`\n有效会员 ${active} 人，已过期 ${rows2.length - active} 人`);
}

/* ------------------------------ 入口 ------------------------------ */

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === 'list') await cmdList(args[0]);
  else if (cmd === 'count') await cmdCount();
  else if (cmd === 'add') await cmdAdd(args[0]);
  else if (cmd === 'del') await cmdDel(args);
  else if (cmd === 'clear' && args[0] === '--yes') await cmdClear();
  else if (cmd === 'vip:seed') await cmdVipSeed();
  else if (cmd === 'vip:mark') await cmdVipMark(args[0]);
  else if (cmd === 'vip:list') await cmdVipList();
  else if (cmd === 'vip:orders') await cmdVipOrders();
  else if (cmd === 'vip:members') await cmdVipMembers();
  else if (cmd === 'vip:reset') await cmdVipReset();
  else if (cmd === 'vip:replay') await cmdVipReplay();
  else if (cmd === 'vip:deliver') await cmdVipDeliver(args[0]);
  else if (cmd === 'vip:revoke') await cmdVipRevoke(args[0]);
  else {
    console.log(
      [
        '',
        '用法：node scripts/db.mjs <命令>',
        '  list [N]        列出前 N 条（默认 20）',
        '  count           统计总条数',
        '  add <file>      从 JSON / JSON Lines 文件批量添加',
        '  del <_id>...    按 _id 删除',
        '  clear --yes     清空集合（危险）',
        '',
        '会员相关：',
        '  vip:seed        初始化会员套餐到 vip_plans（幂等）',
        '  vip:mark <_id>  切换某条收录的「仅会员可见」',
        '  vip:list        查看套餐',
        '  vip:orders      查看订单',
        '  vip:members     查看会员与到期时间',
        '  vip:replay --yes 保留订单、退回 pending，重跑自动发货（验证链路，不用再付款）',
        '  vip:deliver <outTradeNo>  给已付款订单补发会员（会先向平台核实支付）',
        '  vip:revoke <openid>       撤销会员（退款后必须执行）',
        '  vip:reset --yes 清空会员/订单测试数据（⚠️ 联调专用，上线后勿用）',
        ''
      ].join('\n')
    );
  }
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
}
