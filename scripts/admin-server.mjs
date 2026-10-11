// scripts/admin-server.mjs —— 本地数据库管理后台的代理服务
// 作用：浏览器直连 api.weixin.qq.com 会被 CORS 拦，所以起一个本地服务转发请求。
// 仅监听 127.0.0.1，不对外暴露；secret 只在本机内存里流转。
//
// 启动：node scripts/admin-server.mjs
// 打开：http://127.0.0.1:8613

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 8613;

/* ---------------- 读取环境与凭据 ---------------- */

function readEnvId() {
  const src = fs.readFileSync(path.join(ROOT, 'miniprogram', 'config.js'), 'utf8');
  const m = src.match(/ENV_ID:\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('config.js 里读不到 ENV_ID');
  return m[1];
}

function readCredential() {
  const file = path.join(__dirname, 'secret.local.json');
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j.appid && j.secret) return j;
  }
  return null;
}

const ENV_ID = readEnvId();

/* ---------------- access_token 缓存 ---------------- */

let tokenCache = { token: '', expiresAt: 0 };

async function getToken(cred, force = false) {
  if (!force && tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.token;
  }
  const u =
    'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential' +
    `&appid=${encodeURIComponent(cred.appid)}&secret=${encodeURIComponent(cred.secret)}`;
  const r = await (await fetch(u)).json();
  if (!r.access_token) {
    throw new Error(`获取 token 失败: ${r.errcode} ${r.errmsg}`);
  }
  tokenCache = { token: r.access_token, expiresAt: Date.now() + (r.expires_in - 300) * 1000 };
  return tokenCache.token;
}

/* ---------------- 云开发 API 转发 ---------------- */

async function callWx(cred, apiPath, body, retried = false) {
  const token = await getToken(cred);
  const res = await (
    await fetch(`https://api.weixin.qq.com/${apiPath}?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: ENV_ID, ...body })
    })
  ).json();
  if ((res.errcode === 40001 || res.errcode === 42001) && !retried) {
    await getToken(cred, true);
    return callWx(cred, apiPath, body, true);
  }
  return res;
}

/* ---------------- HTTP 服务 ---------------- */

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');

  // 管理页面
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'admin.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 告诉前端环境信息（不返回 secret）
  if (req.method === 'GET' && u.pathname === '/api/info') {
    const cred = readCredential();
    sendJson(res, 200, {
      envId: ENV_ID,
      hasCredential: !!cred,
      appid: cred ? cred.appid : ''
    });
    return;
  }

  // 通用云 API 转发：POST /api/wx { path, body, appid?, secret? }
  if (req.method === 'POST' && u.pathname === '/api/wx') {
    try {
      const { path: apiPath, body, appid, secret } = await readBody(req);
      // 凭据优先级：页面提交的 > secret.local.json
      let cred = appid && secret ? { appid, secret } : readCredential();
      if (!cred) {
        sendJson(res, 400, { errcode: -1, errmsg: '缺少 appid/secret，请在页面顶部填写' });
        return;
      }
      const allow = [
        'tcb/databasequery',
        'tcb/databaseadd',
        'tcb/databaseupdate',
        'tcb/databasedelete',
        'tcb/databasecount',
        'tcb/databasecollectionget'
      ];
      if (!allow.includes(apiPath)) {
        sendJson(res, 403, { errcode: -1, errmsg: '不允许的接口: ' + apiPath });
        return;
      }
      const r = await callWx(cred, apiPath, body || {});
      sendJson(res, 200, r);
    } catch (e) {
      sendJson(res, 500, { errcode: -1, errmsg: e.message });
    }
    return;
  }

  sendJson(res, 404, { errcode: -1, errmsg: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`管理后台已启动: http://127.0.0.1:${PORT}`);
  console.log(`环境: ${ENV_ID}`);
  console.log('按 Ctrl+C 停止');
});
