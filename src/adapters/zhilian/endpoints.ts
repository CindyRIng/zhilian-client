/**
 * 智联招聘端点常量（2026-11-14 实测）
 */
export const ZHILIAN_ENDPOINTS = {
  baseUrl: 'https://www.zhaopin.com',
  loginUrl: 'https://passport.zhaopin.com/login',
  apiBase: 'https://fe-api.zhaopin.com',
  // 登录（passport）
  getEncryptKey: '/common/getEncryptKey',
  verifyInit: '/passportService/verify/init',
  smsInit: '/v4/sms/init',
  smsLoginAndRegister: '/v4/sms/loginAndRegister',
  appScanInit: '/v4/appScan/init',
  appScanImg: '/v4/appScan/img',
  appScanLogin: '/v4/appScan/login',
  // fe-api
  checkToken: '/c/i/checkToken',
  userDetail: '/c/i/user/detail',
  refreshToken: '/c/i/refresh-token',
  searchPositions: '/c/i/search/positions',
  companyPositions: '/c/i/company/search-position',
  positionDetail: '/c/i/jobs/position-detailv3',
  searchBaseData: '/c/i/search/base/data',
  regionRelation: '/c/datanormalization/region-relation',
  // 页面（SSR）
  searchPage: '/jobs/',
  jobDetailPage: '/jobdetail',
  companyPage: '/companydetail',
  companyJobsPage: '/companydetail/jobs-',
} as const;

export function searchPageUrl(baseUrl: string, keyword: string, cityCode: string, page = 1, sortType = 'JOB_PUBLISH_TIME'): string {
  const u = new URL('/jobs/', baseUrl);
  u.searchParams.set('kw', keyword);
  u.searchParams.set('jl', cityCode);
  u.searchParams.set('p', String(page));
  // 上游 `order` 与 sortType 的显式映射由调用方决定；这里只带 URL 排序参数
  if (sortType === 'JOB_PUBLISH_TIME') u.searchParams.set('order', '4');
  return u.toString();
}

export function jobDetailPageUrl(baseUrl: string, positionNumber: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/jobdetail/${encodeURIComponent(positionNumber)}.htm`;
}

export function companyPageUrl(baseUrl: string, companyNumber: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/companydetail/${encodeURIComponent(companyNumber)}.htm`;
}

export function companyJobsPageUrl(baseUrl: string, companyNumber: string, page = 1): string {
  const u = new URL(`/companydetail/jobs-${encodeURIComponent(companyNumber)}/`, baseUrl);
  if (page > 1) u.searchParams.set('p', String(page));
  return u.toString();
}

export function positionDetailApiUrl(apiBase: string, positionNumber: string): string {
  const u = new URL('/c/i/jobs/position-detailv3', apiBase);
  u.searchParams.set('number', positionNumber);
  u.searchParams.set('identity', '0');
  u.searchParams.set('platform', '13');
  u.searchParams.set('version', '0.0.0');
  return u.toString();
}

export function checkTokenUrl(apiBase: string): string {
  const u = new URL('/c/i/checkToken', apiBase);
  u.searchParams.set('platform', '13');
  u.searchParams.set('version', '0.0.0');
  return u.toString();
}

export function userDetailUrl(apiBase: string): string {
  const u = new URL('/c/i/user/detail', apiBase);
  u.searchParams.set('detail', 'true');
  return u.toString();
}

export function refreshTokenUrl(apiBase: string): string {
  return new URL('/c/i/refresh-token', apiBase).toString();
}

export function companyPositionsUrl(
  apiBase: string,
  companyNumber: string,
  pageIndex: number,
  pageSize: number,
  at?: string,
  rt?: string,
): string {
  const u = new URL('/c/i/company/search-position', apiBase);
  u.searchParams.set('S_SOU_COMPANY_ID', companyNumber);
  u.searchParams.set('pageSize', String(pageSize));
  u.searchParams.set('pageIndex', String(pageIndex));
  u.searchParams.set('S_SOU_SALARY_MIN', '');
  u.searchParams.set('S_SOU_SALARY_MAX', '');
  u.searchParams.set('S_SOU_WORK_CITY', '');
  u.searchParams.set('S_SOU_JD_JOB_LEVEL', '');
  if (at) u.searchParams.set('at', at);
  if (rt) u.searchParams.set('rt', rt);
  u.searchParams.set('platform', '13');
  u.searchParams.set('version', '0.0.0');
  return u.toString();
}

export function searchPositionsUrl(apiBase: string): string {
  const u = new URL('/c/i/search/positions', apiBase);
  u.searchParams.set('platform', '13');
  u.searchParams.set('version', '0.0.0');
  return u.toString();
}

export function searchBaseDataUrl(apiBase: string): string {
  const u = new URL('/c/i/search/base/data', apiBase);
  u.searchParams.set('platform', '13');
  u.searchParams.set('version', '0.0.0');
  return u.toString();
}

export function regionRelationUrl(apiBase: string): string {
  const u = new URL('/c/datanormalization/region-relation', apiBase);
  u.searchParams.set('maxLevel', 'district');
  u.searchParams.set('canSelectCity', '1');
  u.searchParams.set('canSelectProvince', '1');
  u.searchParams.set('canSelectUnlimit', '0');
  u.searchParams.set('canSelectWholeCountry', '0');
  u.searchParams.set('canSelectForeignCountry', '1');
  u.searchParams.set('canSelectForeign', '1');
  u.searchParams.set('useCustomWholeLabel', '1');
  return u.toString();
}

export function appScanInitUrl(loginUrl: string): string {
  const u = new URL('/v4/appScan/init', loginUrl);
  u.searchParams.set('scene', '10000060');
  return u.toString();
}

export function appScanImgUrl(loginUrl: string, validateId: string): string {
  return new URL(`/v4/appScan/img/${encodeURIComponent(validateId)}`, loginUrl).toString();
}

export function appScanLoginUrl(loginUrl: string, validateId: string): string {
  const u = new URL('/v4/appScan/login', loginUrl);
  u.searchParams.set('validateId', validateId);
  u.searchParams.set('rememberMe', 'true');
  return u.toString();
}

export function smsInitUrl(
  loginUrl: string,
  params: { scene?: string; countryCode?: string; encryptMobile: string; encryptRequestId: string; validateId?: string; validateData?: string; sessionId?: string; appID?: string },
): string {
  const u = new URL('/v4/sms/init', loginUrl);
  u.searchParams.set('scene', params.scene ?? '10101010');
  u.searchParams.set('countryCode', params.countryCode ?? '86');
  u.searchParams.set('encryptMobile', params.encryptMobile);
  u.searchParams.set('encryptRequestId', params.encryptRequestId);
  if (params.validateId) u.searchParams.set('validateId', params.validateId);
  if (params.validateData) u.searchParams.set('validateData', params.validateData);
  if (params.sessionId) u.searchParams.set('sessionId', params.sessionId);
  if (params.appID) u.searchParams.set('appID', params.appID);
  return u.toString();
}
