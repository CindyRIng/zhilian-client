/**
 * 智联上游映射：SSR state / fe-api JSON → 领域模型
 */
import type { BusinessInfo } from '../../domain/business.js';
import type { CompanyDetail, CompanyJob, CompanySummary } from '../../domain/company.js';
import type { JobDetail, JobSummary } from '../../domain/job.js';
import { normalizeDateTime } from '../../domain/common.js';
import { companyPageUrl, jobDetailPageUrl } from './endpoints.js';
import type {
  RawCompanyBase,
  RawCompanyDetailState,
  RawDetailedCompany,
  RawDetailedPosition,
  RawJobDetailState,
  RawPosition,
} from './raw.js';

function iso(now = Date.now()): string {
  return new Date(now).toISOString();
}

export function stripHtml(input: string | undefined): string {
  if (!input) return '';
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseSalary(text: string | undefined): { min?: number; max?: number } {
  if (!text) return {};
  const s = String(text).replace(/\s+/g, '');
  const wan = /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)万/.exec(s);
  if (wan) return { min: Math.round(Number(wan[1]) * 10000), max: Math.round(Number(wan[2]) * 10000) };
  const k = /(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)[kK]/.exec(s);
  if (k) return { min: Math.round(Number(k[1]) * 1000), max: Math.round(Number(k[2]) * 1000) };
  const yuan = /(\d+)-(\d+)/.exec(s);
  if (yuan) return { min: Number(yuan[1]), max: Number(yuan[2]) };
  const single = /(\d+)(?:元|\/天|\/时)?/.exec(s);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return {};
}

