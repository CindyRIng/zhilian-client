#!/usr/bin/env node
/**
 * 智联招聘探路阶段 2：交互式登录 + 全站只读链路探索控制器（2026-11-14）
 *
 * 目标：
 * 1) 抓完整登录流程（扫码 / 短信 / 密码入口）与全部 document/XHR/fetch
 * 2) 登录成功后探路：首页、职位搜索/翻页、职位详情、公司详情（含工商信息）、公司职位、城市/筛选
 * 3) 探索「自动登录 / 会话续期」：cookie 有效期、localStorage token、profile 复用、重启浏览器后的登录态
 *
 * 运行：
 *   cd ~/zhilian-client && ~/cloak-env/bin/cloak-run node exploration/2026-11-14/controller.mjs
 *
 * 产物：exploration/2026-11-14/artifacts/（0600/0700，不入库）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = process.env.ZHILIAN_EXPLORATION_ROOT ?? path.join(os.homedir(), 'zhilian-client');
const EXP = path.join(ROOT, 'exploration/2026-11-14');
const ART = path.join(EXP, 'artifacts');
const BODIES = path.join(ART, 'bodies');
const STATES = path.join(ART, 'states');
const SCREENS = path.join(ART, 'screenshots');
const PROFILE = path.join(os.homedir(), '.zhilian-client/profile');

const LOGIN_URL = 'https://passport.zhaopin.com/login';
const HOME = 'https://www.zhaopin.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const stamp = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let fileSeq = 0;
let netSeq = 0;
let activePage = null;
let ctxRef = null;
let baselineCookies = new Set();

let appendChain = Promise.resolve();
function append(file, obj) {
  appendChain = appendChain
    .then(() => fs.appendFile(file, JSON.stringify(obj) + '\n', { mode: 0o600 }))
    .catch(() => {});
  return appendChain;
}
async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function redactText(s) {
  if (s === null || s === undefined) return s;
  let t = String(s);
  t = t.replace(/(phone|mobile|tel|smsCode|verifyCode|password|token|cookie|validate|seccode|challenge|code)=([^&\s"]*)/gi, '$1=***');
  t = t.replace(/1[3-9]\d{9}/g, '1**********');
  return t;
}
function redactUrl(u) {
  try {
    const x = new URL(u);
    for (const k of ['phone', 'mobile', 'tel', 'smsCode', 'verifyCode', 'code', 'password', 'token', 'uuid', 'qrId', 'validate', 'challenge', 'seccode', 'ticket']) {
      if (x.searchParams.has(k)) x.searchParams.set(k, '***');
    }
    return redactText(x.toString());
  } catch {
    return redactText(u);
  }
}
function pickHeaders(h) {
  const out = {};
  for (const k of ['accept', 'content-type', 'referer', 'origin', 'user-agent', 'x-requested-with', 'x-csrf-token', 'x-zp-client-id', 'x-zp-page-request-id']) {
    if (h[k]) out[k] = redactText(h[k]);
  }
  return out;
}
function safeName(u) {
  try {
    const x = new URL(u);
    let s = (x.pathname || '/').replace(/[^\w.-]+/g, '_').slice(0, 100);
    if (!/\.(json|html|js|png)$/.test(s)) s += '.bin';
    return s;
  } catch {
    return 'unknown.bin';
  }
}

const ZP_HOST = /(^|\.)zhaopin\.(com|cn)$/i;
function isZp(url) {
  try {
    return ZP_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function mkdirs() {
  for (const d of [PROFILE, ART, BODIES, STATES, SCREENS]) {
    await fs.mkdir(d, { recursive: true, mode: 0o700 });
    await fs.chmod(d, 0o700).catch(() => {});
  }
}

/* ------------------------------ 网络采集 ------------------------------ */

