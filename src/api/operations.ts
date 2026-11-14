/**
 * 操作注册表（单一事实源：REST 路由 / CLI / MCP / 文档生成）
 */
import { z } from 'zod';
import { HealthResponseSchema, StatusSchema } from '../domain/status.js';
import {
  LoginCancelResponseSchema,
  LoginSessionSchema,
  LoginSmsRequestSchema,
  LoginStartRequestSchema,
  VerificationSolveRequestSchema,
  VerificationSolveResponseSchema,
  VerificationStatusSchema,
} from '../domain/login.js';
import {
  CompaniesListResponseSchema,
  JobsListQuerySchema,
  JobsListResponseSchema,
  JobDetailQuerySchema,
  SearchJobsRequestSchema,
  SearchJobsResponseSchema,
} from '../domain/search.js';
import { JobDetailSchema } from '../domain/job.js';
import {
  CompaniesListQuerySchema,
  CompanyDetailQuerySchema,
  CompanyDetailSchema,
  CompanyJobsQuerySchema,
  CompanyJobsResponseSchema,
} from '../domain/company.js';
import { BooleanQuerySchema, LoginIdSchema, PositionNumberSchema, CompanyNumberSchema } from '../domain/common.js';
import { CacheClearQuerySchema, CacheClearResultSchema, CacheStatsSchema } from '../domain/cache.js';

export interface OperationDef {
  id: string;
  summary: string;
  auth: 'none' | 'bearer';
  rest: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    pathParams?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  };
  cli: { command: string; description: string; example?: string };
  mcp: { name: string; description: string };
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
}

const Empty = z.object({}).strict();

export const VerificationGetResponseSchema = VerificationStatusSchema;

export const CitiesQuerySchema = z
  .object({
    refresh: BooleanQuerySchema,
    level: z.enum(['country', 'province', 'city', 'district']).optional(),
  })
  .meta({ id: 'CitiesQuery' });

export const CitiesResponseSchema = z
  .object({
    cities: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        enName: z.string().optional(),
        province: z.string().optional(),
        level: z.enum(['country', 'province', 'city', 'district']),
        isDefault: z.boolean(),
      }),
    ),
    updatedAt: z.string(),
  })
  .meta({ id: 'CitiesResponse' });

export const PositionNumberParamsSchema = z.object({ positionNumber: PositionNumberSchema });
export const CompanyNumberParamsSchema = z.object({ companyNumber: CompanyNumberSchema });

