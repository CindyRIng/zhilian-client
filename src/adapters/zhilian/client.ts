/**
 * 智联页面内 API 客户端：所有请求在已登录页面上下文中 fetch（保持 cookie / 指纹）
 *
 * 数据获取策略（见 docs/01 PRD §4.4）：
 * - 搜索第 1 页：fetch SSR 文档 /jobs/?... 并解析 __INITIAL_STATE__
 * - 搜索第 2 页起：POST fe-api /c/i/search/positions（load-more）
 * - 职位详情：GET fe-api /c/i/jobs/position-detailv3（免 EdgeOne）
 * - 公司详情/公司职位：fetch SSR 文档并解析 __INITIAL_STATE__
 */
import crypto from 'node:crypto';
import type { Page } from 'playwright-core';
import { ZhilianError } from '../../errors/catalog.js';
import { extractInitialState, isEdgeChallengeHtml } from './extract.js';
import { RateLimiter, sleep } from './rate-limiter.js';
import {
  checkTokenUrl,
  companyJobsPageUrl,
  companyPageUrl,
  jobDetailPageUrl,
  positionDetailApiUrl,
  refreshTokenUrl,
  searchBaseDataUrl,
  searchPageUrl,
  searchPositionsUrl,
  userDetailUrl,
} from './endpoints.js';
import {
  RawCompanyDetailStateSchema,
  RawCompanyJobsStateSchema,
  RawJobDetailStateSchema,
  RawLoadMoreResponseSchema,
  RawPositionDetailResponseSchema,
  RawSearchStateSchema,
  RawUserDetailSchema,
  okCode,
  type RawPosition,
  type RawUserDetail,
} from './raw.js';

export interface ZhilianApiConfig {
  baseUrl: string;
  apiBase: string;
  timeoutMs: number;
  ratePerMin: number;
  pageJitterMs?: number;
  cooldownSec?: number;
}

export interface ZhilianRequestStats {
  requests: number;
  lastUpstreamAt?: number;
  blockCount: number;
  cooldownUntil?: number;
  lastError?: string;
}

export interface PageSearchResult {
  positions: RawPosition[];
  hasMore: boolean;
  cityName?: string;
  resumeNumber?: string;
}

export interface LoadMoreParams {
  keyword: string;
  cityCode: string;
  pageIndex: number;
  pageSize?: number;
  sortType: 'DEFAULT' | 'HR_ACTIVE_TIME' | 'JOB_PUBLISH_TIME';
  anonymous: boolean;
  actionId?: string;
}

interface RawHttpResult {
  status: number;
  text: string;
  contentType: string;
}

export class PageZhilianApiClient {
  private readonly limiter: RateLimiter;
  private requests = 0;
  private lastUpstreamAt: number | undefined;
  private blockCount = 0;
  private cooldownUntil: number | undefined;
  private lastError: string | undefined;
  private resumeNumber: string | undefined;
  private onEdgeChallenge: ((url: string) => Promise<void>) | undefined;

  constructor(
    private readonly page: Page,
    private readonly cfg: ZhilianApiConfig,
    opts: { onEdgeChallenge?: (url: string) => Promise<void> } = {},
  ) {
    this.limiter = new RateLimiter(cfg.ratePerMin, cfg.pageJitterMs ?? 300);
    this.onEdgeChallenge = opts.onEdgeChallenge;
  }

