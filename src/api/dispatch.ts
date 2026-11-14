/**
 * 操作分发：REST/CLI/MCP → ZhilianService
 */
import type { ZhilianService } from '../service.js';
import type { PaginationMeta } from '../schemas/envelope.js';
import type { SearchJobsRequest } from '../domain/search.js';
import type { LoginStartRequest, VerificationSolveRequest } from '../domain/login.js';

export interface InvocationInput {
  pathParams?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface InvocationResult {
  data: unknown;
  pagination?: PaginationMeta;
  cached?: boolean;
  mode?: 'logged_in' | 'anonymous';
  warnings?: string[];
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true';
}

async function invokeInner(service: ZhilianService, operationId: string, input: InvocationInput): Promise<InvocationResult> {
  const { pathParams = {}, query = {}, body = {} } = input;
  const mode = service.mode();
  switch (operationId) {
    case 'health.get':
      return { data: await service.health(), mode };
    case 'status.get':
      return { data: await service.status(), mode };
    case 'session.login.start':
      return { data: await service.loginStart(body as LoginStartRequest), mode };
    case 'session.login.get':
      return { data: await service.loginGet(pathParams.loginId ?? ''), mode };
    case 'session.login.sms': {
      const b = body as { code?: string };
      return { data: await service.loginSms(pathParams.loginId ?? '', b.code ?? ''), mode };
    }
    case 'session.login.cancel':
      return { data: await service.loginCancel(pathParams.loginId ?? ''), mode };
    case 'verification.get':
      return { data: await service.verificationGet(), mode };
    case 'verification.solve':
      return { data: await service.verificationSolve(body as VerificationSolveRequest), mode };
    case 'search.jobs': {
      const r = await service.searchJobs(body as SearchJobsRequest);
      const warnings: string[] = [];
      if (r.query.anonymous) warnings.push('anonymous_limited');
      return { data: r, pagination: r.pagination, cached: false, mode, warnings };
    }
    case 'jobs.list': {
      const r = await service.listJobs({
        queryId: String(query.queryId ?? ''),
        page: Number(query.page ?? 1),
        ...(query.pageSize !== undefined ? { pageSize: Number(query.pageSize) } : {}),
        refresh: asBool(query.refresh),
      });
      return { data: r, pagination: r.pagination, cached: false, mode };
    }
    case 'jobs.detail':
      return {
        data: await service.jobDetail({
          positionNumber: pathParams.positionNumber ?? '',
          refresh: asBool(query.refresh),
        }),
        mode,
      };
    case 'companies.list': {
      const r = await service.listCompanies({
        queryId: String(query.queryId ?? ''),
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 20),
        fetchPages: Number(query.fetchPages ?? 0),
        refresh: asBool(query.refresh),
      });
      return { data: r, pagination: r.pagination, cached: false, mode };
    }
    case 'companies.detail':
      return { data: await service.companyDetail({ companyNumber: pathParams.companyNumber ?? '', refresh: asBool(query.refresh) }), mode };
    case 'companies.jobs': {
      const r = await service.companyJobs({
        companyNumber: pathParams.companyNumber ?? '',
        page: Number(query.page ?? 1),
        refresh: asBool(query.refresh),
      });
      const warnings: string[] = [];
      if (r.truncated) warnings.push('truncated');
      return { data: r, mode, warnings };
    }
    case 'cities.list':
      return {
        data: await service.cities(asBool(query.refresh), query.level as never),
        mode,
      };
    case 'cache.stats':
      return { data: await service.cacheStats(), mode };
    case 'cache.clear':
      return {
        data: await service.cacheClear({
          scope: query.scope === 'expired' ? 'expired' : 'all',
          ...(typeof query.prefix === 'string' && query.prefix ? { prefix: query.prefix } : {}),
        }),
        mode,
      };
    default:
      throw new Error(`unknown operation: ${operationId}`);
  }
}

export async function invoke(service: ZhilianService, operationId: string, input: InvocationInput): Promise<InvocationResult> {
  const result = await invokeInner(service, operationId, input);
  return { ...result, mode: service.mode() };
}