export function extractPositionNumber(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const byPath = /\/jobdetail\/([^/?#]+?)\.htm/.exec(value);
  if (byPath?.[1]) return decodeURIComponent(byPath[1]);
  const byNumber = /(CC[A-Za-z0-9]{0,20}J\d{6,})/.exec(value);
  if (byNumber?.[1]) return byNumber[1];
  return undefined;
}

function num(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function mapJobSummary(raw: RawPosition, baseUrl: string, now = Date.now()): JobSummary | null {
  const jd = raw.jobDetailData as
    | {
        position?: { base?: Record<string, unknown>; desc?: Record<string, unknown>; workLocation?: Record<string, unknown> };
        staff?: { staffName?: string; staffTitle?: string };
      }
    | undefined;
  const base = (jd?.position?.base ?? {}) as Record<string, unknown>;
  const desc = (jd?.position?.desc ?? {}) as Record<string, unknown>;
  const loc = (jd?.position?.workLocation ?? {}) as Record<string, unknown>;
  const positionNumber =
    extractPositionNumber(raw.positionURL) ??
    extractPositionNumber(raw.positionUrl) ??
    (typeof base.positionNumber === 'string' ? base.positionNumber : undefined);
  const companyNumber = raw.companyNumber;
  if (!positionNumber || !companyNumber) return null;
  const ts = iso(now);
  const salaryText = raw.salary60 ?? raw.salaryReal ?? (typeof base.salary === 'string' ? base.salary : '') ?? '';
  const salary = parseSalary(salaryText);
  const cityCodeRaw = raw.cityId ?? loc.positionCityId ?? base.positionCityId;
  const cityCode = cityCodeRaw === undefined || cityCodeRaw === null ? undefined : String(cityCodeRaw);
  const recruiterName = jd?.staff?.staffName;
  return {
    positionNumber,
    ...(typeof raw.jobId === 'number' ? { jobId: raw.jobId } : {}),
    title: raw.name || (typeof base.positionName === 'string' ? base.positionName : ''),
    salaryText,
    ...(salary.min !== undefined ? { salaryMin: salary.min } : {}),
    ...(salary.max !== undefined ? { salaryMax: salary.max } : {}),
    ...(raw.salaryType !== undefined ? { salaryType: raw.salaryType } : {}),
    education: raw.education ?? (typeof base.education === 'string' ? base.education : ''),
    experience: raw.workingExp ?? (typeof base.positionWorkingExp === 'string' ? base.positionWorkingExp : ''),
    ...(raw.workType || typeof base.workType === 'string' ? { workType: raw.workType ?? (base.workType as string) } : {}),
    ...(cityCode ? { cityCode } : {}),
    ...(raw.workCity || typeof loc.positionWorkCity === 'string' ? { cityName: raw.workCity ?? (loc.positionWorkCity as string) } : {}),
    ...(raw.cityDistrict || typeof loc.positionCityDistrict === 'string'
      ? { district: raw.cityDistrict ?? (loc.positionCityDistrict as string) }
      : {}),
    ...(normalizeDateTime(raw.publishTime ?? (base.positionPublishTime as string | undefined))
      ? { publishTime: normalizeDateTime(raw.publishTime ?? (base.positionPublishTime as string | undefined))! }
      : {}),
    companyNumber,
    companyName: raw.companyName ?? '',
    ...(raw.industryName ? { companyIndustry: raw.industryName } : {}),
    ...(raw.companySize ? { companySize: raw.companySize } : {}),
    ...(typeof raw.financingStage === 'string' ? { financingStage: raw.financingStage } : {}),
    ...(raw.jobSummary && raw.jobSummary.trim()
      ? { jobSummary: raw.jobSummary }
      : typeof desc.description === 'string' && desc.description
        ? { jobSummary: stripHtml(desc.description).slice(0, 800) }
        : {}),
    ...(recruiterName ? { recruiterName } : {}),
    jobUrl: raw.positionURL ?? raw.positionUrl ?? jobDetailPageUrl(baseUrl, positionNumber),
    firstSeenAt: ts,
    lastSeenAt: ts,
  };
}

export function mapJobSummaries(positions: RawPosition[], baseUrl: string, now = Date.now()): { jobs: JobSummary[]; seen: Map<string, number> } {
  const jobs: JobSummary[] = [];
  const seen = new Map<string, number>();
  for (const p of positions) {
    const job = mapJobSummary(p, baseUrl, now);
    if (!job) continue;
    const prev = seen.get(job.positionNumber);
    if (prev !== undefined) {
      jobs[prev] = { ...jobs[prev]!, lastSeenAt: job.lastSeenAt };
      continue;
    }
    seen.set(job.positionNumber, jobs.length);
    jobs.push(job);
  }
  return { jobs, seen };
}

export function mapJobDetailFromApi(
  data: { detailedCompany: RawDetailedCompany; detailedPosition: RawDetailedPosition },
  positionNumber: string,
  baseUrl: string,
  now = Date.now(),
): JobDetail {
  const dp = data.detailedPosition;
  const dc = data.detailedCompany;
  const salaryText = dp.salary ?? '';
  const salary = parseSalary(salaryText);
  const lat = num(dp.latitude);
  const lng = num(dp.longitude);
  const staff = dp.staff as { staffName?: string; hrJob?: string; lastOnlineTimeText?: string; hrOnlineState?: string; avatar?: string; activityLevel?: string[] } | undefined;
  const online = Boolean(staff?.hrOnlineState) || /在线/.test(String(staff?.lastOnlineTimeText ?? ''));
  return {
    positionNumber,
    ...(dp.positionId ? { jobId: dp.positionId } : {}),
    title: dp.positionName,
    salaryText,
    ...(salary.min !== undefined ? { salaryMin: salary.min } : {}),
    ...(salary.max !== undefined ? { salaryMax: salary.max } : {}),
    ...(dp.salaryType !== undefined ? { salaryType: dp.salaryType } : {}),
    education: dp.education ?? '',
    experience: dp.positionWorkingExp ?? '',
    ...(dp.workType ? { workType: dp.workType } : {}),
    ...(dp.positionCityId !== undefined ? { cityCode: String(dp.positionCityId) } : {}),
    ...(dp.positionWorkCity ? { cityName: dp.positionWorkCity } : {}),
    ...(dp.positionCityDistrict ? { district: dp.positionCityDistrict } : {}),
    ...(dp.workAddress ? { address: dp.workAddress } : {}),
    ...(lat !== undefined ? { latitude: lat } : {}),
    ...(lng !== undefined ? { longitude: lng } : {}),
    description: stripHtml(dp.description ?? dp.jobDesc),
    labels: dp.labels ?? [],
    welfareTags: dp.welfareTags ?? [],
    ...(normalizeDateTime(dp.positionPublishTime ?? dp.publishTime)
      ? { publishTime: normalizeDateTime(dp.positionPublishTime ?? dp.publishTime)! }
      : {}),
    recruiter: {
      ...(staff?.staffName ? { name: staff.staffName } : {}),
      ...(staff?.hrJob ? { title: staff.hrJob } : {}),
      online,
      ...(staff?.avatar ? { avatar: staff.avatar } : {}),
      ...(Array.isArray(staff?.activityLevel) ? { activity: staff.activityLevel } : {}),
    },
    company: {
      companyNumber: dc.companyNumber,
      name: dc.companyName,
      ...(dc.industryNameLevel ? { industry: dc.industryNameLevel } : {}),
      ...(dc.companySize ? { size: dc.companySize } : {}),
      ...(typeof dc.financingStageName === 'string' && dc.financingStageName ? { financingStage: dc.financingStageName } : {}),
      ...(dc.companyLogo ? { logo: dc.companyLogo } : {}),
    },
    jobUrl: dp.positionUrl ?? dc.url ?? jobDetailPageUrl(baseUrl, positionNumber),
    fetchedAt: iso(now),
  };
}

export function mapJobDetailFromState(state: RawJobDetailState, baseUrl: string, now = Date.now()): JobDetail | null {
  const dp = state.jobDetail?.detailedPosition;
  const dc = state.jobDetail?.detailedCompany;
  if (!dp || !dc) return null;
  const detail = mapJobDetailFromApi({ detailedCompany: dc, detailedPosition: dp }, dp.positionNumber ?? state.jobNumber ?? '', baseUrl, now);
  const biz = state.companyExtDetail?.businessInformation?.businessInformationData;
  if (biz) detail.business = mapBusiness(biz);
  return detail;
}

export function mapBusiness(raw: Record<string, unknown> | undefined): BusinessInfo {
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' && v !== '--' ? v : undefined);
  return {
    ...(s(raw?.registeredName) ? { registeredName: s(raw?.registeredName) } : {}),
    ...(s(raw?.epCertNo) ? { uscc: s(raw?.epCertNo) } : {}),
    ...(s(raw?.legalPerson) ? { legalPerson: s(raw?.legalPerson) } : {}),
    ...(s(raw?.registeredCapital) ? { registeredCapital: s(raw?.registeredCapital) } : {}),
    ...(s(raw?.epType) ? { companyType: s(raw?.epType) } : {}),
    ...(s(raw?.epStatus) ? { businessStatus: s(raw?.epStatus) } : {}),
    ...(s(raw?.createDate) ? { createDate: s(raw?.createDate) } : {}),
    ...(s(raw?.registeredOrg) ? { registeredOrg: s(raw?.registeredOrg) } : {}),
    ...(s(raw?.location) ? { location: s(raw?.location) } : {}),
    ...(s(raw?.registeredAddress) ? { registeredAddress: s(raw?.registeredAddress) } : {}),
    ...(s(raw?.businessScope) ? { businessScope: s(raw?.businessScope) } : {}),
    ...(s(raw?.businessPeriod) ? { businessPeriod: s(raw?.businessPeriod) } : {}),
    ...(s(raw?.creditLevel) ? { creditLevel: s(raw?.creditLevel) } : {}),
    ...(s(raw?.industry) ? { industry: s(raw?.industry) } : {}),
    textDerived: true,
  };
}

function mapCompanyBase(base: RawCompanyBase | undefined): Partial<CompanyDetail> {
  if (!base) return {};
  const lat = num(base.coordinate?.latitude);
  const lng = num(base.coordinate?.longitude);
  return {
    name: base.companyName,
    ...(base.companyShotName ? { fullName: base.companyShotName } : {}),
    ...(base.companyLogo ? { logo: base.companyLogo } : {}),
    ...(base.industryName ?? base.industryNameLevel ? { industry: base.industryName ?? base.industryNameLevel } : {}),
    ...(base.companySize ? { size: base.companySize } : {}),
    ...(typeof base.financingStageName === 'string' && base.financingStageName ? { financingStage: base.financingStageName } : {}),
    ...(base.cityName ? { cityName: base.cityName } : {}),
    ...(base.address ? { address: base.address } : {}),
    ...(lat !== undefined || lng !== undefined ? { coordinate: { ...(lat !== undefined ? { latitude: lat } : {}), ...(lng !== undefined ? { longitude: lng } : {}) } } : {}),
    ...(base.companyWebsiteUrl ? { website: base.companyWebsiteUrl } : {}),
    ...(base.companyDescription || base.companyDescWithHtml ? { intro: stripHtml(base.companyDescription ?? base.companyDescWithHtml) } : {}),
  };
}

export function mapCompanyDetail(state: RawCompanyDetailState, companyNumber: string, baseUrl: string, now = Date.now()): CompanyDetail {
  const base = state.companyDetail?.companyBase;
  const business = state.companyDetail?.businessInformationData?.businessInformationData;
  const mappedBase = mapCompanyBase(base);
  const name = mappedBase.name ?? state.companyName ?? companyNumber;
  const jobCount = state.onlinePositionsCount ?? state.companyDetail?.onlinePositionNumbers ?? 0;
  const hotJobs = mapCompanyJobs(state.onlinePositions ?? [], baseUrl);
  const businessMapped = business ? mapBusiness(business) : { textDerived: true as const };
  return {
    companyNumber,
    name,
    ...(mappedBase.fullName ? { fullName: mappedBase.fullName } : {}),
    ...(mappedBase.logo ? { logo: mappedBase.logo } : {}),
    ...(mappedBase.industry ? { industry: mappedBase.industry } : {}),
    ...(mappedBase.size ? { size: mappedBase.size } : {}),
    ...(mappedBase.financingStage ? { financingStage: mappedBase.financingStage } : {}),
    ...(mappedBase.cityName ? { cityName: mappedBase.cityName } : {}),
    ...(mappedBase.address ? { address: mappedBase.address } : {}),
    ...(mappedBase.coordinate ? { coordinate: mappedBase.coordinate } : {}),
    ...(mappedBase.website ? { website: mappedBase.website } : {}),
    ...(mappedBase.intro ? { intro: mappedBase.intro } : {}),
    tags: mappedBase.industry ? [mappedBase.industry] : [],
    benefits: [],
    jobCount,
    hotJobs: hotJobs.slice(0, 10),
    business: businessMapped,
    url: companyPageUrl(baseUrl, companyNumber),
    fetchedAt: iso(now),
  };
}

export function mapCompanyJobs(positions: RawPosition[], baseUrl: string): CompanyJob[] {
  const out: CompanyJob[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    const pn = extractPositionNumber(p.positionURL) ?? extractPositionNumber(p.positionUrl);
    if (!pn || seen.has(pn)) continue;
    seen.add(pn);
    const salaryText = p.salary60 ?? p.salaryReal ?? '';
    const salary = parseSalary(salaryText);
    out.push({
      positionNumber: pn,
      title: p.name,
      salaryText,
      ...(salary.min !== undefined ? { salaryMin: salary.min } : {}),
      ...(salary.max !== undefined ? { salaryMax: salary.max } : {}),
      ...(p.education ? { education: p.education } : {}),
      ...(p.workingExp ? { experience: p.workingExp } : {}),
      ...(p.workCity ? { cityName: p.workCity } : {}),
      ...(p.cityDistrict ? { district: p.cityDistrict } : {}),
      ...(normalizeDateTime(p.publishTime) ? { publishTime: normalizeDateTime(p.publishTime)! } : {}),
      jobUrl: p.positionURL ?? p.positionUrl ?? jobDetailPageUrl(baseUrl, pn),
    });
  }
  return out;
}

export function dedupeJobs(jobs: JobSummary[]): JobSummary[] {
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.positionNumber) ? false : (seen.add(j.positionNumber), true)));
}