function attachPage(page) {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    append(path.join(ART, 'navigations.jsonl'), { ts: now(), type: 'framenavigated', url: redactUrl(frame.url()) }).catch(() => {});
  });
  page.on('load', () => append(path.join(ART, 'navigations.jsonl'), { ts: now(), type: 'load', url: redactUrl(page.url()) }).catch(() => {}));
  page.on('domcontentloaded', () => append(path.join(ART, 'navigations.jsonl'), { ts: now(), type: 'domcontentloaded', url: redactUrl(page.url()) }).catch(() => {}));

  page.on('request', (req) => {
    const rt = req.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(rt)) return;
    if (!isZp(req.url())) return;
    append(path.join(ART, 'network.jsonl'), {
      ts: now(),
      seq: ++netSeq,
      kind: 'request',
      resourceType: rt,
      method: req.method(),
      url: redactUrl(req.url()),
      postData: redactText(req.postData()),
      headers: pickHeaders(req.headers()),
    }).catch(() => {});
  });
  page.on('requestfailed', (req) => {
    const rt = req.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(rt)) return;
    if (!isZp(req.url())) return;
    append(path.join(ART, 'network.jsonl'), {
      ts: now(),
      kind: 'requestfailed',
      resourceType: rt,
      method: req.method(),
      url: redactUrl(req.url()),
      failure: req.failure()?.errorText ?? null,
    }).catch(() => {});
  });
  page.on('response', (res) => {
    const rt = res.request().resourceType();
    if (!['document', 'xhr', 'fetch'].includes(rt)) return;
    const url = res.url();
    if (!isZp(url)) return;
    const headers = res.headers();
    const ct = String(headers['content-type'] || '');
    append(path.join(ART, 'network.jsonl'), { ts: now(), kind: 'response', resourceType: rt, status: res.status(), url: redactUrl(url), contentType: ct }).catch(() => {});

    const wantJson = /json/i.test(ct);
    const wantHtml = rt === 'document' && /html/i.test(ct);
    if (!wantJson && !wantHtml) return;
    const limit = wantHtml ? 4 * 1024 * 1024 : 2 * 1024 * 1024;
    (async () => {
      let body;
      try {
        body = await Promise.race([res.body(), new Promise((_, rej) => setTimeout(() => rej(new Error('body-timeout')), 10000))]);
      } catch {
        return;
      }
      if (!body) return;
      const truncated = body.length > limit;
      const buf = truncated ? body.subarray(0, limit) : body;
      const file = path.join(BODIES, `${String(++fileSeq).padStart(4, '0')}_${safeName(url)}`);
      await fs.writeFile(file, buf, { mode: 0o600 }).catch(() => {});
      await fs.chmod(file, 0o600).catch(() => {});
      append(path.join(ART, 'responses.jsonl'), {
        ts: now(),
        url: redactUrl(url),
        status: res.status(),
        contentType: ct,
        file: path.relative(EXP, file),
        bytes: buf.length,
        truncated,
        sha256: sha256(buf),
      }).catch(() => {});
    })();
  });
  page.on('pageerror', (err) => append(path.join(ART, 'actions.jsonl'), { ts: now(), type: 'pageerror', message: String(err.message || err) }).catch(() => {}));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    append(path.join(ART, 'actions.jsonl'), { ts: now(), type: 'console-error', text: msg.text().slice(0, 500) }).catch(() => {});
  });
}

/* ------------------------------ 工具函数 ------------------------------ */

async function bodyText(page = activePage) {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

async function snapshot(label, page = activePage) {
  const name = `${String(++fileSeq).padStart(4, '0')}_${label.replace(/[^\w-]+/g, '_')}`;
  const shot = path.join(SCREENS, `${name}.png`);
  await page.screenshot({ path: shot, fullPage: false, timeout: 20000 }).catch(() => {});
  await fs.chmod(shot, 0o600).catch(() => {});
  const html = await page.content().catch(() => '');
  const htmlFile = path.join(STATES, `${name}.html`);
  await fs.writeFile(htmlFile, html, { mode: 0o600 }).catch(() => {});
  const body = await bodyText(page);
  const cookies = await page.context().cookies().catch(() => []);
  const cookieSummary = cookies.map((c) => ({ name: c.name, domain: c.domain, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure }));
  await writeJson(path.join(STATES, `${name}.cookies.json`), { ts: now(), cookies: cookieSummary });
  const meta = await page
    .evaluate(() => {
      const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const inputs = [...document.querySelectorAll('input, textarea, select')].map((el) => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), id: el.id || null, cls: String(el.className || '').slice(0, 100), placeholder: el.getAttribute('placeholder'), visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length), box: box(el) }));
      const buttons = [...document.querySelectorAll('button, a, [role="button"], [class*="btn"], [class*="tab"]')]
        .map((el) => ({ tag: el.tagName.toLowerCase(), text: clean(el.innerText).slice(0, 40), cls: String(el.className || '').slice(0, 120), href: el.getAttribute('href')?.slice(0, 160) ?? null, visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) }))
        .filter((b) => b.text || b.href)
        .slice(0, 200);
      const imgs = [...document.querySelectorAll('img')].map((img) => ({ src: String(img.currentSrc || img.src || '').slice(0, 160), cls: String(img.className || '').slice(0, 120), w: img.naturalWidth, h: img.naturalHeight, box: box(img) })).filter((i) => i.w >= 60 && i.h >= 60).slice(0, 30);
      const canvases = [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, cls: String(c.className || '').slice(0, 100), box: box(c) }));
      const frames = [...document.querySelectorAll('iframe')].map((f) => ({ src: String(f.src || '').slice(0, 200), id: f.id || null, cls: String(f.className || ''), box: box(f) }));
      const links = [...document.querySelectorAll('a[href]')].map((a) => ({ text: clean(a.innerText).slice(0, 60), href: a.href.slice(0, 220) })).filter((l) => l.text).slice(0, 400);
      let storage = { local: {}, session: {} };
      try {
        for (const [k, v] of Object.entries(localStorage)) storage.local[k] = String(v).length;
        for (const [k, v] of Object.entries(sessionStorage)) storage.session[k] = String(v).length;
      } catch {
        /* ignore */
      }
      return { url: location.href, title: document.title, inputs, buttons, imgs, canvases, frames, links, storage, userAgent: navigator.userAgent };
    })
    .catch((e) => ({ error: String(e) }));
  const stateFile = path.join(STATES, `${name}.json`);
  await writeJson(stateFile, { ts: now(), label, body: body.slice(0, 12000), screenshot: path.relative(EXP, shot), html: path.relative(EXP, htmlFile), ...meta });
  console.log(`[snapshot] ${label}: url=${redactUrl(meta.url || page.url())} title=${meta.title || ''} inputs=${meta.inputs?.length ?? '?'} imgs=${meta.imgs?.length ?? '?'} shot=${path.relative(EXP, shot)}`);
  return { ...meta, body, screenshot: path.relative(EXP, shot) };
}