export const OPERATIONS: OperationDef[] = [
  {
    id: 'health.get',
    summary: '健康检查',
    auth: 'none',
    rest: { method: 'GET', path: '/v1/health' },
    cli: { command: 'health', description: '健康检查', example: 'zhilian health' },
    mcp: { name: 'zhilian_health', description: '健康检查' },
    input: Empty,
    output: HealthResponseSchema,
  },
  {
    id: 'status.get',
    summary: '登录态 / 模式 / 会话 / EdgeOne / 风控 / 缓存状态',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/status' },
    cli: { command: 'status', description: '查看登录态、会话剩余、EdgeOne、风控冷却、缓存', example: 'zhilian status' },
    mcp: { name: 'zhilian_status', description: '登录态/模式/会话/EdgeOne/风控/缓存状态' },
    input: Empty,
    output: StatusSchema,
  },
  {
    id: 'session.login.start',
    summary: '开始登录（智联APP扫码 / 短信）',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/session/login', body: LoginStartRequestSchema },
    cli: { command: 'login start', description: '开始登录（默认智联 APP 扫码；--sms 短信）', example: 'zhilian login --qr' },
    mcp: { name: 'zhilian_login_start', description: '开始登录：mode=app-qr|wechat-qr|sms|password' },
    input: LoginStartRequestSchema,
    output: LoginSessionSchema,
  },
  {
    id: 'session.login.get',
    summary: '查询登录流程状态',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/session/login/{loginId}', pathParams: z.object({ loginId: LoginIdSchema }) },
    cli: { command: 'login status', description: '查询 loginId 状态', example: 'zhilian login status login_xxx' },
    mcp: { name: 'zhilian_login_status', description: '查询登录流程状态' },
    input: z.object({ loginId: LoginIdSchema }),
    output: LoginSessionSchema,
  },
  {
    id: 'session.login.sms',
    summary: '提交短信验证码',
    auth: 'bearer',
    rest: {
      method: 'POST',
      path: '/v1/session/login/{loginId}/sms',
      pathParams: z.object({ loginId: LoginIdSchema }),
      body: LoginSmsRequestSchema,
    },
    cli: { command: 'login sms', description: '提交短信验证码', example: 'zhilian login sms login_xxx --code 123456' },
    mcp: { name: 'zhilian_login_sms_verify', description: '提交短信验证码' },
    input: z.object({ loginId: LoginIdSchema, code: LoginSmsRequestSchema.shape.code }),
    output: LoginSessionSchema,
  },
  {
    id: 'session.login.cancel',
    summary: '取消登录流程',
    auth: 'bearer',
    rest: { method: 'DELETE', path: '/v1/session/login/{loginId}', pathParams: z.object({ loginId: LoginIdSchema }) },
    cli: { command: 'login cancel', description: '取消登录流程', example: 'zhilian login cancel login_xxx' },
    mcp: { name: 'zhilian_login_cancel', description: '取消登录流程' },
    input: z.object({ loginId: LoginIdSchema }),
    output: LoginCancelResponseSchema,
  },
  {
    id: 'verification.get',
    summary: '查询待处理人机验证（EdgeOne/极验/NC）',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/verification' },
    cli: { command: 'verify status', description: '查询待处理人机验证', example: 'zhilian verify status' },
    mcp: { name: 'zhilian_verification_get', description: '查询待处理人机验证' },
    input: Empty,
    output: VerificationStatusSchema,
  },
  {
    id: 'verification.solve',
    summary: '提交人机验证答案',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/verification/solve', body: VerificationSolveRequestSchema },
    cli: {
      command: 'verify solve',
      description: '提交人机验证（edgeone auto/points；geetest points/offset）',
      example: 'zhilian verify solve --kind edgeone --auto',
    },
    mcp: { name: 'zhilian_verification_solve', description: '提交 EdgeOne/极验答案（auto/points/offsetRatio）' },
    input: VerificationSolveRequestSchema,
    output: VerificationSolveResponseSchema,
  },
  {
    id: 'search.jobs',
    summary: '按关键词 + 城市搜索职位',
    auth: 'bearer',
    rest: { method: 'POST', path: '/v1/search/jobs', body: SearchJobsRequestSchema },
    cli: {
      command: 'search jobs',
      description: '职位搜索',
      example: 'zhilian search jobs --keyword 外贸 --city 565 --pages 1',
    },
    mcp: { name: 'zhilian_search_jobs', description: '按关键词 + 城市搜索职位' },
    input: SearchJobsRequestSchema,
    output: SearchJobsResponseSchema,
  },
  {
    id: 'jobs.list',
    summary: '按 queryId 翻页',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/jobs', query: JobsListQuerySchema },
    cli: { command: 'jobs list', description: '按 queryId 翻页', example: 'zhilian jobs list --query-id q_20261114_ab12cd --page 2' },
    mcp: { name: 'zhilian_list_jobs', description: '按 queryId 翻页' },
    input: JobsListQuerySchema,
    output: JobsListResponseSchema,
  },
  {
    id: 'jobs.detail',
    summary: '职位详情',
    auth: 'bearer',
    rest: {
      method: 'GET',
      path: '/v1/jobs/{positionNumber}',
      pathParams: PositionNumberParamsSchema,
      query: JobDetailQuerySchema,
    },
    cli: { command: 'jobs detail', description: '职位详情', example: 'zhilian jobs detail --number CCL1316344860J40974823208' },
    mcp: { name: 'zhilian_job_detail', description: '职位详情' },
    input: z.object({ positionNumber: PositionNumberSchema, refresh: z.boolean().default(false) }),
    output: JobDetailSchema,
  },
  {
    id: 'companies.list',
    summary: '职位结果按公司去重',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/companies', query: CompaniesListQuerySchema },
    cli: { command: 'companies list', description: '去重公司列表', example: 'zhilian companies list --query-id q_20261114_ab12cd' },
    mcp: { name: 'zhilian_list_companies', description: '职位结果按公司去重' },
    input: CompaniesListQuerySchema,
    output: CompaniesListResponseSchema,
  },
  {
    id: 'companies.detail',
    summary: '公司详情（含工商信息）',
    auth: 'bearer',
    rest: {
      method: 'GET',
      path: '/v1/companies/{companyNumber}',
      pathParams: CompanyNumberParamsSchema,
      query: CompanyDetailQuerySchema,
    },
    cli: {
      command: 'companies detail',
      description: '公司详情（含工商信息）',
      example: 'zhilian companies detail --number CZL1515276460',
    },
    mcp: { name: 'zhilian_company_detail', description: '公司详情（含工商信息）' },
    input: z.object({ companyNumber: CompanyNumberSchema, refresh: z.boolean().default(false) }),
    output: CompanyDetailSchema,
  },
  {
    id: 'companies.jobs',
    summary: '公司全部在招职位',
    auth: 'bearer',
    rest: {
      method: 'GET',
      path: '/v1/companies/{companyNumber}/jobs',
      pathParams: CompanyNumberParamsSchema,
      query: CompanyJobsQuerySchema,
    },
    cli: {
      command: 'companies jobs',
      description: '公司全部在招职位',
      example: 'zhilian companies jobs --number CZL1515276460',
    },
    mcp: { name: 'zhilian_company_jobs', description: '公司全部在招职位' },
    input: z.object({ companyNumber: CompanyNumberSchema, page: z.number().int().min(1).default(1), refresh: z.boolean().default(false) }),
    output: CompanyJobsResponseSchema,
  },
  {
    id: 'cities.list',
    summary: '城市注册表',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/cities', query: CitiesQuerySchema },
    cli: { command: 'cities list', description: '城市注册表', example: 'zhilian cities list --refresh' },
    mcp: { name: 'zhilian_cities', description: '城市注册表' },
    input: CitiesQuerySchema,
    output: CitiesResponseSchema,
  },
  {
    id: 'cache.stats',
    summary: '缓存统计',
    auth: 'bearer',
    rest: { method: 'GET', path: '/v1/cache/stats' },
    cli: { command: 'cache stats', description: '缓存统计', example: 'zhilian cache stats' },
    mcp: { name: 'zhilian_cache_stats', description: '缓存统计' },
    input: Empty,
    output: CacheStatsSchema,
  },
  {
    id: 'cache.clear',
    summary: '清缓存',
    auth: 'bearer',
    rest: { method: 'DELETE', path: '/v1/cache', query: CacheClearQuerySchema },
    cli: { command: 'cache clear', description: '清缓存', example: 'zhilian cache clear --all' },
    mcp: { name: 'zhilian_cache_clear', description: '清缓存：scope=all|expired' },
    input: CacheClearQuerySchema,
    output: CacheClearResultSchema,
  },
];

export function getOperation(id: string): OperationDef {
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`unknown operation: ${id}`);
  return op;
}

export function mcpTools(): Array<{ name: string; description: string; input: z.ZodTypeAny; operationId: string }> {
  return OPERATIONS.map((o) => ({ name: o.mcp.name, description: o.mcp.description, input: o.input, operationId: o.id }));
}

export function cliCommands(): Array<{ command: string; description: string; example?: string; operationId: string }> {
  return OPERATIONS.map((o) => ({
    command: `zhilian ${o.cli.command}`,
    description: o.cli.description,
    ...(o.cli.example ? { example: o.cli.example } : {}),
    operationId: o.id,
  }));
}