export function buildCompanySummaries(jobs: JobSummary[]): CompanySummary[] {
  const map = new Map<string, JobSummary[]>();
  for (const job of dedupeJobs(jobs)) {
    const arr = map.get(job.companyNumber) ?? [];
    arr.push(job);
    map.set(job.companyNumber, arr);
  }
  const out: CompanySummary[] = [];
  for (const [companyNumber, list] of map) {
    const sorted = [...list].sort((a, b) => (b.publishTime ?? '').localeCompare(a.publishTime ?? ''));
    const first = sorted[sorted.length - 1]!;
    const last = sorted[0]!;
    out.push({
      companyNumber,
      name: first.companyName,
      ...(first.companyIndustry ? { industry: first.companyIndustry } : {}),
      ...(first.companySize ? { size: first.companySize } : {}),
      ...(first.financingStage !== undefined ? { financingStage: first.financingStage } : {}),
      ...(first.cityName ? { cityName: first.cityName } : {}),
      jobCount: list.length,
      matchedJobs: sorted.slice(0, 10).map((j) => ({
        positionNumber: j.positionNumber,
        title: j.title,
        salaryText: j.salaryText,
        ...(j.cityName ? { cityName: j.cityName } : {}),
        ...(j.publishTime ? { publishTime: j.publishTime } : {}),
      })),
      firstSeenAt: first.firstSeenAt,
      lastSeenAt: last.lastSeenAt,
    });
  }
  return out.sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name, 'zh-CN'));
}

