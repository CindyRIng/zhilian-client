/**
 * 应用服务层：对外能力的统一实现（cache-aside）
 */
import { createHash } from 'node:crypto';
import type { Config, SortType } from './config/schema.js';
import type { CacheStore, SearchQueryRecord } from './cache/types.js';
import type { SessionManager } from './session/manager.js';
import type { Logger } from './utils/logger.js';
import { ZhilianError } from './errors/catalog.js';
import type { HealthResponse, Status } from './domain/status.js';
import type { JobDetail, JobSummary } from './domain/job.js';
import type { CompanyDetail, CompanyJob, CompanySummary } from './domain/company.js';
import type { SearchJobsRequest } from './domain/search.js';
import type {
  LoginSession,
  LoginStartRequest,
  VerificationSolveRequest,
  VerificationStatus,
} from './domain/login.js';
import type { CacheClearResult, CacheStats } from './domain/cache.js';
import {
  buildCompanySummaries,
  citiesFromBaseData,
  dedupeJobs,
  mapCompanyDetail,
  mapCompanyJobs,
  mapJobDetailFromApi,
  mapJobDetailFromState,
  mapJobSummaries,
} from './adapters/zhilian/mapper.js';
import type { RawCompanyDetailState, RawCompanyJobsState, RawJobDetailState } from './adapters/zhilian/raw.js';
import { CITY_SEED, filterCities, type CitySeed } from './data/cities.js';
import { SCHEMA_VERSION } from './schemas/envelope.js';

export const VERSION = '0.1.0';

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  pagesFetched: number;
  pagesAvailable: number;
}

export interface SearchJobsResult {
  query: ReturnType<typeof queryToPublic>;
  jobs: JobSummary[];
  companies: CompanySummary[];
  pagination: Pagination;
  cached: boolean;
}

export interface JobsResult {
  query: ReturnType<typeof queryToPublic>;
  jobs: JobSummary[];
  pagination: Pagination;
  cached: boolean;
}

export interface CompaniesResult {
  query: ReturnType<typeof queryToPublic>;
  companies: CompanySummary[];
  pagination: Pagination;
  cached: boolean;
}

export interface CitiesResponse {
  cities: Array<CitySeed & { isDefault: boolean }>;
  updatedAt: string;
}

export interface CompanyJobsResult {
  companyNumber: string;
  jobCount: number;
  jobs: CompanyJob[];
  truncated: boolean;
}

export interface ZhilianService {
  health(): Promise<HealthResponse>;
  status(): Promise<Status>;
  mode(): 'logged_in' | 'anonymous';
  loginStart(req: LoginStartRequest): Promise<LoginSession>;
  loginGet(loginId: string): Promise<LoginSession>;
  loginSms(loginId: string, code: string): Promise<LoginSession>;
  loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }>;
  verificationGet(): Promise<VerificationStatus>;
  verificationSolve(answer: VerificationSolveRequest): Promise<{ solved: boolean; verification: VerificationStatus; message?: string }>;
  searchJobs(req: SearchJobsRequest): Promise<SearchJobsResult>;
  listJobs(req: { queryId: string; page: number; pageSize?: number; refresh?: boolean }): Promise<JobsResult>;
  jobDetail(req: { positionNumber: string; refresh?: boolean }): Promise<JobDetail>;
  listCompanies(req: {
    queryId: string;
    page: number;
    pageSize: number;
    fetchPages?: number;
    refresh?: boolean;
  }): Promise<CompaniesResult>;
  companyDetail(req: { companyNumber: string; refresh?: boolean }): Promise<CompanyDetail>;
  companyJobs(req: { companyNumber: string; page?: number; refresh?: boolean }): Promise<CompanyJobsResult>;
  cities(refresh?: boolean, level?: CitySeed['level']): Promise<CitiesResponse>;
  cacheStats(): Promise<CacheStats>;
  cacheClear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<CacheClearResult>;
}

function queryToPublic(q: SearchQueryRecord): {
  queryId: string;
  keyword: string;
  cityCode: string;
  cityName?: string;
  sortType: SortType;
  pageSize: number;
  pagesFetched: number;
  hasMore: boolean;
  count: number;
  anonymous: boolean;
  fetchedAt: string;
} {
  return {
    queryId: q.queryId,
    keyword: q.keyword,
    cityCode: q.cityCode,
    ...(q.cityName ? { cityName: q.cityName } : {}),
    sortType: q.sortType,
    pageSize: q.pageSize,
    pagesFetched: q.pagesFetched,
    hasMore: q.hasMore,
    count: q.count,
    anonymous: q.anonymous,
    fetchedAt: new Date(q.fetchedAt).toISOString(),
  };
}

