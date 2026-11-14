#!/usr/bin/env node
/**
 * 智联招聘探路阶段 1：登录页 / 首页 / 搜索页结构与网络侦察（2026-11-14）
 *
 * 目标：在写 PRD/接口草案之前，先摸清 passport.zhaopin.com 的登录控件（扫码/短信/密码）、
 * 登录相关请求、www.zhaopin.com 首页与职位搜索页的 URL/API/DOM 结构。
 *
 * 运行：
 *   cd ~/zhilian-client && ~/cloak-env/bin/cloak-run node exploration/2026-11-14/probe.mjs
 *
 * 注意：
 * - 使用独立 profile：~/.zhilian-client/profile（0700），不与 boss-client / tanji-client 共用
 * - 手机号/验证码/Cookie value 不写日志；只记录 name/domain/expires
 * - 产物在 exploration/2026-11-14/artifacts/，全部 0600/0700
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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
const SEARCH_PROBE = 'https://www.zhaopin.com/sou/?kw=%E5%A4%96%E8%B4%B8&city=530';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const stamp = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let fileSeq = 0;
let netSeq = 0;
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
  t = t.replace(/(phone|mobile|tel|smsCode|verifyCode|password|token|cookie|validate|seccode|challenge)=([^&\s"]*)/gi, '$1=***');
  t = t.replace(/1[3-9]\d{9}/g, '1**********');
  t = t.replace(/(\d{6})/g, (m) => (m.length === 6 ? '******' : m)); // 短信码等 6 位数字
  return t;
}
function redactUrl(u) {
  try {
    const x = new URL(u);
    for (const k of ['phone', 'mobile', 'tel', 'smsCode', 'verifyCode', 'code', 'password', 'token', 'uuid', 'qrId', 'validate', 'challenge', 'seccode']) {
      if (x.searchParams.has(k)) x.searchParams.set(k, '***');
    }
    return redactText(x.toString());
  } catch {
    return redactText(u);
  }
}
function pickHeaders(h) {
  const out = {};
  for (const k of ['accept', 'content-type', 'referer', 'origin', 'user-agent', 'x-requested-with', 'x-csrf-token', 'x-zp-client-id']) {
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
    const h = new URL(url).hostname;
    return ZP_HOST.test(h) || /zhaopin\.cn$/i.test(h);
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

async function bodyText(page) {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

async function snapshot(page, label) {
  const shot = path.join(SCREENS, `${String(++fileSeq).padStart(4, '0')}_${label.replace(/[^\w-]+/g, '_')}.png`);
  await page.screenshot({ path: shot, fullPage: false, timeout: 20000 }).catch(() => {});
  await fs.chmod(shot, 0o600).catch(() => {});
  const body = await bodyText(page);
  const html = await page.content().catch(() => '');
  const name = `${String(++fileSeq).padStart(4, '0')}_${label.replace(/[^\w-]+/g, '_')}`;
  const htmlFile = path.join(STATES, `${name}.html`);
  await fs.writeFile(htmlFile, html, { mode: 0o600 }).catch(() => {});

  const info = await page
    .evaluate(() => {
      const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const inputs = [...document.querySelectorAll('input, textarea, select')].map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.id || null,
        cls: el.className ? String(el.className).slice(0, 120) : null,
        placeholder: el.getAttribute('placeholder'),
        maxlength: el.getAttribute('maxlength'),
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        box: box(el),
      }));
      const buttons = [...document.querySelectorAll('button, a, [role="button"], .btn, [class*="btn"]')]
        .map((el) => ({ tag: el.tagName.toLowerCase(), text: clean(el.innerText).slice(0, 40), cls: String(el.className || '').slice(0, 120), id: el.id || null, href: el.getAttribute('href')?.slice(0, 200) ?? null, visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) }))
        .filter((b) => b.text || b.href)
        .slice(0, 200);
      const frames = [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src, id: f.id || null, cls: String(f.className || ''), box: box(f) }));
      const imgs = [...document.querySelectorAll('img')]
        .map((img) => ({ src: String(img.currentSrc || img.src || '').slice(0, 160), cls: String(img.className || '').slice(0, 120), w: img.naturalWidth, h: img.naturalHeight, box: box(img) }))
        .filter((i) => i.w >= 80 && i.h >= 80)
        .slice(0, 30);
      const canvases = [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, cls: String(c.className || '').slice(0, 120), box: box(c) }));
      const links = [...document.querySelectorAll('a[href]')]
        .map((a) => ({ text: clean(a.innerText).slice(0, 50), href: a.href.slice(0, 200) }))
        .filter((l) => l.text)
        .slice(0, 300);
      let storage = { local: {}, session: {} };
      try {
        for (const [k, v] of Object.entries(localStorage)) storage.local[k] = String(v).length;
        for (const [k, v] of Object.entries(sessionStorage)) storage.session[k] = String(v).length;
      } catch {
        /* ignore */
      }
      return { url: location.href, title: document.title, inputs, buttons, frames, imgs, canvases, links, storage };
    })
    .catch((e) => ({ error: String(e) }));

  const cookies = await page.context().cookies().then((cs) => cs.map((c) => ({ name: c.name, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }))).catch(() => []);
  const cookiesFile = path.join(STATES, `${name}.cookies.json`);
  await writeJson(cookiesFile, { ts: now(), cookies });

  const stateFile = path.join(STATES, `${name}.json`);
  await writeJson(stateFile, { ts: now(), label, body: body.slice(0, 8000), screenshot: path.relative(EXP, shot), html: path.relative(EXP, htmlFile), cookies: path.relative(EXP, cookiesFile), ...info });
  console.log(`[snapshot] ${label}: url=${redactUrl(info.url || '')} title=${info.title || ''} inputs=${info.inputs?.length ?? '?'} iframes=${info.frames?.length ?? '?'} imgs=${info.imgs?.length ?? '?'} canvases=${info.canvases?.length ?? '?'} shot=${path.relative(EXP, shot)}`);
  return { ...info, body, screenshot: path.relative(EXP, shot) };
}

