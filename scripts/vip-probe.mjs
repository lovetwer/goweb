/**
 * vip-probe —— 直接调 /xpay/query_order，把平台返回的**原始 JSON** 打出来。
 *
 * 为什么要有这个脚本：
 *   云函数里判断「订单是否已支付」时，必须读平台返回体里的某个状态字段。
 *   之前是靠猜字段名（order_status / order_state），猜错了就出事：
 *     · 猜成「没失败就算成功」→ 没付钱也发了会员；
 *     · 改成「必须见到 SUCCESS」→ 真付了钱的反而发不出去。
 *   两头都踩过之后，正确做法是先看一眼真实返回长什么样，再写判断。
 *
 * 用法：
 *   node scripts/vip-probe.mjs                 查最近一笔订单
 *   node scripts/vip-probe.mjs <outTradeNo>    查指定订单
 *
 * 只读，不写库、不发货。
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPTS = __dirname;
const ROOT = path.resolve(SCRIPTS, '..');

const CONFIG = fs.readFileSync(path.join(ROOT, 'miniprogram', 'config.js'), 'utf8');
const ENV_ID = (CONFIG.match(/ENV_ID:\s*['"]([^'"]+)['"]/) || [])[1];

const LOCAL = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'secret.local.json'), 'utf8'));
const VIP = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'vip', 'secret.json'), 'utf8'));

function calcPaySig(uri, postBody, appKey) {
  return crypto.createHmac('sha256', appKey).update(`${uri}&${postBody}`, 'utf8').digest('hex');
}

async function getToken() {
  const u =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(LOCAL.appid)}&secret=${encodeURIComponent(LOCAL.secret)}`;
  const r = await (await fetch(u)).json();
  if (!r.access_token) throw new Error(`取 access_token 失败: ${r.errcode} ${r.errmsg}`);
  return r.access_token;
}

async function dbQuery(query) {
  const token = await getToken();
  const u = `https://api.weixin.qq.com/tcb/databasequery?access_token=${token}`;
  const r = await (
    await fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env: ENV_ID, query }),
    })
  ).json();
  if (r.errcode) throw new Error(`数据库查询失败: ${r.errcode} ${r.errmsg}`);
  return (r.data || []).map((x) => (typeof x === 'string' ? JSON.parse(x) : x));
}

async function queryOrder(openid, outTradeNo, env, appKey) {
  const body = JSON.stringify({ openid, env, order_id: outTradeNo });
  const uri = '/xpay/query_order';
  const paySig = calcPaySig(uri, body, appKey);
  const token = await getToken();
  const u = `https://api.weixin.qq.com${uri}?access_token=${token}&pay_sig=${paySig}`;
  const r = await (
    await fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  ).json();
  return r;
}

async function main() {
  const arg = process.argv[2];

  let order;
  if (arg) {
    const rows = await dbQuery(
      `db.collection('vip_orders').where({ outTradeNo: '${arg}' }).limit(1).get()`
    );
    order = rows[0];
    if (!order) throw new Error(`找不到订单 ${arg}`);
  } else {
    const rows = await dbQuery(
      `db.collection('vip_orders').orderBy('createTime','desc').limit(1).get()`
    );
    order = rows[0];
    if (!order) throw new Error('vip_orders 里没有任何订单');
  }

  console.log('订单：');
  console.log(`  单号   ${order.outTradeNo}`);
  console.log(`  套餐   ${order.planId}  ${order.amount} 分`);
  console.log(`  状态   ${order.status}`);
  console.log(`  openid ${order._openid}`);

  // 两个环境都试一遍：只有匹配订单创建时那个 env 的返回才有意义，
  // 另一个通常会报「订单不存在」。这样也能反推出下单时到底跑在哪个环境。
  const tries = [
    { env: 1, key: VIP.appKeySandbox, label: '沙箱 env=1 + 沙箱AppKey' },
    { env: 0, key: VIP.appKeyProd, label: '现网 env=0 + 现网AppKey' },
  ];

  for (const t of tries) {
    if (!t.key) {
      console.log(`\n--- ${t.label}：密钥未填，跳过`);
      continue;
    }
    console.log(`\n--- ${t.label}`);
    try {
      const r = await queryOrder(order._openid, order.outTradeNo, t.env, t.key);
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.log(`请求失败：${e.message}`);
    }
  }

  console.log('\n────────────────────────────────');
  console.log('把上面两段 JSON 原样发我，我据此修改云函数的支付状态判定。');
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
});