function newQueryId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `q_${ymd}_${Math.random().toString(36).slice(2, 8)}`;
}

function pagesAvailable(total: number, pageSize: number): number {
  return Math.max(0, Math.ceil(total / Math.max(1, pageSize)));
}

export class DefaultZhilianService implements ZhilianService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly cfg: Config,
    private readonly session: SessionManager,
    private readonly cache: CacheStore,
    private readonly logger?: Logger,
  ) {}

  private cacheKey(...parts: unknown[]): string {
    return createHash('sha1').update(JSON.stringify(parts)).digest('hex');
  }

  mode(): 'logged_in' | 'anonymous' {
    return this.session.snapshot().mode;
  }

  private requireLogin(): void {
    if (!this.session.snapshot().loggedIn) {
      throw new ZhilianError('LOGIN_REQUIRED', '该操作需要登录智联账号（匿名模式仅支持第 1 页 20 条）');
    }
  }

  private resolveSort(req: { sortType?: SortType; order?: number }): SortType {
    if (req.sortType) return req.sortType;
    if (req.order === 4) return 'JOB_PUBLISH_TIME';
    if (req.order === 11) return 'DEFAULT';
    return this.cfg.sortType;
  }

  async health(): Promise<HealthResponse> {
    // 轻量快照：不请求上游、不做登录检查（供 CLI/MCP 探测与服务存活探针使用）
    const snap = this.session.snapshot();
    const verification = this.session.verificationGet();
    return {
      ok: true,
      service: 'zhilian-client',
      version: VERSION,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      schemaVersion: SCHEMA_VERSION,
      browser: {
        connected: snap.browserConnected,
        headless: this.cfg.headless,
        profileDir: this.cfg.profileDir,
      },
      login: {
        loggedIn: snap.loggedIn,
        mode: snap.mode,
        health: snap.health,
      },
      verification: {
        pending: verification.pending,
        kind: verification.kind ?? null,
      },
      cache: { dbPath: this.cfg.cache.dbPath, ready: true },
      ts: new Date().toISOString(),
    };
  }

  async status(): Promise<Status> {
    try {
      await this.session.ensureStarted();
    } catch (err) {
      this.logger?.warn('status.start.failed', { message: String(err) });
    }
    const base = await this.session.status();
    const cache = await this.cache.stats();
    const req = this.session.requestStats();
    return {
      ...base,
      requests: {
        ...base.requests,
        today: Math.max(base.requests.today, req.requests),
        cacheHits: cache.hits,
        cacheMisses: cache.misses,
      },
      cache: {
        dbPath: cache.dbPath,
        ...(cache.sizeBytes !== undefined ? { sizeBytes: cache.sizeBytes } : {}),
        entries: { ...cache.entries },
      },
    };
  }

  async loginStart(req: LoginStartRequest): Promise<LoginSession> {
    return this.session.loginStart(req);
  }
  async loginGet(loginId: string): Promise<LoginSession> {
    return this.session.loginGet(loginId);
  }
  async loginSms(loginId: string, code: string): Promise<LoginSession> {
    return this.session.loginSms(loginId, code);
  }
  async loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }> {
    return this.session.loginCancel(loginId);
  }
  async verificationGet(): Promise<VerificationStatus> {
    return this.session.verificationGet();
  }
  verificationSolve(answer: VerificationSolveRequest): Promise<{ solved: boolean; verification: VerificationStatus; message?: string }> {
    return this.session.verificationSolve(answer);
  }

  async searchJobs(req: SearchJobsRequest): Promise<SearchJobsResult> {
    await this.session.ensureStarted();
    const cityCode = req.cityCode ?? this.cfg.cities[0];
    if (!cityCode) throw new ZhilianError('BAD_REQUEST', '缺少 cityCode');
    const sortType = this.resolveSort(req);
    const pageSize = 20;
    const startPage = req.page;
    const pages = Math.min(req.pages, this.cfg.session.maxPages);
    const anonymous = !this.session.snapshot().loggedIn;
    if (anonymous && (pages > 1 || startPage > 1)) {
      throw new ZhilianError('ANONYMOUS_LIMITED', '匿名模式仅支持第 1 页 20 条，登录后可翻页', {
        details: { mode: 'anonymous', page: startPage, maxPage: 1, hint: '登录后可翻页' },
      });
    }
    const key = this.cacheKey('search', req.keyword, cityCode, sortType, pageSize, startPage, pages, anonymous);
    if (!req.refresh) {
      const existing = this.cache.getQueryByCacheKey(key);
      if (existing && existing.pagesFetched >= pages) {
        const jobs = dedupeJobs(this.cache.getJobsByQuery(existing.queryId));
        return {
          query: queryToPublic(existing),
          jobs,
          companies: buildCompanySummaries(jobs),
          cached: true,
          pagination: {
            page: startPage,
            pageSize,
            total: existing.count > 0 ? existing.count : jobs.length,
            hasMore: existing.hasMore,
            pagesFetched: existing.pagesFetched,
            pagesAvailable: existing.count > 0 ? pagesAvailable(existing.count, pageSize) : existing.pagesFetched,
          },
        };
      }
    }
    const client = this.session.client();
    const queryId = newQueryId();
    const fetched: JobSummary[] = [];
    let hasMore = false;
    let count = 0;
    let cityName: string | undefined;
    for (let i = 0; i < pages; i += 1) {
      const page = startPage + i;
      if (i > 0) await client.pageDelayJitter();
      if (page === 1) {
        const res = await client.searchPage({ keyword: req.keyword, cityCode, page: 1, sortType });
        const mapped = mapJobSummaries(res.positions, this.cfg.baseUrl);
        this.cache.putJobs(queryId, 1, mapped.jobs);
        fetched.push(...mapped.jobs);
        hasMore = res.hasMore;
        cityName = res.cityName;
        this.logger?.debug('search.jobs.page', { keyword: req.keyword, cityCode, page: 1, jobs: mapped.jobs.length });
        if (!hasMore) break;
      } else {
        const res = await client.loadMore({
          keyword: req.keyword,
          cityCode,
          pageIndex: page,
          pageSize,
          sortType,
          anonymous,
        });
        const mapped = mapJobSummaries(res.positions, this.cfg.baseUrl);
        this.cache.putJobs(queryId, page, mapped.jobs);
        fetched.push(...mapped.jobs);
        hasMore = !res.isEndPage;
        if (res.count !== undefined) count = Math.max(count, res.count);
        this.logger?.debug('search.jobs.page', { keyword: req.keyword, cityCode, page, jobs: mapped.jobs.length });
        if (!hasMore) break;
      }
    }
    const record: SearchQueryRecord = {
      queryId,
      keyword: req.keyword,
      cityCode,
      ...(cityName ? { cityName } : {}),
      sortType,
      pageSize,
      pagesFetched: Math.min(pages, Math.max(1, Math.ceil(fetched.length / pageSize))),
      hasMore,
      count,
      anonymous,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + this.cfg.cache.queryTtlSec * 1000,
    };
    this.cache.putQuery(record, key);
    const uniqueJobs = dedupeJobs(fetched);
    const companies = buildCompanySummaries(uniqueJobs);
    for (const company of companies) this.cache.putCompanySummary(company);
    return {
      query: queryToPublic(record),
      jobs: uniqueJobs,
      companies,
      cached: false,
      pagination: {
        page: startPage,
        pageSize,
        total: record.count > 0 ? record.count : uniqueJobs.length,
        hasMore,
        pagesFetched: record.pagesFetched,
        pagesAvailable: record.count > 0 ? pagesAvailable(record.count, pageSize) : hasMore ? record.pagesFetched + 1 : record.pagesFetched,
      },
    };
  }

  async listJobs(req: { queryId: string; page: number; pageSize?: number; refresh?: boolean }): Promise<JobsResult> {
    const record = this.cache.getQuery(req.queryId);
    if (!record) throw new ZhilianError('QUERY_EXPIRED', `queryId 不存在或已过期：${req.queryId}`);
    await this.session.ensureStarted();
    const pageSize = req.pageSize ?? record.pageSize;
    if (record.anonymous && req.page > 1) {
      throw new ZhilianError('ANONYMOUS_LIMITED', '匿名模式仅支持第 1 页 20 条，登录后可翻页');
    }
    const client = this.session.client();
    let cached = this.cache.getJobPage(req.queryId, req.page, this.cfg.cache.listTtlSec);
    const fromCache = Boolean(cached?.fresh) && !req.refresh;
    if (!cached?.fresh || req.refresh) {
      if (req.page === 1) {
        const res = await client.searchPage({ keyword: record.keyword, cityCode: record.cityCode, page: 1, sortType: record.sortType });
        const mapped = mapJobSummaries(res.positions, this.cfg.baseUrl);
        this.cache.putJobs(req.queryId, 1, mapped.jobs);
        this.cache.updateQueryProgress(req.queryId, { pagesFetched: Math.max(record.pagesFetched, 1), hasMore: res.hasMore });
        if (res.cityName) record.cityName = res.cityName;
        cached = { value: mapped.jobs, fetchedAt: Date.now(), expiresAt: Date.now(), fresh: true };
      } else {
        this.requireLogin();
        const res = await client.loadMore({
          keyword: record.keyword,
          cityCode: record.cityCode,
          pageIndex: req.page,
          pageSize,
          sortType: record.sortType,
          anonymous: false,
        });
        const mapped = mapJobSummaries(res.positions, this.cfg.baseUrl);
        this.cache.putJobs(req.queryId, req.page, mapped.jobs);
        this.cache.updateQueryProgress(req.queryId, {
          pagesFetched: Math.max(record.pagesFetched, req.page),
          hasMore: !res.isEndPage,
          ...(res.count !== undefined ? { count: Math.max(record.count, res.count) } : {}),
        });
        cached = { value: mapped.jobs, fetchedAt: Date.now(), expiresAt: Date.now(), fresh: true };
      }
    }
    const updated = this.cache.getQuery(req.queryId) ?? record;
    return {
      query: queryToPublic(updated),
      jobs: cached!.value,
      cached: fromCache,
      pagination: {
        page: req.page,
        pageSize,
        total: updated.count > 0 ? updated.count : cached!.value.length,
        hasMore: updated.hasMore,
        pagesFetched: updated.pagesFetched,
        pagesAvailable: updated.count > 0 ? pagesAvailable(updated.count, pageSize) : updated.hasMore ? updated.pagesFetched + 1 : updated.pagesFetched,
      },
    };
  }

  async jobDetail(req: { positionNumber: string; refresh?: boolean }): Promise<JobDetail> {
    if (!req.refresh) {
      const cached = this.cache.getJobDetail(req.positionNumber, this.cfg.cache.jobDetailTtlSec);
      if (cached?.fresh) return cached.value;
    }
    await this.session.ensureStarted();
    const client = this.session.client();
    let detail: JobDetail | null = null;
    let apiError: unknown = null;
    try {
      const data = await client.positionDetail(req.positionNumber);
      detail = mapJobDetailFromApi(
        {
          detailedCompany: data.detailedCompany as never,
          detailedPosition: data.detailedPosition as never,
        },
        req.positionNumber,
        this.cfg.baseUrl,
      );
    } catch (err) {
      apiError = err;
    }
    if (!detail) {
      try {
        const state = (await client.jobDetailPage(req.positionNumber)) as RawJobDetailState;
        detail = mapJobDetailFromState(state, this.cfg.baseUrl);
      } catch (err) {
        if (apiError instanceof ZhilianError && apiError.code === 'HUMAN_VERIFICATION_REQUIRED') throw apiError;
        if (err instanceof ZhilianError) throw err;
        throw apiError instanceof ZhilianError ? apiError : new ZhilianError('UPSTREAM_CHANGED', '职位详情解析失败', { cause: err });
      }
    }
    if (!detail) throw new ZhilianError('NOT_FOUND', `职位不存在或已下线：${req.positionNumber}`);
    this.cache.putJobDetail(detail);
    return detail;
  }

  async listCompanies(req: {
    queryId: string;
    page: number;
    pageSize: number;
    fetchPages?: number;
    refresh?: boolean;
  }): Promise<CompaniesResult> {
    let record = this.cache.getQuery(req.queryId);
    if (!record) throw new ZhilianError('QUERY_EXPIRED', `queryId 不存在或已过期：${req.queryId}`);
    await this.session.ensureStarted();
    if (req.fetchPages && req.fetchPages > 0) {
      if (record.anonymous) throw new ZhilianError('ANONYMOUS_LIMITED', '匿名模式无法补充抓取更多页，登录后可翻页');
      const client = this.session.client();
      const target = Math.min(this.cfg.session.maxPages, record.pagesFetched + req.fetchPages);
      for (let page = record.pagesFetched + 1; page <= target; page += 1) {
        await client.pageDelayJitter();
        const res = await client.loadMore({
          keyword: record.keyword,
          cityCode: record.cityCode,
          pageIndex: page,
          pageSize: record.pageSize,
          sortType: record.sortType,
          anonymous: false,
        });
        const mapped = mapJobSummaries(res.positions, this.cfg.baseUrl);
        this.cache.putJobs(record.queryId, page, mapped.jobs);
        record = {
          ...record,
          pagesFetched: page,
          hasMore: !res.isEndPage,
          ...(res.count !== undefined ? { count: Math.max(record.count, res.count) } : {}),
        };
        this.cache.updateQueryProgress(record.queryId, {
          pagesFetched: record.pagesFetched,
          hasMore: record.hasMore,
          count: record.count,
        });
        if (!record.hasMore) break;
      }
    }
    const jobs = dedupeJobs(this.cache.getJobsByQuery(record.queryId));
    const all = buildCompanySummaries(jobs);
    for (const company of all) this.cache.putCompanySummary(company);
    const total = all.length;
    const start = (req.page - 1) * req.pageSize;
    const companies = all.slice(start, start + req.pageSize);
    return {
      query: queryToPublic(record),
      companies,
      cached: true,
      pagination: {
        page: req.page,
        pageSize: req.pageSize,
        total,
        hasMore: start + companies.length < total,
        pagesFetched: record.pagesFetched,
        pagesAvailable: record.count > 0 ? pagesAvailable(record.count, record.pageSize) : record.pagesFetched,
      },
    };
  }

  async companyDetail(req: { companyNumber: string; refresh?: boolean }): Promise<CompanyDetail> {
    if (!req.refresh) {
      const cached = this.cache.getCompanyDetail(req.companyNumber, this.cfg.cache.companyTtlSec);
      if (cached?.fresh) return cached.value;
    }
    await this.session.ensureStarted();
    const state = (await this.session.client().companyPage(req.companyNumber)) as RawCompanyDetailState;
    const detail = mapCompanyDetail(state, req.companyNumber, this.cfg.baseUrl);
    this.cache.putCompanyDetail(detail);
    return detail;
  }

  async companyJobs(req: { companyNumber: string; page?: number; refresh?: boolean }): Promise<CompanyJobsResult> {
    if (!req.refresh) {
      const cached = this.cache.getCompanyJobs(req.companyNumber, this.cfg.cache.companyJobsTtlSec);
      if (cached?.fresh) {
        return { companyNumber: req.companyNumber, jobCount: cached.value.length, jobs: cached.value, truncated: false };
      }
    }
    await this.session.ensureStarted();
    const state = (await this.session.client().companyJobsPage(req.companyNumber, req.page ?? 1)) as RawCompanyJobsState;
    const jobs = mapCompanyJobs(state.onlinePositions, this.cfg.baseUrl);
    const jobCount = state.onlinePositionsCount ?? jobs.length;
    const truncated = jobCount > jobs.length;
    this.cache.putCompanyJobs(req.companyNumber, jobs);
    return { companyNumber: req.companyNumber, jobCount, jobs, truncated };
  }

  async cities(refresh = false, level?: CitySeed['level']): Promise<CitiesResponse> {
    const cacheLevel = `cities:${level ?? 'all'}`;
    const cached = this.cache.getMeta(cacheLevel);
    if (cached && !refresh) {
      try {
        const parsed = JSON.parse(cached) as { cities: CitySeed[]; updatedAt: string };
        return { cities: filterCities(level, this.cfg.cities), updatedAt: parsed.updatedAt };
      } catch {
        /* fall through */
      }
    }
    let cities: CitySeed[] = CITY_SEED;
    if (refresh) {
      try {
        await this.session.ensureStarted();
        const data = await this.session.client().getSearchBaseData();
        const allCity = (data as { data?: { allCity?: unknown } }).data?.allCity;
        const refreshed = citiesFromBaseData(allCity);
        if (refreshed.length > 1) cities = refreshed;
      } catch (err) {
        this.logger?.warn('cities.refresh.failed', { message: String(err) });
      }
    }
    const updatedAt = new Date().toISOString();
    this.cache.putMeta(cacheLevel, JSON.stringify({ cities, updatedAt }));
    return { cities: filterCities(level, this.cfg.cities), updatedAt };
  }

  async cacheStats(): Promise<CacheStats> {
    return this.cache.stats();
  }

  async cacheClear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<CacheClearResult> {
    const deleted = await this.cache.clear(opts);
    return { deleted, dbPath: this.cfg.cache.dbPath };
  }
}