function attachPage(page) {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    append(path.join(ART, 'navigations.jsonl'), { ts: now(), type: 'framenavigated', url: redactUrl(frame.url()) }).catch(() => {});
  });
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
    const req = res.request();
    const rt = req.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(rt)) return;
    const url = res.url();
    if (!isZp(url)) return;
    const headers = res.headers();
    const ct = String(headers['content-type'] || '');
    append(path.join(ART, 'network.jsonl'), { ts: now(), kind: 'response', resourceType: rt, status: res.status(), url: redactUrl(url), contentType: ct }).catch(() => {});

    const wantJson = /json/i.test(ct) && /zhaopin\.(com|cn)/i.test(url);
    const wantHtml = rt === 'document' && /html/i.test(ct) && /zhaopin\.(com|cn)/i.test(url);
    if (!wantJson && !wantHtml) return;
    const limit = wantHtml ? 3 * 1024 * 1024 : 1024 * 1024;
    (async () => {
      let body;
      try {
        body = await Promise.race([res.body(), new Promise((_, rej) => setTimeout(() => rej(new Error('body-timeout')), 8000))]);
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

async function main() {
  await mkdirs();
  await writeJson(path.join(ART, 'run.json'), { ts: now(), profile: PROFILE, loginUrl: LOGIN_URL, node: process.version, display: process.env.DISPLAY, cwd: process.cwd() });
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
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  attachPage(page);
  ctx.on('page', (p) => attachPage(p));
  console.log('[boot] browser ready; profile=', PROFILE);

  try {
    console.log('[nav] login page ...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    await sleep(12000);
    const loginSnap = await snapshot(page, 'login-page');
    await writeJson(path.join(ART, 'login-page-summary.json'), {
      ts: now(),
      url: loginSnap.url,
      title: loginSnap.title,
      body: loginSnap.body.slice(0, 4000),
      inputs: loginSnap.inputs,
      frames: loginSnap.frames,
      imgs: loginSnap.imgs,
      canvases: loginSnap.canvases,
      storage: loginSnap.storage,
    });

    // 尝试找出登录方式 tab 的文案（扫码/验证码/密码/微信/QQ）
    const tabTexts = (loginSnap.buttons || [])
      .map((b) => b.text)
      .filter((t) => /扫码|二维码|验证码|密码|登录|微信|QQ|APP/i.test(t));
    console.log('[login-tabs]', JSON.stringify([...new Set(tabTexts)].slice(0, 30)));

    console.log('[nav] home page ...');
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    await sleep(10000);
    await snapshot(page, 'home');

    console.log('[nav] search probe (anonymous) ...');
    await page.goto(SEARCH_PROBE, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    await sleep(12000);
    const searchSnap = await snapshot(page, 'search-anonymous');
    await writeJson(path.join(ART, 'search-anonymous-summary.json'), {
      ts: now(),
      url: searchSnap.url,
      title: searchSnap.title,
      body: searchSnap.body.slice(0, 4000),
      jobLinks: (searchSnap.links || []).filter((l) => /jobdetail|jobs\.zhaopin|position/i.test(l.href || '')).slice(0, 20),
      companyLinks: (searchSnap.links || []).filter((l) => /company/i.test(l.href || '')).slice(0, 20),
    });
    console.log('[search] jobLinks=', (searchSnap.links || []).filter((l) => /jobdetail|jobs\.zhaopin/i.test(l.href || '')).length, 'companyLinks=', (searchSnap.links || []).filter((l) => /company/i.test(l.href || '')).length);
  } finally {
    await sleep(1000);
    await ctx.close().catch(() => {});
    console.log('[done] browser closed');
  }
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
