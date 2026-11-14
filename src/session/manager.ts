/**
 * 会话管理器：浏览器生命周期 + 单实例锁 + 心跳 + 登录中继（APP扫码/短信）+ 人机验证中继 + token 续期
 */
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { Config } from '../config/schema.js';
import type { BrowserHost } from '../browser/types.js';
import { CloakBrowserHost } from '../browser/cloak.js';
import { PageZhilianApiClient, type ZhilianRequestStats } from '../adapters/zhilian/client.js';
import { appScanImgUrl, appScanInitUrl, appScanLoginUrl, ZHILIAN_ENDPOINTS } from '../adapters/zhilian/endpoints.js';
import {
  bodyText,
  captureEdgeChallenge,
  captureLoginCaptcha,
  clickFirstText,
  clickSendSms,
  edgeChallengeVisible,
  ensureSmsPanel,
  fillPhone,
  isLoginPage,
  sleep,
  solveEdgeChallenge,
  solveGeetest,
  submitSmsCode,
  waitLoginRedirect,
  waitSmsSent,
} from '../adapters/zhilian/extract.js';
import { RawAppScanInitSchema, RawAppScanPollSchema, okCode } from '../adapters/zhilian/raw.js';
import { ZhilianError } from '../errors/catalog.js';
import type { Logger } from '../utils/logger.js';
import type { HealthValue, Status } from '../domain/status.js';
import type {
  LoginMode,
  LoginSession,
  LoginStartRequest,
  VerificationChallenge,
  VerificationSolveRequest,
  VerificationStatus,
} from '../domain/login.js';
import { maskName, maskPhone } from '../domain/common.js';

interface LoginInternal {
  loginId: string;
  mode: LoginMode;
  state: LoginSession['state'];
  phone?: string;
  createdAt: number;
  expiresAt: number;
  qr?: { pngBase64: string; image: { width: number; height: number }; expiresAt: string };
  sms?: { codeSentAt?: string; resendAfterSec?: number };
  verification?: VerificationChallenge;
  message?: string;
  validateId?: string;
  pollTimer?: NodeJS.Timeout;
}

export interface SessionSnapshot {
  loggedIn: boolean;
  mode: 'logged_in' | 'anonymous';
  health: HealthValue;
  browserConnected: boolean;
  verificationPending: boolean;
}

export interface SessionManager {
  ensureStarted(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  page(): Page;
  client(): PageZhilianApiClient;
  status(): Promise<Status>;
  isLoggedIn(): Promise<boolean>;
  refreshSession(): Promise<boolean>;
  loginStart(req: LoginStartRequest): Promise<LoginSession>;
  loginGet(loginId: string): Promise<LoginSession>;
  loginSms(loginId: string, code: string): Promise<LoginSession>;
  loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }>;
  verificationGet(): VerificationStatus;
  verificationSolve(answer: VerificationSolveRequest): Promise<{ solved: boolean; verification: VerificationStatus; message?: string }>;
  requestStats(): ZhilianRequestStats;
  snapshot(): SessionSnapshot;
}

export class DefaultSessionManager implements SessionManager {
  private host: BrowserHost | null = null;
  private api: PageZhilianApiClient | null = null;
  private state: HealthValue = 'stopped';
  private startedAt: number | null = null;
  private lastCheckedAt: number | null = null;
  private starting: Promise<void> | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lockFd: number | null = null;
  private lockPath: string | null = null;
  private login: LoginInternal | null = null;
  private pendingVerification: VerificationChallenge | null = null;
  private lastEdgeSolvedAt: number | null = null;
  private lastAccount: Status['account'] = {};
  private lastLoggedIn = false;
  private lastRefreshAt: number | null = null;

  constructor(
    private readonly cfg: Config,
    private readonly logger?: Logger,
  ) {}

  isRunning(): boolean {
    return this.host?.isConnected() ?? false;
  }