async function clickFirstText(page, regex, timeout = 8000) {
  const loc = page.getByText(regex, { exact: false });
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i += 1) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function clickSelector(selector, timeout = 10000) {
  const loc = activePage.locator(selector).first();
  if (await loc.isVisible().catch(() => false)) {
    await loc.click({ timeout }).catch(() => {});
    return true;
  }
  return false;
}

/* ------------------------------ 登录态 ------------------------------ */

let appScanState = null; // { validateId, imgPath, createdAt }

async function cookieNames() {
  const cs = await activePage.context().cookies().catch(() => []);
  return cs.map((c) => c.name);
}

async function fetchUserinfo() {
  return activePage
    .evaluate(async () => {
      try {
        const res = await fetch('https://passport.zhaopin.com/napi/userinfo', { credentials: 'include' });
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 1200) };
      } catch (e) {
        return { error: String(e) };
      }
    })
    .catch((e) => ({ error: String(e) }));
}

async function isLoggedIn() {
  const u = await fetchUserinfo();
  let userinfoOk = false;
  let userId = null;
  let userName = null;
  if (u?.body) {
    try {
      const j = JSON.parse(u.body);
      const d = j.data || {};
      userId = d.userID || d.userId || d.id || null;
      userName = d.userName || d.name || d.showName || null;
      userinfoOk = j.code === 100000 && Boolean(userId);
    } catch {
      /* ignore */
    }
  }
  const body = await bodyText();
  const loggedInHint = /我的简历|消息|退出登录|个人中心/.test(body) && !/登录\/注册/.test(body);
  const names = await cookieNames();
  const tokenish = names.filter((n) => /token|atoken|rtoken|zp_at|fe_api|passport|login|user|smid/i.test(n));
  return { userinfoOk, userId, userName, loggedInHint, url: activePage.url(), cookieNames: names, tokenish, userinfo: u };
}

async function waitLogin(timeoutSec = 180) {
  const start = Date.now();
  const before = new Set(await cookieNames());
  let lastLog = 0;
  while (Date.now() - start < timeoutSec * 1000) {
    const st = await isLoggedIn();
    const names = st.cookieNames;
    const added = names.filter((n) => !before.has(n));
    if (added.length || st.userinfoOk) {
      console.log('[waitlogin] 新增 cookie:', JSON.stringify(added), 'userinfoOk=', st.userinfoOk);
    }
    const url = activePage.url();
    if (!/passport\.zhaopin\.com\/login/.test(url)) {
      console.log('[waitlogin] 已离开登录页:', redactUrl(url));
      await sleep(2500);
      const st2 = await isLoggedIn();
      await snapshot('login-after-redirect');
      await writeJson(path.join(ART, 'login-result.json'), { ts: now(), ok: true, url: redactUrl(activePage.url()), state: st2 });
      return { ok: true, ...st2 };
    }
    if (Date.now() - lastLog > 15000) {
      console.log('[waitlogin] waiting... url=', redactUrl(url), 'body=', (await bodyText()).slice(0, 160));
      lastLog = Date.now();
    }
    await sleep(2500);
  }
  await snapshot('login-timeout');
  return { ok: false };
}

/* ------------------------------ 扫码 / 短信 ------------------------------ */