export function citiesFromBaseData(allCity: unknown): Array<{ code: string; name: string; enName?: string; province?: string; level: 'country' | 'province' | 'city' | 'district' }> {
  const out: Array<{ code: string; name: string; enName?: string; province?: string; level: 'country' | 'province' | 'city' | 'district' }> = [
    { code: '489', name: '全国', level: 'country' },
  ];
  const municipalities = new Set(['北京', '上海', '天津', '重庆']);
  const walk = (nodes: unknown, level: 'province' | 'city' | 'district', province?: string): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes as Array<Record<string, unknown>>) {
      const code = node.code === undefined || node.code === null ? undefined : String(node.code);
      const name = typeof node.name === 'string' ? node.name : undefined;
      if (!code || !name) continue;
      const effectiveLevel = level === 'province' && municipalities.has(name) ? 'city' : level;
      out.push({
        code,
        name,
        ...(typeof node.en_name === 'string' && node.en_name ? { enName: node.en_name } : {}),
        ...(province ? { province } : effectiveLevel === 'city' && level === 'province' ? { province: name } : {}),
        level: effectiveLevel,
      });
      if (Array.isArray(node.sublist) && node.sublist.length) {
        const nextLevel = effectiveLevel === 'province' ? 'city' : 'district';
        walk(node.sublist, nextLevel, effectiveLevel === 'province' ? name : province);
      }
    }
  };
  walk(allCity, 'province');
  return out;
}
