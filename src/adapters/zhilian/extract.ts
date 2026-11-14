/**
 * 智联页面提取与交互：SSR __INITIAL_STATE__ 解析、EdgeOne 挑战、登录 DOM、极验/NC
 */
import type { Frame, Page } from 'playwright-core';
import { ZhilianError } from '../../errors/catalog.js';
import type { VerificationChallenge, VerificationSolveRequest } from '../../domain/login.js';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 从 SSR HTML 中提取 __INITIAL_STATE__（同时兼容 `window.__INITIAL_STATE__=`） */
export function extractInitialState(html: string): unknown | null {
  const marker = '__INITIAL_STATE__';
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = html.indexOf('{', idx + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function isEdgeChallengeHtml(html: string): boolean {
  if (!html) return false;
  if (/Security Verification/i.test(html)) return true;
  if (/TEOCaptchaWidget/.test(html)) return true;
  if (/正在验证连接安全性|确认您是真人/.test(html)) return true;
  // 第一阶段 JS 挑战：小体积混淆脚本，写 EO_Bot_Ssid / __tst_status 后重载
  if (html.length < 8000 && /EO_Bot_Ssid|__tst_status/.test(html) && !/__INITIAL_STATE__/.test(html)) return true;
  return false;
}

export function isLoginPage(page: Page): boolean {
  return /passport\.zhaopin\.com\/login/.test(page.url());
}

export async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

export async function screenshotBase64(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: 'png', timeout: 20000 }).catch(() => null);
  return buf ? `data:image/png;base64,${buf.toString('base64')}` : '';
}

export async function clickFirstText(page: Page, regex: RegExp, timeout = 8000): Promise<boolean> {
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

/* ------------------------------------------------------------------ */
/* EdgeOne 人机验证                                                     */
/* ------------------------------------------------------------------ */

function findChallengeFrame(page: Page): Frame | null {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (/captcha\.eo\.gtimg\.com|captcha\.eo\.qq\.com|t\.captcha\.qq\.com/i.test(frame.url())) return frame;
  }
  return null;
}