async function collectQr() {
  const info = await activePage
    .evaluate(async () => {
      const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const out = { url: location.href, body: clean(document.body.innerText).slice(0, 1500), candidates: [], containerHtml: null, iframes: [], canvases: [] };
      // 登录面板容器（扫码/微信/智联APP 各插件）
      const containers = [...document.querySelectorAll('[class*="qrcode"], [class*="qr-code"], [class*="panel-scan"], [class*="zppp-plugin"]')];
      const first = document.querySelector('.zppp-panel-scan-qrcode') || document.querySelector('[class*="qrcode"]') || document.querySelector('.zppp-panel-content');
      if (first) out.containerHtml = String(first.outerHTML).slice(0, 20000);
      for (const img of document.querySelectorAll('img')) {
        const src = String(img.currentSrc || img.src || '');
        const cls = String(img.className || '');
        if (/qr|qrcode|scan/i.test(src) || /qr|qrcode|scan/i.test(cls) || (img.naturalWidth >= 90 && img.naturalWidth <= 400 && img.closest('[class*="qrcode"], [class*="qr"], [class*="scan"]'))) {
          out.candidates.push({ tag: 'img', cls, src, w: img.naturalWidth, h: img.naturalHeight, box: box(img) });
        }
      }
      for (const c of document.querySelectorAll('canvas')) out.canvases.push({ w: c.width, h: c.height, cls: String(c.className || ''), box: box(c) });
      for (const f of document.querySelectorAll('iframe')) out.iframes.push({ src: String(f.src || '').slice(0, 300), cls: String(f.className || ''), box: box(f) });
      const firstImg = out.candidates.find((c) => c.tag === 'img' && c.w > 0);
      if (firstImg) {
        try {
          if (firstImg.src.startsWith('data:')) {
            out.base64 = firstImg.src.split(',')[1] || '';
            out.dataUrl = firstImg.src.slice(0, 64);
          } else {
            const res = await fetch(firstImg.src, { credentials: 'include' });
            const buf = await res.arrayBuffer();
            let bin = '';
            const bytes = new Uint8Array(buf);
            for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
            out.base64 = btoa(bin);
            out.contentType = res.headers.get('content-type');
            out.dataUrl = firstImg.src.slice(0, 160);
          }
        } catch (e) {
          out.error = String(e);
        }
      }
      return out;
    })
    .catch((e) => ({ error: String(e) }));

  const summary = { ...info };
  delete summary.base64;
  await writeJson(path.join(ART, 'qr-info.json'), { ts: now(), ...summary });
  if (info.base64) {
    const buf = Buffer.from(info.base64, 'base64');
    const qrFile = path.join(ART, 'qr.png');
    await fs.writeFile(qrFile, buf, { mode: 0o600 });
    await fs.chmod(qrFile, 0o600).catch(() => {});
    console.log(`[qr] saved ${path.relative(ROOT, qrFile)} (${buf.length} bytes, ${info.contentType || ''})`);
  } else {
    console.log('[qr] 未取到二维码图片；见 qr-info.json（containerHtml/iframes）');
  }
  return info;
}

async function showQrView() {
  // 登录面板顶部有一个二维码切换按钮（.zppp-panel-normal-bar__img）
  const toggled = await clickSelector('.zppp-panel-normal-bar__img', 8000);
  if (!toggled) {
    // 尝试文字入口
    const t = await clickFirstText(activePage, /扫码登录|二维码登录|微信登录|APP扫码/);
    console.log('[qr] toggle click:', { selector: toggled, text: t });
  } else {
    console.log('[qr] clicked .zppp-panel-normal-bar__img');
  }
  await sleep(3500);
  await snapshot('qrcode-view');
  return collectQr();
}

async function appQrInit() {
  // 智联APP扫码：GET /v4/appScan/init?scene=10000060 → { path: /v4/appScan/img/<id>, validateId }
  const res = await activePage
    .evaluate(async () => {
      try {
        const r = await fetch('https://passport.zhaopin.com/v4/appScan/init?scene=10000060', { credentials: 'include' });
        const j = await r.json();
        return { status: r.status, json: j };
      } catch (e) {
        return { error: String(e) };
      }
    })
    .catch((e) => ({ error: String(e) }));
  await writeJson(path.join(ART, `appscan-init-${stamp()}.json`), { ts: now(), res });
  if (!res?.json || res.json.code !== 100000 || !res.json.data?.validateId) {
    console.log('[appqr] init 失败:', JSON.stringify(res).slice(0, 800));
    return null;
  }
  const { validateId, path: imgPath } = res.json.data;
  const imgUrl = `https://passport.zhaopin.com${imgPath}`;
  appScanState = { validateId, imgPath, createdAt: Date.now() };
  // 在页面内 fetch 二维码图片，拿到 base64 落盘
  const img = await activePage
    .evaluate(async (url) => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        const buf = await r.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
        return { status: r.status, contentType: ct, bytes: buf.byteLength, base64: btoa(bin) };
      } catch (e) {
        return { error: String(e) };
      }
    }, imgUrl)
    .catch((e) => ({ error: String(e) }));
  let saved = null;
  if (img?.base64) {
    const buf = Buffer.from(img.base64, 'base64');
    saved = path.join(ART, 'qr-zlapp.png');
    await fs.writeFile(saved, buf, { mode: 0o600 });
    await fs.chmod(saved, 0o600).catch(() => {});
    console.log(`[appqr] QR 已保存: ${path.relative(ROOT, saved)} bytes=${buf.length} contentType=${img.contentType}`);
  } else {
    console.log('[appqr] 二维码图片获取失败:', JSON.stringify(img).slice(0, 500));
  }
  await snapshot('appqr-view');
  await writeJson(path.join(ART, 'qr-info.json'), {
    ts: now(),
    mode: 'zlapp-qrcode',
    scene: 10000060,
    validateId,
    imgUrl,
    saved: saved ? path.relative(EXP, saved) : null,
    imageMeta: img ? { status: img.status, contentType: img.contentType, bytes: img.bytes } : null,
  });
  console.log('[appqr] validateId=', validateId, 'imgUrl=', imgUrl);
  console.log('[appqr] 请用智联招聘 APP 扫码；然后运行 `appscan` 轮询登录结果');
  return appScanState;
}