  async ensureStarted(): Promise<void> {
    if (this.isRunning()) return;
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;
    this.acquireLock();
    try {
      this.state = 'stopped';
      const host = new CloakBrowserHost({
        headless: this.cfg.headless,
        profileDir: this.cfg.profileDir,
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
        humanize: this.cfg.humanize,
      });
      await host.start();
      await host.page().goto(this.cfg.baseUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.session.requestTimeoutMs }).catch(() => {});
      await host.page().waitForTimeout(2000);
      this.host = host;
      this.api = new PageZhilianApiClient(
        host.page(),
        {
          baseUrl: this.cfg.baseUrl,
          apiBase: this.cfg.apiBase,
          timeoutMs: this.cfg.session.requestTimeoutMs,
          ratePerMin: this.cfg.session.ratePerMin,
          pageJitterMs: 300,
          cooldownSec: this.cfg.session.cooldownSec,
        },
        { onEdgeChallenge: (url) => this.handleEdgeChallenge(url) },
      );
      this.startedAt = Date.now();
      const loggedIn = await this.isLoggedIn().catch(() => false);
      this.lastLoggedIn = loggedIn;
      this.state = loggedIn ? 'ok' : 'logged_out';
      this.lastCheckedAt = Date.now();
      this.startHeartbeat();
      this.logger?.info('session.started', { profileDir: this.cfg.profileDir, headless: this.cfg.headless, loggedIn });
    } catch (err) {
      this.releaseLock();
      this.state = 'stopped';
      throw err instanceof ZhilianError ? err : new ZhilianError('UPSTREAM_UNAVAILABLE', `浏览器启动失败：${String(err)}`, { cause: err });
    }
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    if (this.login?.pollTimer) clearInterval(this.login.pollTimer);
    this.login = null;
    await this.host?.close().catch(() => {});
    this.host = null;
    this.api = null;
    this.startedAt = null;
    this.state = 'stopped';
    this.releaseLock();
    this.logger?.info('session.stopped');
  }

  page(): Page {
    if (!this.host) throw new ZhilianError('AUTH_REQUIRED', '浏览器会话未启动');
    return this.host.page();
  }

  client(): PageZhilianApiClient {
    if (!this.api) throw new ZhilianError('AUTH_REQUIRED', '浏览器会话未启动');
    return this.api;
  }

  requestStats(): ZhilianRequestStats {
    return this.api?.stats() ?? { requests: 0, blockCount: 0 };
  }

  snapshot(): SessionSnapshot {
    const browserConnected = this.isRunning();
    const verificationPending = this.pendingVerification !== null;
    const loggedIn = browserConnected && this.lastLoggedIn;
    return {
      loggedIn,
      mode: loggedIn ? 'logged_in' : 'anonymous',
      health: this.state,
      browserConnected,
      verificationPending,
    };
  }

  async isLoggedIn(): Promise<boolean> {
    if (!this.api) return false;
    try {
      const ok = await this.api.getCheckToken();
      this.lastLoggedIn = ok;
      return ok;
    } catch {
      return false;
    }
  }

  async refreshSession(): Promise<boolean> {
    if (!this.api) return false;
    try {
      const { rt } = await this.api.getAtRt();
      if (!rt) return false;
      const res = await this.api.refreshToken(rt);
      if (res.code !== 200 || !res.at) return false;
      await this.api.setAuthCookies({
        at: res.at,
        ...(res.atExpire !== undefined ? { atExpire: res.atExpire } : {}),
        ...(res.rt ? { rt: res.rt } : {}),
        ...(res.rtExpire !== undefined ? { rtExpire: res.rtExpire } : {}),
      });
      this.lastRefreshAt = Date.now();
      this.lastLoggedIn = true;
      this.logger?.info('session.refreshed', { atExpire: res.atExpire, rtExpire: res.rtExpire });
      return true;
    } catch (err) {
      this.logger?.warn('session.refresh.failed', { message: String(err) });
      return false;
    }
  }

  async status(): Promise<Status> {
    const profileDir = this.cfg.profileDir;
    const base: Status = {
      loggedIn: false,
      mode: 'anonymous',
      health: 'stopped',
      account: {},
      session: { profileDir },
      verification: { pending: this.pendingVerification !== null, kind: this.pendingVerification?.kind ?? null },
      risk: { blockCount: 0 },
      requests: { today: 0, cacheHits: 0, cacheMisses: 0 },
      warnings: [],
    };
    if (!this.host || !this.api) {
      return { ...base, message: '浏览器会话未启动：请执行 `zhilian login`' };
    }
    let loggedIn = this.lastLoggedIn;
    let account: Status['account'] = this.lastAccount;
    if (this.cfg.session.checkTokenOnStatus) {
      loggedIn = await this.api.getCheckToken().catch(() => false);
      if (loggedIn) {
        const user = await this.api.getUserDetail().catch(() => null);
        const id = user?.data?.Id ?? user?.data?.id ?? user?.data?.userId;
        account = {
          ...(this.cfg.phone ? { phoneMasked: maskPhone(this.cfg.phone) } : {}),
          ...(user?.data?.Name ?? user?.data?.name ? { nameMasked: maskName(user?.data?.Name ?? user?.data?.name) } : {}),
          ...(id !== undefined ? { userIdTail: String(id).slice(-3) } : {}),
        };
        this.lastAccount = account;
      }
    }
    this.lastLoggedIn = loggedIn;
    this.lastCheckedAt = Date.now();

    // token 到期与主动续期
    const atExpiresAt = await this.api.cookieExpiryIso('at');
    const rtExpiresAt = await this.api.cookieExpiryIso('rt');
    const atRemain = atExpiresAt ? Math.floor((Date.parse(atExpiresAt) - Date.now()) / 1000) : undefined;
    if (loggedIn && atRemain !== undefined && atRemain < this.cfg.session.refreshAtBeforeSec) {
      const refreshed = await this.refreshSession().catch(() => false);
      if (refreshed) {
        this.lastCheckedAt = Date.now();
      }
    }
    const session = await this.sessionInfo();
    const riskStats = this.api.stats();
    const warnings: string[] = [];
    if (session.remainingSec !== undefined && session.remainingSec < 24 * 3600) warnings.push('session_expiring_soon');
    if (this.pendingVerification) warnings.push('verification_pending');
    if (!loggedIn && this.cfg.anonymous) warnings.push('anonymous_mode');
    if (riskStats.cooldownUntil && riskStats.cooldownUntil > Date.now()) warnings.push('upstream_cooldown');

    let health: HealthValue;
    if (riskStats.cooldownUntil && riskStats.cooldownUntil > Date.now()) health = 'cooldown';
    else if (this.pendingVerification) health = 'needs_human';
    else if (!loggedIn) health = this.login ? 'needs_human' : 'logged_out';
    else if (atRemain !== undefined && atRemain < 24 * 3600) health = 'degraded';
    else health = 'ok';
    this.state = health;
    const edgeTokenExpiresAt = await this.api.cookieExpiryIso('EO-Bot-Captcha-Token');
    return {
      loggedIn,
      mode: loggedIn ? 'logged_in' : 'anonymous',
      health,
      account,
      session: { profileDir, ...(this.startedAt ? { startedAt: new Date(this.startedAt).toISOString() } : {}), ...(this.lastCheckedAt ? { lastCheckedAt: new Date(this.lastCheckedAt).toISOString() } : {}), ...session },
      verification: {
        pending: this.pendingVerification !== null,
        kind: this.pendingVerification?.kind ?? null,
        ...(edgeTokenExpiresAt ? { edgeTokenExpiresAt } : {}),
        ...(this.lastEdgeSolvedAt ? { lastEdgeSolvedAt: new Date(this.lastEdgeSolvedAt).toISOString() } : {}),
      },
      risk: {
        ...(riskStats.cooldownUntil ? { cooldownUntil: new Date(riskStats.cooldownUntil).toISOString() } : {}),
        blockCount: riskStats.blockCount,
        ...(riskStats.lastError ? { lastError: riskStats.lastError } : {}),
      },
      requests: {
        today: riskStats.requests,
        cacheHits: 0,
        cacheMisses: 0,
        ...(riskStats.lastUpstreamAt ? { lastUpstreamAt: new Date(riskStats.lastUpstreamAt).toISOString() } : {}),
      },
      warnings,
      ...(loggedIn ? {} : { message: '智联登录态不可用（匿名模式）；执行 `zhilian login` 登录' }),
    };
  }

  private async sessionInfo(): Promise<{ atExpiresAt?: string; rtExpiresAt?: string; expiresAt?: string; remainingSec?: number }> {
    if (!this.api) return {};
    const atExpiresAt = await this.api.cookieExpiryIso('at').catch(() => undefined);
    const rtExpiresAt = await this.api.cookieExpiryIso('rt').catch(() => undefined);
    const expiresAt = rtExpiresAt ?? atExpiresAt;
    const remainingSec = expiresAt ? Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)) : undefined;
    return {
      ...(atExpiresAt ? { atExpiresAt } : {}),
      ...(rtExpiresAt ? { rtExpiresAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(remainingSec !== undefined ? { remainingSec } : {}),
    };
  }

  /* ---------------- verification (EdgeOne / geetest / nc) ---------------- */

  verificationGet(): VerificationStatus {
    return {
      pending: this.pendingVerification !== null,
      kind: this.pendingVerification?.kind ?? null,
      challenge: this.pendingVerification,
      ...(this.pendingVerification ? {} : { message: '当前没有待处理的人机验证' }),
    };
  }

  async verificationSolve(answer: VerificationSolveRequest): Promise<{ solved: boolean; verification: VerificationStatus; message?: string }> {
    if (!this.host) throw new ZhilianError('AUTH_REQUIRED', '浏览器会话未启动');
    if (!this.pendingVerification) {
      return { solved: true, verification: { pending: false, kind: null }, message: '没有待处理的人机验证' };
    }
    const page = this.page();
    if (answer.kind === 'edgeone') {
      if (!(await edgeChallengeVisible(page))) {
        this.pendingVerification = null;
        return { solved: true, verification: { pending: false, kind: null } };
      }
      const solved = await solveEdgeChallenge(page, answer);
      if (solved) {
        this.pendingVerification = null;
        this.lastEdgeSolvedAt = Date.now();
        this.logger?.info('verification.edge.solved');
        return { solved: true, verification: { pending: false, kind: null }, message: 'EdgeOne 验证通过' };
      }
      const fresh = await captureEdgeChallenge(page, this.pendingVerification.url);
      this.pendingVerification = fresh;
      throw new ZhilianError('HUMAN_VERIFICATION_FAILED', 'EdgeOne 验证未通过', { details: { verification: fresh } });
    }
    const solved = await solveGeetest(page, answer);
    const again = await captureLoginCaptcha(page);
    if (solved && !again) {
      this.pendingVerification = null;
      if (this.login) this.login.verification = undefined;
      return { solved: true, verification: { pending: false, kind: null }, message: '验证码通过' };
    }
    if (again) {
      this.pendingVerification = again;
      if (this.login) this.login.verification = again;
      throw new ZhilianError('HUMAN_VERIFICATION_FAILED', '验证码答案未通过', { details: { verification: again } });
    }
    return { solved: false, verification: this.verificationGet(), message: '验证码状态未确认，请重试' };
  }

  private async handleEdgeChallenge(url: string): Promise<void> {
    if (!this.host) return;
    const page = this.page();
    // 进入真实页面：让浏览器执行 EdgeOne 第一阶段 JS 挑战（写 EO_Bot_Ssid / __tst_status 后重载）
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.cfg.session.requestTimeoutMs }).catch(() => {});
    const deadline = Date.now() + Math.min(this.cfg.edgeWaitSec, 25) * 1000;
    while (Date.now() < deadline) {
      await sleep(1200);
      if (await edgeChallengeVisible(page)) break;
      const html = await page.content().catch(() => '');
      if (html.includes('__INITIAL_STATE__') || html.length > 20000) {
        // JS 挑战已自动通过，页面已渲染真正内容
        this.logger?.info('verification.edge.js.passed', { url });
        return;
      }
    }
    if (!(await edgeChallengeVisible(page))) return;
    const challenge = await captureEdgeChallenge(page, url);
    this.pendingVerification = challenge;
    this.logger?.warn('verification.edge.required', { url });
    if (this.cfg.edgeAuto) {
      const solved = await solveEdgeChallenge(page, { kind: 'edgeone', auto: true }).catch(() => false);
      if (solved) {
        this.pendingVerification = null;
        this.lastEdgeSolvedAt = Date.now();
        this.logger?.info('verification.edge.auto.solved');
      }
    }
  }

  /* ---------------- login ---------------- */

  async loginStart(req: LoginStartRequest): Promise<LoginSession> {
    await this.ensureStarted();
    if (await this.isLoggedIn()) {
      return {
        loginId: this.newLoginId(),
        mode: req.mode ?? this.cfg.loginMode,
        state: 'logged_in',
        expiresAt: new Date(Date.now() + this.cfg.session.loginTimeoutSec * 1000).toISOString(),
        message: 'already logged in',
      };
    }
    if (this.login && this.login.expiresAt > Date.now()) {
      throw new ZhilianError('LOGIN_IN_PROGRESS', `已有登录流程进行中：${this.login.loginId}`);
    }
    const mode: LoginMode = req.mode ?? this.cfg.loginMode;
    const loginId = this.newLoginId();
    const internal: LoginInternal = {
      loginId,
      mode,
      state: 'starting',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.cfg.session.loginTimeoutSec * 1000,
      ...(req.phone ?? this.cfg.phone ? { phone: req.phone ?? this.cfg.phone } : {}),
    };
    this.login = internal;
    try {
      if (mode === 'app-qr' || mode === 'wechat-qr') {
        await this.beginAppQr(internal);
      } else if (mode === 'sms') {
        if (this.cfg.headless) {
          // 短信/极验通常需要 headful；仍尝试 headless（失败会返回 HEADFUL_REQUIRED 提示）
        }
        await this.beginSms(internal);
      } else {
        throw new ZhilianError('NOT_IMPLEMENTED', '密码登录尚未实现，请使用 APP 扫码或短信登录');
      }
      return this.toPublic(internal);
    } catch (err) {
      this.login = null;
      throw err;
    }
  }

  private async beginAppQr(internal: LoginInternal): Promise<void> {
    const page = this.page();
    await page.goto(this.cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.session.requestTimeoutMs }).catch(() => {});
    await sleep(3000);
    const res = await this.passportFetch(appScanInitUrl(this.cfg.loginUrl));
    const parsed = RawAppScanInitSchema.safeParse(res);
    if (!parsed.success || !okCode(parsed.data.code) || !parsed.data.data) {
      throw new ZhilianError('UPSTREAM_CHANGED', '智联扫码初始化失败');
    }
    internal.validateId = parsed.data.data.validateId;
    const img = await this.passportImage(appScanImgUrl(this.cfg.loginUrl, internal.validateId));
    if (!img) throw new ZhilianError('UPSTREAM_CHANGED', '未获取到二维码图片');
    internal.qr = { pngBase64: img.base64, image: { width: 300, height: 300 }, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
    internal.state = 'awaiting_scan';
    this.startQrPolling(internal);
  }

  private startQrPolling(internal: LoginInternal): void {
    if (internal.pollTimer) clearInterval(internal.pollTimer);
    internal.pollTimer = setInterval(() => {
      if (!this.login || this.login.loginId !== internal.loginId) {
        if (internal.pollTimer) clearInterval(internal.pollTimer);
        return;
      }
      if (Date.now() > internal.expiresAt) {
        internal.state = 'expired';
        if (internal.pollTimer) clearInterval(internal.pollTimer);
        this.login = null;
        return;
      }
      void this.pollAppQr(internal);
    }, this.cfg.qrPollMs);
    internal.pollTimer.unref?.();
  }

  private async pollAppQr(internal: LoginInternal): Promise<void> {
    if (!internal.validateId) return;
    try {
      const res = await this.passportFetch(appScanLoginUrl(this.cfg.loginUrl, internal.validateId));
      const parsed = RawAppScanPollSchema.safeParse(res);
      if (!parsed.success) return;
      const code = Number(parsed.data.code);
      if (code === 100000) {
        await this.completeLogin(internal);
      } else if (code === 102001) {
        internal.state = 'awaiting_confirm';
        internal.message = '已扫码，请在手机上确认登录';
      } else if (code === 102002 || code === 102003) {
        internal.state = 'expired';
        internal.message = '二维码已失效，请重新发起登录';
        if (internal.pollTimer) clearInterval(internal.pollTimer);
        this.login = null;
      } else {
        internal.state = 'awaiting_scan';
      }
    } catch {
      /* 轮询失败忽略，下一轮继续 */
    }
  }

  private async beginSms(internal: LoginInternal): Promise<void> {
    if (!internal.phone) throw new ZhilianError('BAD_REQUEST', '短信登录需要手机号：设置 ZHILIAN_PHONE 或传入 phone');
    const page = this.page();
    await page.goto(this.cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.session.requestTimeoutMs }).catch(() => {});
    await sleep(4000);
    await ensureSmsPanel(page);
    await fillPhone(page, internal.phone);
    await clickSendSms(page);
    const captcha = await captureLoginCaptcha(page);
    if (captcha) {
      internal.verification = captcha;
      internal.state = 'awaiting_captcha';
      this.pendingVerification = captcha;
      internal.message = '发码前出现人机验证，请通过 `zhilian verify` 中继完成';
      return;
    }
    const sent = await waitSmsSent(page, 15000);
    if (!sent) {
      internal.state = 'failed';
      internal.message = '短信未确认发送，请重试';
      throw new ZhilianError('UPSTREAM_UNAVAILABLE', '短信未确认发送，请检查网络/手机号');
    }
    internal.state = 'awaiting_sms_code';
    internal.sms = { codeSentAt: new Date().toISOString(), resendAfterSec: 60 };
  }

  async loginGet(loginId: string): Promise<LoginSession> {
    const internal = this.findLogin(loginId);
    if (internal.expiresAt < Date.now()) {
      internal.state = 'expired';
      if (internal.pollTimer) clearInterval(internal.pollTimer);
      this.login = null;
      throw new ZhilianError('LOGIN_EXPIRED', '登录流程已过期，请重新开始');
    }
    if (internal.mode === 'app-qr' || internal.mode === 'wechat-qr') {
      await this.pollAppQr(internal);
    } else if (internal.state === 'awaiting_captcha') {
      const captcha = await captureLoginCaptcha(this.page());
      if (captcha) {
        internal.verification = captcha;
        this.pendingVerification = captcha;
      } else if (await waitSmsSent(this.page(), 1500)) {
        internal.state = 'awaiting_sms_code';
        internal.verification = undefined;
        this.pendingVerification = null;
      }
    } else if (internal.state === 'awaiting_sms_code') {
      if (!isLoginPage(this.page())) {
        await this.completeLogin(internal);
      }
    }
    return this.toPublic(internal);
  }

  async loginSms(loginId: string, code: string): Promise<LoginSession> {
    const internal = this.findLogin(loginId);
    if (internal.expiresAt < Date.now()) throw new ZhilianError('LOGIN_EXPIRED', '登录流程已过期');
    if (internal.mode !== 'sms') throw new ZhilianError('BAD_REQUEST', '当前登录流程不是短信模式');
    const page = this.page();
    await submitSmsCode(page, code);
    const captcha = await captureLoginCaptcha(page);
    if (captcha) {
      internal.verification = captcha;
      this.pendingVerification = captcha;
      internal.state = 'awaiting_captcha';
      throw new ZhilianError('CAPTCHA_REQUIRED', '登录时出现人机验证', { details: { verification: captcha } });
    }
    const ok = await waitLoginRedirect(page, 60_000);
    if (!ok) {
      internal.state = 'awaiting_sms_code';
      throw new ZhilianError('SMS_CODE_INVALID', '短信验证码未通过或登录未完成，请重试');
    }
    await this.completeLogin(internal);
    return this.toPublic(internal);
  }

  async loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }> {
    const internal = this.findLogin(loginId);
    internal.state = 'cancelled';
    if (internal.pollTimer) clearInterval(internal.pollTimer);
    this.login = null;
    if (this.pendingVerification?.kind === 'geetest' || this.pendingVerification?.kind === 'nc') this.pendingVerification = null;
    return { loginId, state: 'cancelled' };
  }

  private newLoginId(): string {
    return `login_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private findLogin(loginId: string): LoginInternal {
    if (!this.login || this.login.loginId !== loginId) {
      throw new ZhilianError('LOGIN_EXPIRED', `登录流程不存在或已过期：${loginId}`);
    }
    return this.login;
  }

  private async completeLogin(internal: LoginInternal): Promise<void> {
    internal.state = 'logged_in';
    internal.message = 'logged in';
    if (internal.pollTimer) clearInterval(internal.pollTimer);
    this.state = 'ok';
    this.lastLoggedIn = true;
    this.lastCheckedAt = Date.now();
    this.pendingVerification = null;
    try {
      const state = await this.page().context().storageState({ path: this.cfg.sessionFile });
      fs.chmodSync(this.cfg.sessionFile, 0o600);
      void state;
    } catch {
      /* profile itself persists; storage state is a bonus */
    }
    this.login = null;
    this.logger?.info('session.login.ok', { loginId: internal.loginId, mode: internal.mode });
  }

  private toPublic(internal: LoginInternal): LoginSession {
    return {
      loginId: internal.loginId,
      mode: internal.mode,
      state: internal.state,
      ...(internal.phone ? { phoneMasked: maskPhone(internal.phone) } : {}),
      ...(internal.qr ? { qr: internal.qr } : {}),
      ...(internal.sms ? { sms: internal.sms } : {}),
      ...(internal.verification ? { verification: internal.verification } : {}),
      expiresAt: new Date(internal.expiresAt).toISOString(),
      ...(internal.message ? { message: internal.message } : {}),
    };
  }

  /* ---------------- passport 请求（页面内 fetch，保持同源） ---------------- */

  private async passportFetch(url: string): Promise<unknown> {
    const page = this.page();
    return page
      .evaluate(async (u: string) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          const text = await r.text();
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return { code: -1, message: text.slice(0, 300) };
          }
        } catch (err) {
          return { code: -1, message: String(err) };
        }
      }, url)
      .catch((err) => ({ code: -1, message: String(err) }));
  }

  private async passportImage(url: string): Promise<{ base64: string } | null> {
    const page = this.page();
    const res = (await page
      .evaluate(async (u: string) => {
        try {
          const r = await fetch(u, { credentials: 'include' });
          const ct = r.headers.get('content-type') ?? 'image/jpeg';
          const buf = await r.arrayBuffer();
          let bin = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          return { ok: true, contentType: ct, base64: btoa(bin) };
        } catch (err) {
          return { ok: false, message: String(err) };
        }
      }, url)
      .catch((err) => ({ ok: false, message: String(err) }))) as { ok: boolean; base64?: string; contentType?: string };
    if (!res.ok || !res.base64) return null;
    const ct = res.contentType ?? 'image/jpeg';
    return { base64: `data:${ct.split(';')[0] ?? 'image/jpeg'};base64,${res.base64}` };
  }

  /* ---------------- lock / heartbeat ---------------- */

  private acquireLock(): void {
    const dir = path.dirname(this.cfg.lockFile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lockPath = this.cfg.lockFile;
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      this.lockFd = fd;
      this.lockPath = lockPath;
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          throw new ZhilianError('ALREADY_RUNNING', `zhilian-client 已在运行（pid=${pid}）`);
        } catch (killErr) {
          if (killErr instanceof ZhilianError) throw killErr;
          /* stale pid */
        }
      }
      fs.unlinkSync(lockPath);
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      this.lockFd = fd;
      this.lockPath = lockPath;
    }
  }

  private releaseLock(): void {
    if (this.lockFd !== null) {
      try {
        fs.closeSync(this.lockFd);
      } catch {
        /* ignore */
      }
      this.lockFd = null;
    }
    if (this.lockPath) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        /* ignore */
      }
      this.lockPath = null;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const interval = Math.max(30, this.cfg.session.heartbeatSec) * 1000;
    this.heartbeatTimer = setInterval(() => {
      this.status()
        .then((s) => this.logger?.debug('session.heartbeat', { health: s.health, loggedIn: s.loggedIn, mode: s.mode }))
        .catch(() => {});
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export { ZHILIAN_ENDPOINTS, bodyText, clickFirstText, isLoginPage };
