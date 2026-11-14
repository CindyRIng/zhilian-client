import { describe, it, expect } from 'vitest';
import {
  buildCompanySummaries,
  citiesFromBaseData,
  extractPositionNumber,
  mapCompanyDetail,
  mapCompanyJobs,
  mapJobDetailFromApi,
  mapJobSummary,
  parseSalary,
  stripHtml,
} from '../src/adapters/zhilian/mapper.js';

const rawPosition = {
  jobId: 40974823208,
  name: '外贸销售',
  salaryReal: '5001-9000',
  salary60: '5000-9000元',
  salaryType: 1,
  cityId: '565',
  workCity: '石家庄',
  cityDistrict: '裕华',
  education: '大专',
  workingExp: '1-3年',
  publishTime: '2026-11-14 13:47:27',
  companyNumber: 'CZL1316344860',
  companyName: '河北汇盛工业机械有限公司',
  companyUrl: 'http://company.zhaopin.com/CZL1316344860.htm',
  industryName: '通用设备制造',
  companySize: '300-499人',
  jobSummary: '岗位职责……',
  positionURL: 'https://www.zhaopin.com/jobdetail/CCL1316344860J40974823208.htm',
  jobDetailData: { staff: { staffName: '苏先生' } },
};

describe('mapper', () => {
  it('parses salary variants', () => {
    expect(parseSalary('5000-9000元')).toEqual({ min: 5000, max: 9000 });
    expect(parseSalary('1-2万')).toEqual({ min: 10000, max: 20000 });
    expect(parseSalary('4-8k')).toEqual({ min: 4000, max: 8000 });
    expect(parseSalary('面议')).toEqual({});
  });

  it('extracts positionNumber from URL', () => {
    expect(extractPositionNumber('https://www.zhaopin.com/jobdetail/CCL1316344860J40974823208.htm')).toBe('CCL1316344860J40974823208');
    expect(extractPositionNumber('https://www.zhaopin.com/jobdetail/CCL1J2.htm?x=1')).toBe('CCL1J2');
    expect(extractPositionNumber(undefined)).toBeUndefined();
  });

  it('maps a raw position to JobSummary', () => {
    const job = mapJobSummary(rawPosition as never, 'https://www.zhaopin.com')!;
    expect(job.positionNumber).toBe('CCL1316344860J40974823208');
    expect(job.title).toBe('外贸销售');
    expect(job.salaryMin).toBe(5000);
    expect(job.salaryMax).toBe(9000);
    expect(job.cityCode).toBe('565');
    expect(job.cityName).toBe('石家庄');
    expect(job.companyNumber).toBe('CZL1316344860');
    expect(job.publishTime).toBe('2026-11-14T13:47:27+08:00');
    expect(job.recruiterName).toBe('苏先生');
  });

  it('builds deduped company summaries', () => {
    const a = mapJobSummary(rawPosition as never, 'https://www.zhaopin.com')!;
    const b = mapJobSummary({ ...rawPosition, jobId: 2, positionURL: 'https://www.zhaopin.com/jobdetail/CCL1316344860J40974823209.htm', name: '外贸经理' } as never, 'https://www.zhaopin.com')!;
    const companies = buildCompanySummaries([a, b]);
    expect(companies).toHaveLength(1);
    expect(companies[0]!.jobCount).toBe(2);
    expect(companies[0]!.companyNumber).toBe('CZL1316344860');
    expect(companies[0]!.matchedJobs).toHaveLength(2);
  });

  it('maps position-detailv3 response to JobDetail', () => {
    const detail = mapJobDetailFromApi(
      {
        detailedCompany: {
          companyNumber: 'CZL1316344860',
          companyName: '河北汇盛工业机械有限公司',
          companySize: '300-499人',
          companyLogo: 'https://x/logo.png',
          industryNameLevel: '通用设备制造',
        },
        detailedPosition: {
          positionNumber: 'CCL1316344860J40974823208',
          positionName: '外贸销售',
          salary: '5000-9000元',
          education: '大专',
          positionWorkingExp: '1-3年',
          description: '<div>职责一</div><br><div>职责二</div>',
          workAddress: '石家庄市裕华区',
          positionWorkCity: '石家庄',
          positionCityDistrict: '裕华区',
          latitude: '38.01',
          longitude: '114.54',
          positionPublishTime: '2026-11-14 13:47:27',
          staff: { staffName: '苏先生', hrJob: 'boss', hrOnlineState: '当前在线', activityLevel: ['当前在线'] },
        },
      } as never,
      'CCL1316344860J40974823208',
      'https://www.zhaopin.com',
    );
    expect(detail.title).toBe('外贸销售');
    expect(detail.description).toContain('职责一');
    expect(detail.description).toContain('职责二');
    expect(detail.latitude).toBe(38.01);
    expect(detail.recruiter.name).toBe('苏先生');
    expect(detail.recruiter.online).toBe(true);
    expect(detail.company.companyNumber).toBe('CZL1316344860');
  });

  it('maps company detail state with business info', () => {
    const detail = mapCompanyDetail(
      {
        companyName: '深圳信然能源有限公司',
        companyDetail: {
          companyBase: {
            companyName: '深圳信然能源有限公司',
            companyNumber: 'CZL1515276460',
            companySize: '20-99人',
            cityName: '深圳',
            companyLogo: 'https://x/logo.png',
            companyDescription: '公司介绍……',
          },
          businessInformationData: {
            businessInformationData: {
              registeredName: '深圳信然能源有限公司',
              epCertNo: '91440300MAK3CLJ42W',
              legalPerson: '卜庆团',
              registeredCapital: '1000万元',
              epType: '有限责任公司',
              epStatus: '在营（开业）',
              registeredOrg: '深圳市市场监督管理局',
              businessScope: '一般经营项目……',
            },
          },
          onlinePositionNumbers: 12,
        },
        onlinePositionsCount: 12,
        onlinePositions: [],
      } as never,
      'CZL1515276460',
      'https://www.zhaopin.com',
    );
    expect(detail.name).toBe('深圳信然能源有限公司');
    expect(detail.business.uscc).toBe('91440300MAK3CLJ42W');
    expect(detail.business.legalPerson).toBe('卜庆团');
    expect(detail.jobCount).toBe(12);
    expect(detail.url).toContain('/companydetail/CZL1515276460.htm');
  });

  it('maps company jobs and flattens city registry', () => {
    const jobs = mapCompanyJobs(
      [
        { name: '仓库管理员', salary60: '5001-7000', positionURL: 'https://www.zhaopin.com/jobdetail/CCL1J1.htm', cityId: '697', workCity: '赣州' },
        { name: '招电工', salary60: '5001-10000', positionURL: 'https://www.zhaopin.com/jobdetail/CCL1J2.htm', cityId: '697', workCity: '赣州' },
      ] as never,
      'https://www.zhaopin.com',
    );
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.positionNumber).toBe('CCL1J1');
    expect(jobs[1]!.salaryMax).toBe(10000);

    const cities = citiesFromBaseData([
      { code: '532', name: '河北', sublist: [{ code: '565', name: '石家庄', sublist: [] }] },
    ]);
    expect(cities.find((c) => c.code === '489')?.name).toBe('全国');
    expect(cities.find((c) => c.code === '565')?.province).toBe('河北');
  });

  it('strips html', () => {
    expect(stripHtml('<div>a</div><br><div>b</div>')).toBe('a\n\nb');
    expect(stripHtml('a&nbsp;b')).toBe('a b');
  });
});
