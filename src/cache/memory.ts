/**
 * 内存缓存（测试 / SQLite 降级）
 */
import type { CompanyDetail, CompanyJob, CompanySummary } from '../domain/company.js';
import type { JobDetail, JobSummary } from '../domain/job.js';
import type { CacheStats } from '../domain/cache.js';
import type { CacheStore, CachedValue, SearchQueryRecord } from './types.js';
import { cachedValue } from './types.js';

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

export class MemoryCacheStore implements CacheStore {
  readonly driver = 'memory' as const;
  private queries = new Map<string, SearchQueryRecord>();
  private cacheKeys = new Map<string, string>();
  private jobs = new Map<string, Map<number, JobSummary[]>>();
  private jobDetails = new Map<string, Entry<JobDetail>>();
  private companies = new Map<string, Entry<CompanySummary>>();
  private companyDetails = new Map<string, Entry<CompanyDetail>>();
  private companyJobs = new Map<string, Entry<CompanyJob[]>>();
  private meta = new Map<string, string>();
  private hits = 0;
  private misses = 0;

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  getQuery(queryId: string): SearchQueryRecord | null {
    const q = this.queries.get(queryId);
    return q && Date.now() <= q.expiresAt ? q : null;
  }

  getQueryByCacheKey(cacheKey: string): SearchQueryRecord | null {
    const id = this.cacheKeys.get(cacheKey);
    return id ? this.getQuery(id) : null;
  }

  putQuery(record: SearchQueryRecord, cacheKey: string): void {
    const old = this.cacheKeys.get(cacheKey);
    if (old && old !== record.queryId) this.queries.delete(old);
    this.cacheKeys.set(cacheKey, record.queryId);
    this.queries.set(record.queryId, record);
  }

  updateQueryProgress(queryId: string, patch: Partial<Pick<SearchQueryRecord, 'pagesFetched' | 'hasMore' | 'count'>>): void {
    const q = this.queries.get(queryId);
    if (!q) return;
    this.queries.set(queryId, { ...q, ...patch });
  }

  getJobPage(queryId: string, page: number, ttlSec: number): CachedValue<JobSummary[]> | null {
    const pages = this.jobs.get(queryId);
    const list = pages?.get(page);
    if (!list?.length) {
      this.misses++;
      return null;
    }
    const fetchedAt = Date.now();
    const v = cachedValue(list, fetchedAt, ttlSec);
    v.fresh ? this.hits++ : this.misses++;
    return v;
  }

  getJobsByQuery(queryId: string): JobSummary[] {
    const pages = this.jobs.get(queryId);
    if (!pages) return [];
    return [...pages.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, jobs]) => jobs);
  }

  putJobs(queryId: string, page: number, jobs: JobSummary[]): void {
    const pages = this.jobs.get(queryId) ?? new Map<number, JobSummary[]>();
    pages.set(page, jobs);
    this.jobs.set(queryId, pages);
  }

  getJobDetail(positionNumber: string, ttlSec: number): CachedValue<JobDetail> | null {
    const e = this.jobDetails.get(positionNumber);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putJobDetail(detail: JobDetail): void {
    this.jobDetails.set(detail.positionNumber, { value: detail, fetchedAt: Date.now() });
  }

  getCompanySummary(companyNumber: string, ttlSec: number): CachedValue<CompanySummary> | null {
    const e = this.companies.get(companyNumber);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanySummary(company: CompanySummary): void {
    this.companies.set(company.companyNumber, { value: company, fetchedAt: Date.now() });
  }

  getCompanyDetail(companyNumber: string, ttlSec: number): CachedValue<CompanyDetail> | null {
    const e = this.companyDetails.get(companyNumber);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanyDetail(detail: CompanyDetail): void {
    this.companyDetails.set(detail.companyNumber, { value: detail, fetchedAt: Date.now() });
  }

  getCompanyJobs(companyNumber: string, ttlSec: number): CachedValue<CompanyJob[]> | null {
    const e = this.companyJobs.get(companyNumber);
    const v = e ? cachedValue(e.value, e.fetchedAt, ttlSec) : null;
    v ? this.hits++ : this.misses++;
    return v;
  }

  putCompanyJobs(companyNumber: string, jobs: CompanyJob[]): void {
    this.companyJobs.set(companyNumber, { value: jobs, fetchedAt: Date.now() });
  }

  getMeta(key: string): string | null {
    return this.meta.get(key) ?? null;
  }

  putMeta(key: string, value: string): void {
    this.meta.set(key, value);
  }

  async stats(): Promise<CacheStats> {
    const total = this.hits + this.misses;
    return {
      dbPath: ':memory:',
      driver: 'memory',
      entries: {
        queries: this.queries.size,
        jobs: this.getJobsByQueryCount(),
        jobDetails: this.jobDetails.size,
        companies: this.companies.size,
        companyDetails: this.companyDetails.size,
        companyJobs: this.companyJobs.size,
      },
      hits: this.hits,
      misses: this.misses,
      ...(total > 0 ? { hitRate: this.hits / total } : {}),
    };
  }

  private getJobsByQueryCount(): number {
    let n = 0;
    for (const pages of this.jobs.values()) for (const list of pages.values()) n += list.length;
    return n;
  }

  async clear(opts: { scope: 'all' | 'expired'; prefix?: string }): Promise<number> {
    if (opts.scope === 'expired') {
      const now = Date.now();
      let n = 0;
      for (const [id, q] of [...this.queries]) {
        if (q.expiresAt < now) {
          n += this.jobs.get(id)?.size ?? 0;
          this.queries.delete(id);
          this.jobs.delete(id);
          n += 1;
        }
      }
      return n;
    }
    const count =
      this.queries.size +
      this.jobs.size +
      this.jobDetails.size +
      this.companies.size +
      this.companyDetails.size +
      this.companyJobs.size;
    if (opts.prefix) {
      const p = opts.prefix;
      for (const key of [...this.queries.keys()]) if (key.startsWith(p)) this.queries.delete(key);
      for (const key of [...this.jobDetails.keys()]) if (key.startsWith(p)) this.jobDetails.delete(key);
      for (const key of [...this.companies.keys()]) if (key.startsWith(p)) this.companies.delete(key);
      for (const key of [...this.companyDetails.keys()]) if (key.startsWith(p)) this.companyDetails.delete(key);
      for (const key of [...this.companyJobs.keys()]) if (key.startsWith(p)) this.companyJobs.delete(key);
      return count;
    }
    this.queries.clear();
    this.cacheKeys.clear();
    this.jobs.clear();
    this.jobDetails.clear();
    this.companies.clear();
    this.companyDetails.clear();
    this.companyJobs.clear();
    this.meta.clear();
    return count;
  }
}