async function appScanPoll(timeoutSec = 180) {
  if (!appScanState) throw new Error('先运行 appqr 获取二维码（validateId）');
  const { validateId } = appScanState;
  const start = Date.now();
  const before = new Set(await cookieNames());
  let lastCode = null;
  const log = [];
  while (Date.now() - start < timeoutSec * 1000) {
    const res = await activePage
      .evaluate(async (vid) => {
        try {
          const u = new URL('https://passport.zhaopin.com/v4/appScan/login');
          u.searchParams.set('validateId', vid);
          u.searchParams.set('rememberMe', 'true');
          const r = await fetch(u.toString(), { credentials: 'include' });
          return { status: r.status, json: await r.json().catch(() => null) };
        } catch (e) {
          return { error: String(e) };
        }
      }, validateId)
      .catch((e) => ({ error: String(e) }));
    const code = res?.json?.code ?? null;
    const msg = res?.json?.message ?? res?.error ?? '';
    if (code !== lastCode) {
      console.log(`[appscan] code=${code} message=${msg} data=${JSON.stringify(res?.json?.data ?? null).slice(0, 300)}`);
      lastCode = code;
    }
    log.push({ ts: now(), code, message: msg, elapsedMs: Date.now() - start });
    if (code === 100000) {
      // 扫码登录成功
      await writeJson(path.join(ART, `appscan-success-${stamp()}.json`), { ts: now(), res, log });
      await snapshot('appscan-success');
      const added = (await cookieNames()).filter((n) => !before.has(n));
      console.log('[appscan] 新增 cookie:', JSON.stringify(added));
      await sleep(2500);
      // 跳首页并确认登录态
      await activePage.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
      await sleep(9000);
      const st = await isLoggedIn();
      await snapshot('home-after-login');
      await commandCookies();
      await commandStorage();
      await writeJson(path.join(ART, 'login-result.json'), { ts: now(), ok: true, mode: 'zlapp-qrcode', state: st, log });
      console.log('[appscan] LOGIN_OK userinfoOk=', st.userinfoOk, 'userId=', st.userId, 'userName=', st.userName);
      return { ok: true, ...st };
    }
    if (code === 102002 || code === 102003) {
      console.log('[appscan] 二维码失效/登录失败，请重新 appqr');
      await snapshot('appscan-expired');
      return { ok: false, code };
    }
    await sleep(2500);
  }
  await snapshot('appscan-timeout');
  return { ok: false, reason: 'timeout' };
}

async function sendSms(phone) {
  const page = activePage;
  if (!/^1[3-9]\d{9}$/.test(String(phone || ''))) throw new Error('sms 需要合法手机号：sms <11位手机号>');
  const phoneInput = page.locator('input[type="tel"]').first();
  await phoneInput.waitFor({ state: 'visible', timeout: 20000 });
  await phoneInput.click();
  await phoneInput.fill('');
  await phoneInput.pressSequentially(String(phone), { delay: 80 });
  await sleep(600);
  const cb = page.locator('input[type="checkbox"]#accept, input[type="checkbox"]').first();
  if (await cb.isVisible().catch(() => false)) {
    await cb.check({ force: true }).catch(async () => await cb.click({ force: true }).catch(() => {}));
  }
  await snapshot('sms-phone-filled');
  console.log('[sms] clicking 获取验证码 ...');
  const send = page.getByText('获取验证码', { exact: false }).first();
  await send.waitFor({ state: 'visible', timeout: 15000 });
  await send.click({ timeout: 15000 });
  await sleep(4500);
  await snapshot('sms-after-send');
  const body = await bodyText(page);
  await writeJson(path.join(ART, `sms-send-${stamp()}.json`), { ts: now(), url: redactUrl(page.url()), body: body.slice(0, 1200) });
  console.log('[sms] body:', body.slice(0, 600));
  return body;
}

async function submitSmsCode(code) {
  const page = activePage;
  const input = page.locator('input[placeholder*="验证码"]').first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.click();
  await input.fill('');
  await input.pressSequentially(String(code), { delay: 100 });
  await sleep(400);
  const btn = page.locator('.zppp-submit').first();
  if (await btn.isVisible().catch(() => false)) await btn.click({ timeout: 15000 }).catch(() => {});
  await sleep(5000);
  await snapshot('sms-after-code');
  console.log('[sms] after code:', (await bodyText()).slice(0, 400));
  return waitLogin(90);
}

/* ------------------------------ 站点探索 ------------------------------ */

async function commandSearch(kw, jl = '489', city) {
  const u = new URL('https://www.zhaopin.com/jobs/');
  u.searchParams.set('kw', kw);
  if (jl) u.searchParams.set('jl', jl);
  if (city) u.searchParams.set('city', city);
  await activePage.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(9000);
  const s = await snapshot(`search-${kw}-${city || jl}`);
  const jobLinks = (s.links || []).filter((l) => /jobdetail|jobs\.zhaopin/i.test(l.href || ''));
  const companyLinks = (s.links || []).filter((l) => /companydetail|company\.zhaopin/i.test(l.href || ''));
  console.log(JSON.stringify({ url: redactUrl(s.url || activePage.url()), jobLinks: jobLinks.length, companyLinks: companyLinks.length }, null, 2));
  return { jobLinks, companyLinks };
}

