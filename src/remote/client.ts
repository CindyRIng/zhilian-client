/**
 * 远程客户端：当 ZHILIAN_CLIENT_URL 指向已运行的 REST 服务时，CLI/MCP 通过 HTTP 调用，
 * 避免与 systemd 常驻进程争抢同一 profile 锁。
 */
import type { Config } from '../config/schema.js';
import type {
  CitiesResponse,
  CompaniesResult,
  CompanyJobsResult,
  JobsResult,
  SearchJobsResult,
  ZhilianService,
} from '../service.js';
import type {
  LoginSession,
  LoginStartRequest,
  VerificationSolveRequest,
  VerificationStatus,
} from '../domain/login.js';
import type { JobDetail } from '../domain/job.js';
import type { CompanyDetail } from '../domain/company.js';
import type { SearchJobsRequest } from '../domain/search.js';
import type { Status, HealthResponse } from '../domain/status.js';
import type { CacheClearResult, CacheStats } from '../domain/cache.js';
import { ZhilianError, type ErrorCode } from '../errors/catalog.js';

type Query = Record<string, string | number | boolean | undefined>;

export class RemoteZhilianClient implements ZhilianService {
  private readonly baseUrl: string;
  private lastMode: 'logged_in' | 'anonymous' = 'anonymous';

  constructor(
    private readonly cfg: Config,
    baseUrl?: string,
  ) {
    const url = baseUrl ?? process.env.ZHILIAN_CLIENT_URL;
    if (!url) throw new ZhilianError('BAD_REQUEST', 'ZHILIAN_CLIENT_URL 未设置');
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private url(path: string, query: Query = {}): string {
    const u = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const target = this.url(path, opts.query);
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiToken}`,
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(this.cfg.session.requestTimeoutMs + 30_000),
      });
    } catch (err) {
      throw new ZhilianError('SERVICE_UNAVAILABLE', `无法连接 zhilian-client 常驻服务：${this.baseUrl}（请先启动 serve，或使用 zhilian mcp --local）`, {
        cause: err,
      });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ZhilianError('UPSTREAM_CHANGED', `zhilian-client REST 返回非 JSON（HTTP ${response.status}）`);
    }
    const env = payload as {
      ok?: boolean;
      data?: T;
      meta?: { mode?: 'logged_in' | 'anonymous' };
      error?: { code: ErrorCode; message: string; retryAfterMs?: number; details?: Record<string, unknown> };
    };
    if (env?.meta?.mode) this.lastMode = env.meta.mode;
    if (env?.ok && env.data !== undefined) return env.data;
    const err = env?.error;
    throw new ZhilianError(err?.code ?? 'INTERNAL', err?.message ?? `zhilian-client REST HTTP ${response.status}`, {
      ...(err?.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
      ...(err?.details ? { details: err.details } : {}),
    });
  }

  private updateModeFrom(mode: unknown): void {
    if (mode === 'logged_in' || mode === 'anonymous') this.lastMode = mode;
  }

  mode(): 'logged_in' | 'anonymous' {
    return this.lastMode;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/v1/health').then((h) => {
      this.updateModeFrom(h.login?.mode);
      return h;
    });
  }
  status(): Promise<Status> {
    return this.request<Status>('GET', '/v1/status').then((s) => {
      this.updateModeFrom(s.mode);
      return s;
    });
  }
  loginStart(req: LoginStartRequest): Promise<LoginSession> {
    return this.request<LoginSession>('POST', '/v1/session/login', { body: req });
  }
  loginGet(loginId: string): Promise<LoginSession> {
    return this.request<LoginSession>('GET', `/v1/session/login/${encodeURIComponent(loginId)}`);
  }
  loginSms(loginId: string, code: string): Promise<LoginSession> {
    return this.request<LoginSession>('POST', `/v1/session/login/${encodeURIComponent(loginId)}/sms`, { body: { code } });
  }
  loginCancel(loginId: string): Promise<{ loginId: string; state: 'cancelled' }> {
    return this.request<{ loginId: string; state: 'cancelled' }>('DELETE', `/v1/session/login/${encodeURIComponent(loginId)}`);
  }
  verificationGet(): Promise<VerificationStatus> {
    return this.request<VerificationStatus>('GET', '/v1/verification');
  }
  verificationSolve(answer: VerificationSolveRequest): Promise<{ solved: boolean; verification: VerificationStatus; message?: string }> {
    return this.request('POST', '/v1/verification/solve', { body: answer });
  }
  searchJobs(req: SearchJobsRequest): Promise<SearchJobsResult> {
    return this.request<SearchJobsResult>('POST', '/v1/search/jobs', { body: req }).then((r) => {
      this.updateModeFrom(r.query.anonymous ? 'anonymous' : 'logged_in');
      return r;
    });
  }
  listJobs(req: { queryId: string; page: number; pageSize?: number; refresh?: boolean }): Promise<JobsResult> {
    return this.request<JobsResult>('GET', '/v1/jobs', {
      query: { queryId: req.queryId, page: req.page, pageSize: req.pageSize, refresh: req.refresh },
    }).then((r) => {
      this.updateModeFrom(r.query.anonymous ? 'anonymous' : 'logged_in');
      return r;
    });
  }
  jobDetail(req: { positionNumber: string; refresh?: boolean }): Promise<JobDetail> {
    return this.request<JobDetail>('GET', `/v1/jobs/${encodeURIComponent(req.positionNumber)}`, { query: { refresh: req.refresh } });
  }
  listCompanies(req: {
    queryId: string;
    page: number;
    pageSize: number;
    fetchPages?: number;
    refresh?: boolean;
  }): Promise<CompaniesResult> {
    return this.request<CompaniesResult>('GET', '/v1/companies', {
      query: { queryId: req.queryId, page: req.page, pageSize: req.pageSize, fetchPages: req.fetchPages, refresh: req.refresh },
    });
  }
  companyDetail(req: { companyNumber: string; refresh?: boolean }): Promise<CompanyDetail> {
    return this.request<CompanyDetail>('GET', `/v1/companies/${encodeURIComponent(req.companyNumber)}`, { query: { refresh: req.refresh } });
  }
  companyJobs(req: { companyNumber: string; page?: number; refresh?: boolean }): Promise<CompanyJobsResult> {
    return this.request<CompanyJobsResult>('GET', `/v1/companies/${encodeURIComponent(req.companyNumber)}/jobs`, {
      query: { page: req.page, refresh: req.refresh },
    });
  }
  cities(refresh?: boolean, level?: 'country' | 'province' | 'city' | 'district'): Promise<CitiesResponse> {
    return this.request<CitiesResponse>('GET', '/v1/cities', { query: { refresh, level } });
  }
  cacheStats(): Promise<CacheStats> {
    return this.request<CacheStats>('GET', '/v1/cache/stats');
  }
  cacheClear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<CacheClearResult> {
    return this.request<CacheClearResult>('DELETE', '/v1/cache', { query: { scope: opts.scope, prefix: opts.prefix } });
  }
}
