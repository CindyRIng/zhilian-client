/**
 * 通用基础类型与 zod schema（单一事实源）
 */
import { z } from 'zod';

export const IsoDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/, 'must be ISO-8601 with timezone')
  .meta({ id: 'IsoDateTime', description: 'ISO-8601 日期时间（含时区）' });

export const NonEmptyStringSchema = z.string().min(1);
export const UrlSchema = z.string().url();

export const PageSchema = z.coerce.number().int().min(1).default(1).meta({ description: '页码，从 1 开始' });
export const PageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(20)
  .meta({ description: '每页条数（v1 上游固定 20）' });
export const PagesSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(5)
  .default(1)
  .meta({ description: '本次抓取页数，1-5' });
export const FetchPagesSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(5)
  .default(0)
  .meta({ description: 'companies.list 额外抓取页数，0-5' });

/** REST query 里的 boolean：接受 true/false 字符串或布尔 */
export const BooleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true')
  .default(false);

export const CityCodeSchema = z
  .string()
  .regex(/^\d{1,6}$/, 'cityCode must be a numeric string')
  .meta({ id: 'CityCode', description: '智联城市码（jl），如 565=石家庄、489=全国' });

export const PositionNumberSchema = z
  .string()
  .regex(/^[A-Za-z0-9_~.-]{6,80}$/, 'invalid positionNumber')
  .meta({ id: 'PositionNumber', description: '智联职位号（CCL…J…），用于 /jobdetail/<number>.htm 与 position-detailv3' });

export const CompanyNumberSchema = z
  .string()
  .regex(/^[A-Za-z0-9_~.-]{4,160}$/, 'invalid companyNumber')
  .meta({ id: 'CompanyNumber', description: '智联公司号（CZL…/CZ…/CC…），用于 /companydetail/<number>.htm' });

export const QueryIdSchema = z
  .string()
  .regex(/^q_\d{8}_[a-z0-9]{4,16}$/, 'invalid queryId')
  .meta({ id: 'QueryId', description: '搜索查询 ID' });

export const LoginIdSchema = z
  .string()
  .regex(/^login_[A-Za-z0-9_-]{8,64}$/, 'invalid loginId')
  .meta({ id: 'LoginId', description: '登录流程 ID' });

export const RequestIdSchema = z.string().min(8).meta({ description: '请求 ID，用于日志追踪' });

export const SortTypeSchema = z
  .enum(['DEFAULT', 'HR_ACTIVE_TIME', 'JOB_PUBLISH_TIME'])
  .meta({ id: 'SortType', description: '搜索排序：DEFAULT 智能排序 / HR_ACTIVE_TIME / JOB_PUBLISH_TIME' });

export const SearchModeSchema = z
  .enum(['logged_in', 'anonymous'])
  .meta({ id: 'SearchMode', description: '当前模式：已登录 / 匿名降级' });

export function maskPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const p = phone.replace(/\s+/g, '');
  if (p.length < 7) return '***';
  return `${p.slice(0, 3)}****${p.slice(-4)}`;
}

export function maskName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (name.length <= 1) return '*';
  return `${name.slice(0, 1)}${'*'.repeat(Math.min(2, name.length - 1))}`;
}

/** 把上游 "YYYY-MM-DD HH:mm:ss" 转成带时区的 ISO8601 */
export function normalizeDateTime(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