async function commandJob(n = 1) {
  const page = activePage;
  const links = page.locator('a[href*="/jobdetail/"]');
  const total = await links.count().catch(() => 0);
  if (!total) throw new Error('当前页面没有 jobdetail 链接（匿名列表可能只有 1 个详情入口）');
  const idx = Math.max(0, Math.min(total - 1, Number(n) - 1));
  const href = await links.nth(idx).getAttribute('href').catch(() => null);
  await links.nth(idx).click({ timeout: 15000 }).catch(async () => await links.nth(idx).evaluate((el) => el.click()));
  await sleep(9000);
  const s = await snapshot(`job-detail-${n}`);
  console.log(JSON.stringify({ href, url: redactUrl(activePage.url()), bodyHead: (s.body || '').slice(0, 300) }, null, 2));
  return { href };
}

async function commandJobUrl(url) {
  await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(9000);
  const s = await snapshot('job-url');
  console.log(JSON.stringify({ url: redactUrl(activePage.url()), bodyHead: (s.body || '').slice(0, 300) }, null, 2));
  return s;
}

async function commandCompany(n = 1) {
  const page = activePage;
  const links = page.locator('a[href*="/companydetail/"], a[href*="company.zhaopin.com"]');
  const total = await links.count().catch(() => 0);
  if (!total) throw new Error('当前页面没有公司链接');
  const idx = Math.max(0, Math.min(total - 1, Number(n) - 1));
  const href = await links.nth(idx).getAttribute('href').catch(() => null);
  const before = new Set(page.context().pages());
  await links.nth(idx).click({ timeout: 15000 }).catch(async () => await links.nth(idx).evaluate((el) => el.click()));
  await sleep(9000);
  const newPage = page.context().pages().find((p) => !before.has(p));
  if (newPage) {
    activePage = newPage;
    await newPage.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
    await sleep(4000);
  }
  const s = await snapshot(`company-detail-${n}`);
  console.log(JSON.stringify({ href, newTab: Boolean(newPage), url: redactUrl(activePage.url()), bodyHead: (s.body || '').slice(0, 300) }, null, 2));
  return { href, newTab: Boolean(newPage) };
}

async function commandCompanyUrl(url) {
  await activePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(9000);
  const s = await snapshot('company-url');
  console.log(JSON.stringify({ url: redactUrl(activePage.url()), bodyHead: (s.body || '').slice(0, 300) }, null, 2));
  return s;
}

async function commandNext(pageNo) {
  const u = new URL(activePage.url());
  u.searchParams.set('p', String(pageNo || 2));
  await activePage.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(9000);
  const s = await snapshot(`search-page-${pageNo || 2}`);
  const jobLinks = (s.links || []).filter((l) => /jobdetail|jobs\.zhaopin/i.test(l.href || ''));
  console.log(JSON.stringify({ url: redactUrl(activePage.url()), jobLinks: jobLinks.length }, null, 2));
  return jobLinks;
}

async function commandScroll(px = 1200) {
  await activePage.evaluate((n) => window.scrollBy(0, n), px).catch(() => {});
  await sleep(3000);
  const s = await snapshot('scroll');
  console.log(JSON.stringify({ url: redactUrl(activePage.url()), bodyLen: (s.body || '').length }, null, 2));
}

async function commandStatus() {
  const info = await activePage
    .evaluate(async () => {
      const out = {};
      const endpoints = [
        ['passport_userinfo', 'https://passport.zhaopin.com/userinfo'],
        ['passport_napi_userinfo', 'https://passport.zhaopin.com/napi/userinfo'],
        ['api_user_info', 'https://fe-api.zhaopin.com/c/i/user/info'],
      ];
      for (const [k, u] of endpoints) {
        try {
          const r = await fetch(u, { credentials: 'include' });
          out[k] = { status: r.status, body: (await r.text()).slice(0, 800) };
        } catch (e) {
          out[k] = { error: String(e) };
        }
      }
      return out;
    })
    .catch((e) => ({ error: String(e) }));
  const file = path.join(ART, `status-${stamp()}.json`);
  await writeJson(file, { ts: now(), url: redactUrl(activePage.url()), info });
  console.log(JSON.stringify(info, null, 2).slice(0, 3000));
  return info;
}

