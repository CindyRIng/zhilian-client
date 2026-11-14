import { describe, it, expect } from 'vitest';
import { RawCompanyPositionListSchema } from '../src/adapters/zhilian/raw.js';
import { mapCompanyJobs } from '../src/adapters/zhilian/mapper.js';

describe('company positions api', () => {
  it('parses fe-api company search-position response', () => {
    const json = {
      code: 200,
      apiCode: 200,
      data: {
        count: 21,
        isEndPage: 0,
        list: [
          { name: '行政专员/助理', salary60: '4000-6000元', cityId: '565', workCity: '石家庄', positionURL: 'https://www.zhaopin.com/jobdetail/CCL1316344860J40970217808.htm' },
          { name: '华北地区销售担当', salary60: '8000-12000元', cityId: '565', workCity: '石家庄', positionURL: 'https://www.zhaopin.com/jobdetail/CCL1316344860J40942601708.htm' },
        ],
      },
    };
    const parsed = RawCompanyPositionListSchema.safeParse(json);
    expect(parsed.success).toBe(true);
    const data = parsed.data!.data!;
    expect(data.count).toBe(21);
    expect(data.list).toHaveLength(2);
    const jobs = mapCompanyJobs(data.list as never, 'https://www.zhaopin.com');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.positionNumber).toBe('CCL1316344860J40970217808');
    expect(jobs[1]!.salaryMin).toBe(8000);
  });

  it('accepts isEndPage boolean and optional count', () => {
    const parsed = RawCompanyPositionListSchema.safeParse({ code: 200, data: { isEndPage: true, list: [] } });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.data!.list).toEqual([]);
  });
});