export async function captureEdgeChallenge(page: Page, url?: string): Promise<VerificationChallenge> {
  const frame = findChallengeFrame(page);
  let iframeBox: { x: number; y: number; w: number; h: number } | undefined;
  let checkboxBox: { x: number; y: number; w: number; h: number } | undefined;
  if (frame) {
    const el = page.locator('#tcaptcha_iframe_eo').first();
    const box = await el.boundingBox().catch(() => null);
    if (box) iframeBox = { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
    const cb = frame.locator('#verifyCheckbox').first();
    const cbox = await cb.boundingBox().catch(() => null);
    if (cbox) checkboxBox = { x: Math.round(cbox.x), y: Math.round(cbox.y), w: Math.round(cbox.width), h: Math.round(cbox.height) };
  }
  const body = await bodyText(page);
  return {
    kind: 'edgeone',
    prompt: /确认您是真人/.test(body) ? '正在验证连接安全性，请勾选下方复选框。' : 'EdgeOne 人机验证',
    ...(url ? { url } : {}),
    image: { width: 1440, height: 900 },
    ...(await screenshotBase64(page).then((s) => (s ? { screenshotBase64: s } : {}))),
    ...(iframeBox ? { iframe: { selector: '#tcaptcha_iframe_eo', box: iframeBox } } : {}),
    ...(checkboxBox ? { checkbox: { selector: '#verifyCheckbox', box: checkboxBox } } : {}),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

export async function edgeChallengeVisible(page: Page): Promise<boolean> {
  if (/Security Verification/i.test(await page.title().catch(() => ''))) return true;
  const body = await bodyText(page);
  return /确认您是真人|正在验证连接安全性/.test(body);
}

async function clickFrameCheckbox(page: Page): Promise<boolean> {
  const frame = findChallengeFrame(page);
  if (frame) {
    const cb = frame.locator('#verifyCheckbox').first();
    const box = await cb.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
      await sleep(120);
      await page.mouse.down();
      await sleep(80);
      await page.mouse.up();
      return true;
    }
  }
  return false;
}

export async function solveEdgeChallenge(page: Page, answer: VerificationSolveRequest & { kind: 'edgeone' }): Promise<boolean> {
  if (!(await edgeChallengeVisible(page))) return true;
  if (answer.points && answer.points.length) {
    const vp = page.viewportSize() ?? { width: 1440, height: 900 };
    for (const p of answer.points) {
      const x = Math.max(0, Math.min(vp.width - 1, p.x * vp.width));
      const y = Math.max(0, Math.min(vp.height - 1, p.y * vp.height));
      await page.mouse.move(x, y, { steps: 10 });
      await sleep(100);
      await page.mouse.down();
      await sleep(80);
      await page.mouse.up();
      await sleep(400);
    }
  } else {
    await clickFrameCheckbox(page);
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (!(await edgeChallengeVisible(page))) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 登录验证码（极验 v4 / 阿里 NC）                                        */
/* ------------------------------------------------------------------ */

export async function captureLoginCaptcha(page: Page): Promise<VerificationChallenge | null> {
  const body = await bodyText(page);
  const geetestVisible = await page.locator('.geetest_holder, .geetest_window, .geetest_item_wrap').first().isVisible().catch(() => false);
  if (geetestVisible || /请在下图依次点击|拖动滑块|请完成验证/.test(body)) {
    const main = page.locator('.geetest_item_wrap, .geetest_window').first();
    const box = await main.boundingBox().catch(() => null);
    const mainBuf = await main.screenshot({ type: 'png' }).catch(() => null);
    const tipLoc = page.locator('.geetest_tip_img').first();
    const tipBuf = await tipLoc.screenshot({ type: 'png' }).catch(() => null);
    const prompt = (await page.locator('.geetest_tip_content').first().innerText().catch(() => '')).trim();
    const isSlider = /拖动滑块|滑块完成拼图/.test(body);
    return {
      kind: 'geetest',
      prompt: prompt || (isSlider ? '拖动滑块完成拼图' : '请在下图依次点击：'),
      image: { width: Math.round(box?.width ?? 333), height: Math.round(box?.height ?? 333) },
      ...(mainBuf ? { mainBase64: `data:image/png;base64,${mainBuf.toString('base64')}` } : {}),
      ...(tipBuf ? { tipBase64: `data:image/png;base64,${tipBuf.toString('base64')}` } : {}),
      ...(await screenshotBase64(page).then((s) => (s ? { screenshotBase64: s } : {}))),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }
  const ncVisible = await page.locator('#passport-ali-ncpc-container .nc-container, .nc-container').first().isVisible().catch(() => false);
  if (ncVisible) {
    return {
      kind: 'nc',
      prompt: '阿里 NC 无痕验证（通常自动通过；必要时提交点击坐标）',
      image: { width: 1440, height: 900 },
      ...(await screenshotBase64(page).then((s) => (s ? { screenshotBase64: s } : {}))),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }
  return null;
}

export async function solveGeetest(page: Page, answer: { points?: Array<{ x: number; y: number }>; offsetRatio?: number; offsetPx?: number }): Promise<boolean> {
  if (answer.points && answer.points.length) {
    const main = page.locator('.geetest_item_wrap, .geetest_window').first();
    const box = await main.boundingBox().catch(() => null);
    if (!box) throw new ZhilianError('UPSTREAM_CHANGED', '未找到极验主图');
    for (const p of answer.points) {
      await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height, { steps: 10 });
      await sleep(120);
      await page.mouse.down();
      await sleep(80);
      await page.mouse.up();
      await sleep(500);
    }
    const commit = page.locator('.geetest_commit').first();
    if (await commit.isVisible().catch(() => false)) {
      await commit.click({ timeout: 8000 }).catch(() => {});
      await sleep(2500);
    }
  } else {
    const btn = page.locator('.geetest_slider_button').first();
    const slider = page.locator('.geetest_slider').first();
    const btnBox = await btn.boundingBox().catch(() => null);
    const sliderBox = await slider.boundingBox().catch(() => null);
    if (!btnBox || !sliderBox) throw new ZhilianError('UPSTREAM_CHANGED', '未找到极验滑块');
    const max = Math.max(1, sliderBox.width - btnBox.width);
    const distance = answer.offsetRatio !== undefined ? answer.offsetRatio * max : Number(answer.offsetPx ?? 0);
    const sx = btnBox.x + btnBox.width / 2;
    const sy = btnBox.y + btnBox.height / 2;
    await page.mouse.move(sx, sy, { steps: 8 });
    await sleep(180);
    await page.mouse.down();
    await sleep(200);
    const steps = 60;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await page.mouse.move(sx + distance * eased, sy + Math.sin(t * Math.PI * 4) * 0.6, { steps: 1 });
      await sleep(6 + Math.round(12 * Math.abs(Math.sin(i * 1.7))));
    }
    await page.mouse.move(sx + distance, sy, { steps: 2 });
    await sleep(500);
    await page.mouse.up();
    await sleep(3000);
  }
  const again = await captureLoginCaptcha(page);
  return again === null;
}

/* ------------------------------------------------------------------ */
/* 短信登录 DOM 交互                                                    */
/* ------------------------------------------------------------------ */

export async function ensureSmsPanel(page: Page): Promise<void> {
  const smsInput = page.locator('input[type="tel"]').first();
  if (await smsInput.isVisible().catch(() => false)) return;
  await clickFirstText(page, /验证码登录|短信验证码登录/);
  await sleep(1500);
}

export async function fillPhone(page: Page, phone: string): Promise<void> {
  const tel = page.locator('input[type="tel"]').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.click();
  await tel.fill('');
  await tel.pressSequentially(phone, { delay: 70 });
  await sleep(400);
  const cb = page.locator('input#accept, input[type="checkbox"]').first();
  if (await cb.isVisible().catch(() => false)) {
    await cb.check({ force: true }).catch(async () => {
      await cb.click({ force: true }).catch(() => {});
    });
  }
}

export async function clickSendSms(page: Page): Promise<void> {
  const send = page.getByText('获取验证码', { exact: false }).first();
  await send.waitFor({ state: 'visible', timeout: 15000 });
  await send.click({ timeout: 15000 });
  await sleep(2500);
}

export async function waitSmsSent(page: Page, timeoutMs = 12000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const body = await bodyText(page);
    if (/秒后重新获取|重新获取|验证码已发送|已发送/.test(body)) return true;
    await sleep(800);
  }
  return false;
}

export async function submitSmsCode(page: Page, code: string): Promise<void> {
  const input = page.locator('input[placeholder*="验证码"], input[placeholder*="短信"]').first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.click();
  await input.fill('');
  await input.pressSequentially(code, { delay: 90 });
  await sleep(400);
  const submit = page.locator('.zppp-submit').first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click({ timeout: 15000 }).catch(() => {});
  } else {
    await clickFirstText(page, /登录\/注册|^登录$/);
  }
  await sleep(3000);
}

export async function waitLoginRedirect(page: Page, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isLoginPage(page)) return true;
    await sleep(1500);
  }
  return !isLoginPage(page);
}