async function commandCookies() {
  const cs = await activePage.context().cookies();
  const summary = cs.map((c) => ({ name: c.name, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
  const file = path.join(ART, `cookies-${stamp()}.json`);
  await writeJson(file, { ts: now(), cookies: summary });
  console.log(JSON.stringify({ count: summary.length, names: summary.map((c) => c.name), file: path.relative(ROOT, file) }, null, 2));
  return summary;
}

async function commandStorage() {
  const st = await activePage
    .evaluate(() => {
      const dump = (s) => {
        const out = {};
        try {
          for (const [k, v] of Object.entries(s)) out[k] = { len: String(v).length };
        } catch {
          /* ignore */
        }
        return out;
      };
      return { local: dump(localStorage), session: dump(sessionStorage) };
    })
    .catch((e) => ({ error: String(e) }));
  const file = path.join(ART, `storage-${stamp()}.json`);
  await writeJson(file, { ts: now(), url: redactUrl(activePage.url()), st });
  console.log(JSON.stringify({ localKeys: Object.keys(st.local || {}), sessionKeys: Object.keys(st.session || {}), file: path.relative(ROOT, file) }, null, 2));
  return st;
}

/* ------------------------------ 坐标 / iframe 交互 ------------------------------ */

async function humanClick(x, y) {
  const page = activePage;
  const px = Number(x);
  const py = Number(y);
  await page.mouse.move(px, py, { steps: 14 });
  await sleep(140);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
  await sleep(800);
  console.log(`[mouseclick] (${px},${py}) url=${redactUrl(page.url())}`);
}

async function frameClick(selector) {
  const page = activePage;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const loc = frame.locator(selector).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        const box = await loc.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
          await sleep(140);
          await page.mouse.down();
          await sleep(90);
          await page.mouse.up();
          await sleep(1200);
          console.log(`[frameclick] ${selector} frame=${redactUrl(frame.url())} at (${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)})`);
          return true;
        }
      }
    } catch {
      /* next frame */
    }
  }
  console.log('[frameclick] not found:', selector);
  return false;
}

async function frameDump() {
  const out = [];
  for (const frame of activePage.frames()) {
    if (frame === activePage.mainFrame()) continue;
    const html = await frame.content().catch(() => '');
    const txt = await frame.locator('body').innerText().catch(() => '');
    out.push({ url: redactUrl(frame.url()), htmlLen: html.length, text: String(txt).replace(/\s+/g, ' ').slice(0, 400) });
  }
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/* ------------------------------ 启动 / REPL ------------------------------ */

async function launch() {
  await mkdirs();
  await writeJson(path.join(ART, 'run.json'), { ts: now(), profile: PROFILE, loginUrl: LOGIN_URL, node: process.version, display: process.env.DISPLAY ?? '<unset>', cwd: process.cwd() });
  console.log('[boot] launching cloakbrowser (headful) ...');
  const ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: false,
    humanize: true,
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    args: ['--start-maximized'],
  });
  ctxRef = ctx;
  ctx.on('page', (p) => attachPage(p));
  for (const p of ctx.pages()) attachPage(p);
  activePage = ctx.pages()[0] ?? (await ctx.newPage());
  baselineCookies = new Set(await cookieNames());
  console.log('[boot] browser ready; profile=', PROFILE, 'cookies=', JSON.stringify([...baselineCookies]));
  await activePage.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(10000);
  await snapshot('login-initial');
  const st = await isLoggedIn();
  console.log('[boot] login page ready; isLoggedIn guess=', JSON.stringify({ userinfoOk: st.userinfoOk, loggedInHint: st.loggedInHint }));
  if (st.loggedInHint || st.userinfoOk) console.log('[boot] 可能已登录（profile 复用），可运行 status/ cookies 确认');
  return ctx;
}

async function doRestart() {
  console.log('[restart] 关闭浏览器并复用同一 profile 重新启动（测试自动登录/会话持久化）...');
  await snapshot('before-restart');
  await commandCookies();
  const before = await cookieNames();
  await ctxRef.close().catch(() => {});
  await sleep(2500);
  const ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: false,
    humanize: true,
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    args: ['--start-maximized'],
  });
  ctxRef = ctx;
  ctx.on('page', (p) => attachPage(p));
  for (const p of ctx.pages()) attachPage(p);
  activePage = ctx.pages()[0] ?? (await ctx.newPage());
  await activePage.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await sleep(8000);
  const after = await cookieNames();
  await snapshot('after-restart');
  console.log('[restart] cookies before=', JSON.stringify(before), 'after=', JSON.stringify(after));
  const st = await isLoggedIn();
  console.log('[restart] loggedIn guess=', JSON.stringify({ userinfoOk: st.userinfoOk, loggedInHint: st.loggedInHint }));
  return st;
}

const HELP = `
=== 命令 ===
appqr                  智联APP扫码：GET /v4/appScan/init → 保存二维码 PNG（artifacts/qr-zlapp.png）
appscan [秒]            轮询 /v4/appScan/login 等扫码结果，成功后跳首页并抓登录态/cookies/storage
qr                     打开登录面板二维码视图（微信扫码），抓取并保存 QR PNG
loginstate             登录态探测（/napi/userinfo + 页面启发式 + cookie 名）
waitlogin [秒]          轮询等待扫码登录完成（默认 180s）
sms <手机号>            短信验证码流程：填手机号 + 点获取验证码（抓验证码挑战）
code <6位短信码>        提交短信验证码并等待登录
status | cookies | storage
nav <url> | home
search <关键词> [jl] [city]     职位搜索（jl/city 为智联城市码）
next [页码] | scroll [px]
job <n> | company <n> | joburl <url> | companyurl <url>
state [label] | body | shot [label] | html [label] | pages | switch <n> | back
eval <js> | click <selector> | clicktext <文本> | wait <ms>
restart | quit | help
================
`;