  stats(): ZhilianRequestStats {
    return {
      requests: this.requests,
      ...(this.lastUpstreamAt ? { lastUpstreamAt: this.lastUpstreamAt } : {}),
      blockCount: this.blockCount,
      ...(this.cooldownUntil ? { cooldownUntil: this.cooldownUntil } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  remainingCooldownMs(): number {
    return this.cooldownUntil ? Math.max(0, this.cooldownUntil - Date.now()) : 0;
  }

  private assertNotCoolingDown(): void {
    const remain = this.remainingCooldownMs();
    if (remain > 0) {
      throw new ZhilianError('RATE_LIMITED', `智联风控冷却中，请 ${Math.ceil(remain / 1000)}s 后重试`, { retryAfterMs: remain });
    }
  }

  private markBlock(): void {
    this.blockCount += 1;
    this.cooldownUntil = Date.now() + Math.max(1, this.cfg.cooldownSec ?? 60) * 1000;
  }

  async ensureOrigin(): Promise<void> {
    const url = this.page.url();
    if (/^https?:\/\/[^/]*zhaopin\.com\//.test(url)) return;
    await this.page.goto(this.cfg.baseUrl, { waitUntil: 'domcontentloaded', timeout: this.cfg.timeoutMs }).catch(() => {});
    await sleep(1200);
  }

  private async rawHttp(url: string, init: { method: 'GET' | 'POST'; body?: string; headers?: Record<string, string> }): Promise<RawHttpResult> {
    await this.limiter.acquire();
    this.assertNotCoolingDown();
    const result = (await this.page
      .evaluate(
        async (req: { url: string; method: string; body: string | null; headers: Record<string, string>; timeoutMs: number }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), req.timeoutMs);
          try {
            const resp = await fetch(req.url, {
              method: req.method,
              credentials: 'include',
              headers: req.headers,
              ...(req.body !== null ? { body: req.body } : {}),
              signal: controller.signal,
            });
            const text = await resp.text();
            return {
              status: resp.status,
              text: text.length > 8_000_000 ? text.slice(0, 8_000_000) : text,
              contentType: resp.headers.get('content-type') ?? '',
            };
          } catch (err) {
            return { status: 0, text: String(err), contentType: '' };
          } finally {
            clearTimeout(timer);
          }
        },
        {
          url,
          method: init.method,
          body: init.body ?? null,
          headers: { accept: 'application/json, text/html, */*', ...(init.headers ?? {}) },
          timeoutMs: this.cfg.timeoutMs,
        },
      )
      .catch((err) => ({ status: 0, text: String(err), contentType: '' }))) as RawHttpResult;
    this.requests += 1;
    this.lastUpstreamAt = Date.now();
    if (result.status === 0) {
      throw new ZhilianError('TIMEOUT', `请求超时：${url.slice(0, 120)}`);
    }
    if (result.status === 401) throw new ZhilianError('AUTH_REQUIRED', '智联登录态失效，需要重新登录');
    if (result.status === 403) {
      this.markBlock();
      throw new ZhilianError('UPSTREAM_BLOCKED', '智联拒绝访问（风控/无权限）');
    }
    if (result.status === 429) {
      this.markBlock();
      throw new ZhilianError('RATE_LIMITED', '智联限流', { retryAfterMs: 60_000 });
    }
    if (result.status >= 500) {
      throw new ZhilianError('UPSTREAM_UNAVAILABLE', `智联接口异常 HTTP ${result.status}`);
    }
    return result;
  }

  private async fetchJson(url: string, init: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {}): Promise<unknown> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    const res = await this.rawHttp(url, { method, ...(body !== undefined ? { body } : {}), headers });
    try {
      return JSON.parse(res.text) as unknown;
    } catch {
      throw new ZhilianError('UPSTREAM_CHANGED', `智联返回非 JSON：${url.slice(0, 120)}`);
    }
  }

  /** 拉取 SSR 文档；若命中 EdgeOne 挑战（JS 挑战或勾选验证）则交给上层处理并重试一次 */
  async fetchDocument(url: string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await this.rawHttp(url, { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } });
      if (!isEdgeChallengeHtml(res.text)) return res.text;
      if (attempt === 0 && this.onEdgeChallenge) {
        await this.onEdgeChallenge(url).catch(() => {});
        continue;
      }
      throw new ZhilianError('HUMAN_VERIFICATION_REQUIRED', '访问智联页面触发 EdgeOne 人机验证', {
        details: { verification: { kind: 'edgeone', url } },
      });
    }
    throw new ZhilianError('UPSTREAM_BLOCKED', 'EdgeOne 挑战未通过');
  }

  /* ------------------------------ 登录态 ------------------------------ */

  async getCheckToken(): Promise<boolean> {
    const json = await this.fetchJson(checkTokenUrl(this.cfg.apiBase));
    const code = (json as { code?: unknown }).code;
    if (!okCode(code)) return false;
    return (json as { data?: unknown }).data === true;
  }

  async getUserDetail(): Promise<RawUserDetail | null> {
    const raw = await this.fetchJson(userDetailUrl(this.cfg.apiBase));
    const parsed = RawUserDetailSchema.safeParse(raw);
    if (!parsed.success) return null;
    const resumeNumber = parsed.data.data?.Resume?.ResumeNumber;
    if (resumeNumber) this.resumeNumber = resumeNumber;
    return parsed.data;
  }

  get knownResumeNumber(): string | undefined {
    return this.resumeNumber;
  }

  async refreshToken(rt: string): Promise<{ code: number; at?: string; atExpire?: number; rt?: string; rtExpire?: number }> {
    const json = (await this.fetchJson(refreshTokenUrl(this.cfg.apiBase), { method: 'POST', body: { rt } })) as {
      code?: unknown;
      data?: { at?: string; atExpire?: number; rt?: string; rtExpire?: number };
    };
    const code = Number(json.code);
    return {
      code: Number.isFinite(code) ? code : -1,
      ...(json.data?.at ? { at: json.data.at } : {}),
      ...(json.data?.atExpire !== undefined ? { atExpire: json.data.atExpire } : {}),
      ...(json.data?.rt ? { rt: json.data.rt } : {}),
      ...(json.data?.rtExpire !== undefined ? { rtExpire: json.data.rtExpire } : {}),
    };
  }

  private async cookieValue(name: string): Promise<{ value?: string; expires?: number }> {
    try {
      const cookies = await this.page.context().cookies();
      const hit = cookies.find((c) => c.name === name);
      if (hit) return { value: hit.value, expires: hit.expires };
    } catch {
      /* fall through */
    }
    const fromDom = await this.page
      .evaluate((n: string) => {
        const m = document.cookie.match(new RegExp(`(?:^|; )${n}=([^;]+)`));
        return m ? decodeURIComponent(m[1]!) : undefined;
      }, name)
      .catch(() => undefined);
    return { ...(fromDom ? { value: fromDom } : {}) };
  }

  async getAtRt(): Promise<{ at?: string; rt?: string }> {
    const [at, rt] = await Promise.all([this.cookieValue('at'), this.cookieValue('rt')]);
    return { ...(at.value ? { at: at.value } : {}), ...(rt.value ? { rt: rt.value } : {}) };
  }

  async cookieExpiryIso(name: string): Promise<string | undefined> {
    const { expires } = await this.cookieValue(name);
    if (!expires || expires <= 0) return undefined;
    return new Date(expires * 1000).toISOString();
  }

  /** 直接写入登录 cookie（refresh-token 返回新 token 时使用） */
  async setAuthCookies(tokens: { at?: string; rt?: string; atExpire?: number; rtExpire?: number }): Promise<void> {
    if (!tokens.at && !tokens.rt) return;
    await this.page
      .evaluate(
        (t: { at?: string; rt?: string; atExpire?: number; rtExpire?: number }) => {
          const domain = '.zhaopin.com';
          const path = '/';
          if (t.at) document.cookie = `at=${t.at}; path=${path}; domain=${domain}; max-age=${Math.max(60, t.atExpire ?? 604800)}; SameSite=Lax`;
          if (t.rt) document.cookie = `rt=${t.rt}; path=${path}; domain=${domain}; max-age=${Math.max(60, t.rtExpire ?? 2592000)}; SameSite=Lax`;
        },
        tokens,
      )
      .catch(() => {});
  }

  /* ------------------------------ 数据接口 ------------------------------ */

  async searchPage(params: { keyword: string; cityCode: string; page?: number; sortType: 'DEFAULT' | 'HR_ACTIVE_TIME' | 'JOB_PUBLISH_TIME' }): Promise<PageSearchResult> {
    await this.ensureOrigin();
    const url = searchPageUrl(this.cfg.baseUrl, params.keyword, params.cityCode, params.page ?? 1, params.sortType);
    const html = await this.fetchDocument(url);
    const state = extractInitialState(html);
    if (!state) throw new ZhilianError('UPSTREAM_CHANGED', '搜索页未找到 __INITIAL_STATE__，可能已改版');
    const parsed = RawSearchStateSchema.safeParse(state);
    if (!parsed.success) throw new ZhilianError('UPSTREAM_CHANGED', '搜索页数据结构变化', { details: { issues: parsed.error.issues.slice(0, 5) } });
    const positions = parsed.data.positionList;
    if (parsed.data.resumeNumber) this.resumeNumber = parsed.data.resumeNumber;
    return {
      positions,
      hasMore: Boolean(parsed.data.hasMore),
      ...(positions[0]?.workCity ? { cityName: positions[0].workCity } : {}),
      ...(this.resumeNumber ? { resumeNumber: this.resumeNumber } : {}),
    };
  }

  async loadMore(params: LoadMoreParams): Promise<{ positions: RawPosition[]; isEndPage: boolean; count?: number }> {
    await this.ensureOrigin();
    if (!this.resumeNumber) await this.getUserDetail().catch(() => null);
    const { at, rt } = await this.getAtRt();
    const actionId = params.actionId ?? crypto.randomUUID();
    const pageSize = params.pageSize ?? 20;
    const body = {
      S_SOU_FULL_INDEX: params.keyword,
      S_SOU_WORK_CITY: params.cityCode,
      order: 0,
      actionid: actionId,
      pageSize,
      pageIndex: params.pageIndex,
      ...(this.resumeNumber ? { cvNumber: this.resumeNumber } : {}),
      ...(at ? { at } : {}),
      ...(rt ? { rt } : {}),
      eventScenario: 'pcSearchedSouSearch',
      anonymous: params.anonymous ? 1 : 0,
      ...(this.resumeNumber ? { resumeNumber: this.resumeNumber } : {}),
      clickFilterBlackCompany: false,
      platform: 13,
      version: '0.0.0',
      sortType: params.sortType,
    };
    const json = await this.fetchJson(searchPositionsUrl(this.cfg.apiBase), { method: 'POST', body });
    const parsed = RawLoadMoreResponseSchema.safeParse(json);
    if (!parsed.success || !okCode(parsed.data.code) || !parsed.data.data) {
      throw new ZhilianError('UPSTREAM_CHANGED', '搜索翻页接口返回异常');
    }
    const data = parsed.data.data;
    const end = typeof data.isEndPage === 'boolean' ? data.isEndPage : Number(data.isEndPage ?? 0) === 1;
    return {
      positions: data.list,
      isEndPage: end,
      ...(data.count !== undefined ? { count: data.count } : {}),
    };
  }

  async positionDetail(positionNumber: string): Promise<{ detailedCompany: unknown; detailedPosition: unknown }> {
    await this.ensureOrigin();
    const json = await this.fetchJson(positionDetailApiUrl(this.cfg.apiBase, positionNumber));
    const parsed = RawPositionDetailResponseSchema.safeParse(json);
    if (!parsed.success) throw new ZhilianError('UPSTREAM_CHANGED', '职位详情接口返回异常');
    if (!okCode(parsed.data.code)) throw new ZhilianError('NOT_FOUND', `职位不存在或已下线：${positionNumber}`);
    const data = parsed.data.data;
    if (!data) throw new ZhilianError('NOT_FOUND', `职位详情为空：${positionNumber}`);
    return { detailedCompany: data.detailedCompany, detailedPosition: data.detailedPosition };
  }

  async jobDetailPage(positionNumber: string): Promise<unknown> {
    const html = await this.fetchDocument(jobDetailPageUrl(this.cfg.baseUrl, positionNumber));
    const state = extractInitialState(html);
    if (!state) throw new ZhilianError('UPSTREAM_CHANGED', '职位详情页未找到 __INITIAL_STATE__');
    const parsed = RawJobDetailStateSchema.safeParse(state);
    if (!parsed.success) throw new ZhilianError('UPSTREAM_CHANGED', '职位详情页结构变化');
    return parsed.data;
  }

  async companyPage(companyNumber: string): Promise<unknown> {
    const html = await this.fetchDocument(companyPageUrl(this.cfg.baseUrl, companyNumber));
    const state = extractInitialState(html);
    if (!state) throw new ZhilianError('UPSTREAM_CHANGED', '公司详情页未找到 __INITIAL_STATE__');
    const parsed = RawCompanyDetailStateSchema.safeParse(state);
    if (!parsed.success) {
      const st = state as Record<string, unknown>;
      throw new ZhilianError('UPSTREAM_CHANGED', '公司详情页结构变化', {
        details: { issues: parsed.error.issues.slice(0, 5), keys: Object.keys(st).slice(0, 20), hasCompanyDetail: Boolean(st.companyDetail) },
      });
    }
    return parsed.data;
  }

  async companyJobsPage(companyNumber: string, page = 1): Promise<unknown> {
    const html = await this.fetchDocument(companyJobsPageUrl(this.cfg.baseUrl, companyNumber, page));
    const state = extractInitialState(html);
    if (!state) throw new ZhilianError('UPSTREAM_CHANGED', '公司职位页未找到 __INITIAL_STATE__');
    const parsed = RawCompanyJobsStateSchema.safeParse(state);
    if (!parsed.success) {
      const st = state as Record<string, unknown>;
      throw new ZhilianError('UPSTREAM_CHANGED', '公司职位页结构变化', {
        details: { issues: parsed.error.issues.slice(0, 5), keys: Object.keys(st).slice(0, 20) },
      });
    }
    return parsed.data;
  }

  async getSearchBaseData(): Promise<unknown> {
    await this.ensureOrigin();
    return this.fetchJson(searchBaseDataUrl(this.cfg.apiBase));
  }

  async pageDelayJitter(): Promise<void> {
    const base = 2500;
    const jitter = Math.floor(Math.random() * 1500);
    await sleep(base + jitter);
  }
}
