import { describe, it, expect } from 'vitest';
import { MemoryCacheStore } from '../src/cache/memory.js';
import { SqliteCacheStore } from '../src/cache/sqlite.js';
import type { CacheStore, SearchQueryRecord } from '../src/cache/types.js';
import type { JobSummary } from '../src/domain/job.js';

function makeQuery(overrides: Partial<SearchQueryRecord> = {}): SearchQueryRecord {
  const now = Date.now();
  return {
    queryId: 'q_20261114_ab12cd',
    keyword: '外贸',
    cityCode: '565',
    cityName: '石家庄',
    sortType: 'JOB_PUBLISH_TIME',
    pageSize: 20,
    pagesFetched: 1,
    hasMore: true,
    count: 40,
    anonymous: false,
    fetchedAt: now,
    expiresAt: now + 3600_000,
    ...overrides,
  };
}

function makeJob(positionNumber = 'CCL1316344860J40974823208'): JobSummary {
  const ts = new Date().toISOString();
  return {
    positionNumber,
    title: '外贸销售',
    salaryText: '5000-9000元',
    salaryMin: 5000,
    salaryMax: 9000,
    education: '大专',
    experience: '1-3年',
    companyNumber: 'CZL1316344860',
    companyName: '河北汇盛工业机械有限公司',
    jobUrl: 'https://www.zhaopin.com/jobdetail/CCL1316344860J40974823208.htm',
    firstSeenAt: ts,
    lastSeenAt: ts,
  };
}

async function exercise(store: CacheStore): Promise<void> {
  await store.init();
  expect(store.getQuery('q_20261114_ab12cd')).toBeNull();
  store.putQuery(makeQuery(), 'key-1');
  expect(store.getQuery('q_20261114_ab12cd')?.keyword).toBe('外贸');
  expect(store.getQueryByCacheKey('key-1')?.queryId).toBe('q_20261114_ab12cd');

  store.putJobs('q_20261114_ab12cd', 1, [makeJob()]);
  const page = store.getJobPage('q_20261114_ab12cd', 1, 7200);
  expect(page?.value).toHaveLength(1);
  expect(page?.fresh).toBe(true);
  expect(store.getJobsByQuery('q_20261114_ab12cd')).toHaveLength(1);

  store.updateQueryProgress('q_20261114_ab12cd', { pagesFetched: 2, hasMore: false });
  expect(store.getQuery('q_20261114_ab12cd')?.pagesFetched).toBe(2);
  expect(store.getQuery('q_20261114_ab12cd')?.hasMore).toBe(false);

  const detail = {
    positionNumber: 'CCL1316344860J40974823208',
    title: '外贸销售',
    salaryText: '5000-9000元',
    education: '大专',
    experience: '1-3年',
    description: '职责',
    labels: [],
    welfareTags: [],
    recruiter: {},
    company: {},
    jobUrl: 'https://www.zhaopin.com/jobdetail/CCL1316344860J40974823208.htm',
    fetchedAt: new Date().toISOString(),
  };
  store.putJobDetail(detail as never);
  expect(store.getJobDetail('CCL1316344860J40974823208', 3600)?.value.title).toBe('外贸销售');

  store.putCompanyJobs('CZL1316344860', []);
  expect(store.getCompanyJobs('CZL1316344860', 3600)?.value).toEqual([]);

  store.putMeta('k', 'v');
  expect(store.getMeta('k')).toBe('v');

  const stats = await store.stats();
  expect(stats.entries.queries).toBeGreaterThanOrEqual(1);
  expect(stats.entries.jobs).toBeGreaterThanOrEqual(1);

  const deleted = await store.clear({ scope: 'all' });
  expect(deleted).toBeGreaterThan(0);
  expect(store.getQuery('q_20261114_ab12cd')).toBeNull();
  expect(store.getJobsByQuery('q_20261114_ab12cd')).toHaveLength(0);

  const expired: SearchQueryRecord = makeQuery({ queryId: 'q_20261114_zzzzzz', expiresAt: Date.now() - 1000 });
  store.putQuery(expired, 'key-2');
  expect(await store.clear({ scope: 'expired' })).toBeGreaterThanOrEqual(1);
  await store.close();
}

describe('cache stores', () => {
  it('memory driver supports query/jobs/details/meta/clear', async () => {
    await exercise(new MemoryCacheStore());
  });

  it('sqlite driver supports query/jobs/details/meta/clear', async () => {
    await exercise(new SqliteCacheStore(':memory:'));
  });
});