async function main() {
  await launch();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(HELP);
  while (true) {
    let line;
    try {
      line = (await rl.question('zp> ')).trim();
    } catch {
      break;
    }
    if (!line) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    try {
      switch (cmd) {
        case 'qr': {
          const info = await showQrView();
          console.log('[qr] candidates=', JSON.stringify((info.candidates || []).map((c) => ({ cls: c.cls, w: c.w, h: c.h, src: String(c.src).slice(0, 100) })), null, 2));
          console.log('[qr] iframes=', JSON.stringify(info.iframes || []));
          break;
        }
        case 'appqr':
          await appQrInit();
          break;
        case 'appscan':
          await appScanPoll(Number(rest[0] || 180));
          break;
        case 'loginstate': {
          const st = await isLoggedIn();
          console.log(JSON.stringify({ ...st, userinfo: undefined }, null, 2));
          break;
        }
        case 'waitlogin': {
          await waitLogin(Number(rest[0] || 180));
          break;
        }
        case 'sms':
          await sendSms(rest[0]);
          break;
        case 'code':
          await submitSmsCode(rest[0]);
          break;
        case 'status':
          await commandStatus();
          break;
        case 'cookies':
          await commandCookies();
          break;
        case 'storage':
          await commandStorage();
          break;
        case 'nav':
          await activePage.goto(rest[0], { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
          await sleep(7000);
          await snapshot('nav');
          console.log('url=', redactUrl(activePage.url()));
          break;
        case 'home':
          await activePage.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
          await sleep(8000);
          await snapshot('home');
          break;
        case 'search':
          await commandSearch(rest[0], rest[1], rest[2]);
          break;
        case 'next':
          await commandNext(Number(rest[0] || 2));
          break;
        case 'scroll':
          await commandScroll(Number(rest[0] || 1200));
          break;
        case 'job':
          await commandJob(Number(rest[0] || 1));
          break;
        case 'company':
          await commandCompany(Number(rest[0] || 1));
          break;
        case 'joburl':
          await commandJobUrl(rest[0]);
          break;
        case 'companyurl':
          await commandCompanyUrl(rest[0]);
          break;
        case 'state': {
          const s = await snapshot(rest[0] || 'state');
          console.log(JSON.stringify({ url: redactUrl(s.url || activePage.url()), title: s.title, body: (s.body || '').slice(0, 500), screenshot: s.screenshot }, null, 2));
          break;
        }
        case 'body':
          console.log((await bodyText()).slice(0, 3000));
          break;
        case 'shot':
          console.log('screenshot:', (await snapshot(rest[0] || 'shot')).screenshot);
          break;
        case 'html': {
          const name = (rest[0] || 'page').replace(/[^\w-]+/g, '_');
          const html = await activePage.content().catch(() => '');
          const f = path.join(STATES, `html-${name}-${stamp()}.html`);
          await fs.writeFile(f, html, { mode: 0o600 });
          console.log('saved:', path.relative(ROOT, f), 'bytes=', html.length);
          break;
        }
        case 'pages': {
          const pages = activePage.context().pages();
          for (let i = 0; i < pages.length; i += 1) console.log(i, pages[i] === activePage ? '[active]' : '', redactUrl(pages[i].url()));
          break;
        }
        case 'switch': {
          const pages = activePage.context().pages();
          const p = pages[Number(rest[0])];
          if (p) {
            activePage = p;
            console.log('active=', redactUrl(p.url()));
          } else console.log('no such page');
          break;
        }
        case 'back':
          await activePage.goBack({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await sleep(4000);
          await snapshot('back');
          console.log('url=', redactUrl(activePage.url()));
          break;
        case 'eval':
          console.log(JSON.stringify(await activePage.evaluate(rest.join(' ')).catch((e) => ({ error: String(e) }))).slice(0, 4000));
          break;
        case 'click':
          console.log('[click]', await clickSelector(rest[0]));
          await sleep(2000);
          break;
        case 'clicktext':
          console.log('[clicktext]', await clickFirstText(activePage, new RegExp(rest.join(' '))));
          await sleep(2500);
          break;
        case 'mouseclick':
          await humanClick(rest[0], rest[1]);
          break;
        case 'frameclick':
          await frameClick(rest[0]);
          break;
        case 'framedump':
          await frameDump();
          break;
        case 'wait':
          await sleep(Number(rest[0] || 1000));
          break;
        case 'restart':
          await doRestart();
          break;
        case 'quit':
          await snapshot('before-quit');
          await commandCookies();
          await ctxRef?.close().catch(() => {});
          rl.close();
          console.log('[quit] browser closed');
          return;
        case 'help':
          console.log(HELP);
          break;
        default:
          console.log('unknown command:', cmd, '(type help)');
      }
    } catch (err) {
      console.log('ERROR:', String(err?.stack || err));
    }
  }
  await ctxRef?.close().catch(() => {});
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
