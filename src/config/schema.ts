/**
 * 运行配置（env > defaults；支持项目根 .env）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ZhilianError } from '../errors/catalog.js';

export const VERSION = '0.1.0';

function home(): string {
  return process.env.HOME || os.homedir();
}

export function expandHome(p: string): string {
  if (p === '~') return home();
  if (p.startsWith('~/')) return path.join(home(), p.slice(2));
  return p;
}

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}
function optStr(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
}
function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new ZhilianError('BAD_REQUEST', `${key} must be boolean`);
}
function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const v = env[key];
  if (v === undefined || v === '') return fallback;
  if (!/^\d+$/.test(v)) throw new ZhilianError('BAD_REQUEST', `${key} must be an integer`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min) throw new ZhilianError('BAD_REQUEST', `${key} out of range`);
  return n;
}

export const SortTypeEnum = z.enum(['DEFAULT', 'HR_ACTIVE_TIME', 'JOB_PUBLISH_TIME']);
export type SortType = z.infer<typeof SortTypeEnum>;

export const ConfigSchema = z
  .object({
    baseUrl: z.string().url(),
    loginUrl: z.string().url(),
    apiBase: z.string().url(),
    phone: z.string().optional(),
    profileDir: z.string(),
    headless: z.boolean(),
    humanize: z.boolean(),
    loginMode: z.enum(['app-qr', 'wechat-qr', 'sms', 'password']),
    qrPollMs: z.number().int().positive(),
    edgeAuto: z.boolean(),
    edgeWaitSec: z.number().int().positive(),
    anonymous: z.boolean(),
    apiToken: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    sessionFile: z.string(),
    lockFile: z.string(),
    cache: z.object({
      dbPath: z.string(),
      driver: z.enum(['sqlite', 'memory']),
      queryTtlSec: z.number().int().nonnegative(),
      listTtlSec: z.number().int().nonnegative(),
      jobDetailTtlSec: z.number().int().nonnegative(),
      companyTtlSec: z.number().int().nonnegative(),
      companyJobsTtlSec: z.number().int().nonnegative(),
    }),
    session: z.object({
      heartbeatSec: z.number().int().positive(),
      ratePerMin: z.number().int().nonnegative(),
      maxPages: z.number().int().positive().max(5),
      pageDelayMs: z.number().int().nonnegative(),
      pageDelayJitterMs: z.number().int().nonnegative(),
      cooldownSec: z.number().int().nonnegative(),
      requestTimeoutMs: z.number().int().positive(),
      loginTimeoutSec: z.number().int().positive(),
      verificationTtlSec: z.number().int().positive(),
      concurrency: z.number().int().min(1).max(4),
      refreshAtBeforeSec: z.number().int().nonnegative(),
      checkTokenOnStatus: z.boolean(),
    }),
    cities: z.array(z.string().regex(/^\d{1,6}$/)),
    sortType: SortTypeEnum,
    order: z.number().int().min(0).max(99),
    log: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      file: z.string(),
      maxBytes: z.number().int().positive(),
      keep: z.number().int().positive(),
      stdout: z.boolean(),
    }),
  })
  .meta({ id: 'ZhilianConfig' });

export type Config = z.infer<typeof ConfigSchema>;

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const env = opts.env ?? process.env;
  const dataDir = expandHome(str(env, 'ZHILIAN_DATA_DIR', '~/.zhilian-client'));
  const cfg: Config = {
    baseUrl: str(env, 'ZHILIAN_BASE_URL', 'https://www.zhaopin.com').replace(/\/+$/, ''),
    loginUrl: str(env, 'ZHILIAN_LOGIN_URL', 'https://passport.zhaopin.com/login'),
    apiBase: str(env, 'ZHILIAN_API_BASE', 'https://fe-api.zhaopin.com').replace(/\/+$/, ''),
    phone: optStr(env, 'ZHILIAN_PHONE'),
    profileDir: expandHome(str(env, 'ZHILIAN_PROFILE_DIR', path.join(dataDir, 'profile'))),
    headless: bool(env, 'ZHILIAN_HEADLESS', true),
    humanize: bool(env, 'ZHILIAN_HUMANIZE', true),
    loginMode: (str(env, 'ZHILIAN_LOGIN_MODE', 'app-qr') as Config['loginMode']),
    qrPollMs: int(env, 'ZHILIAN_QR_POLL_MS', 2000, 500),
    edgeAuto: bool(env, 'ZHILIAN_EDGE_AUTO', false),
    edgeWaitSec: int(env, 'ZHILIAN_EDGE_WAIT_SEC', 120, 10),
    anonymous: bool(env, 'ZHILIAN_ANONYMOUS', true),
    apiToken: str(env, 'ZHILIAN_API_TOKEN', 'change-me'),
    host: str(env, 'ZHILIAN_HOST', '127.0.0.1'),
    port: int(env, 'ZHILIAN_PORT', 8791, 1),
    sessionFile: expandHome(str(env, 'ZHILIAN_SESSION_FILE', path.join(dataDir, 'session.json'))),
    lockFile: expandHome(str(env, 'ZHILIAN_LOCK_FILE', path.join(dataDir, 'run/zhilian.lock'))),
    cache: {
      dbPath: expandHome(str(env, 'ZHILIAN_CACHE_DB', path.join(dataDir, 'cache.db'))),
      driver: (str(env, 'ZHILIAN_CACHE_DRIVER', 'sqlite') as Config['cache']['driver']),
      queryTtlSec: int(env, 'ZHILIAN_CACHE_QUERY_TTL', 86400),
      listTtlSec: int(env, 'ZHILIAN_CACHE_LIST_TTL', 7200),
      jobDetailTtlSec: int(env, 'ZHILIAN_CACHE_JOB_DETAIL_TTL', 43200),
      companyTtlSec: int(env, 'ZHILIAN_CACHE_COMPANY_TTL', 604800),
      companyJobsTtlSec: int(env, 'ZHILIAN_CACHE_COMPANY_JOBS_TTL', 7200),
    },
    session: {
      heartbeatSec: int(env, 'ZHILIAN_HEARTBEAT_SEC', 300, 30),
      ratePerMin: int(env, 'ZHILIAN_RATE_PER_MIN', 15),
      maxPages: int(env, 'ZHILIAN_MAX_PAGES', 5, 1),
      pageDelayMs: int(env, 'ZHILIAN_PAGE_DELAY_MS', 2500),
      pageDelayJitterMs: int(env, 'ZHILIAN_PAGE_DELAY_JITTER_MS', 1500),
      cooldownSec: int(env, 'ZHILIAN_COOLDOWN_SEC', 60),
      requestTimeoutMs: int(env, 'ZHILIAN_REQUEST_TIMEOUT_MS', 30000, 1000),
      loginTimeoutSec: int(env, 'ZHILIAN_LOGIN_TIMEOUT_SEC', 600, 60),
      verificationTtlSec: int(env, 'ZHILIAN_VERIFICATION_TTL_SEC', 600, 30),
      concurrency: int(env, 'ZHILIAN_CONCURRENCY', 1, 1),
      refreshAtBeforeSec: int(env, 'ZHILIAN_REFRESH_AT_BEFORE_SEC', 3600),
      checkTokenOnStatus: bool(env, 'ZHILIAN_CHECK_TOKEN_ON_STATUS', true),
    },
    cities: str(env, 'ZHILIAN_CITIES', '565')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sortType: (str(env, 'ZHILIAN_SORT_TYPE', 'JOB_PUBLISH_TIME') as SortType),
    order: int(env, 'ZHILIAN_ORDER', 4),
    log: {
      level: (str(env, 'ZHILIAN_LOG_LEVEL', 'info') as Config['log']['level']),
      file: expandHome(str(env, 'ZHILIAN_LOG_FILE', path.join(dataDir, 'logs/zhilian.log'))),
      maxBytes: int(env, 'ZHILIAN_LOG_MAX_BYTES', 10 * 1024 * 1024, 1024),
      keep: int(env, 'ZHILIAN_LOG_KEEP', 5, 1),
      stdout: bool(env, 'ZHILIAN_LOG_STDOUT', true),
    },
  };
  if (cfg.session.maxPages > 5) throw new ZhilianError('BAD_REQUEST', 'ZHILIAN_MAX_PAGES max is 5');
  if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
    throw new ZhilianError('BAD_REQUEST', 'ZHILIAN_HOST must be 127.0.0.1 (local only)');
  }
  const parsed = ConfigSchema.safeParse(cfg);
  if (!parsed.success) throw new ZhilianError('BAD_REQUEST', 'invalid config', { details: { issues: parsed.error.issues } });
  return parsed.data;
}

export function ensureDataDirs(cfg: Config): void {
  fs.mkdirSync(path.dirname(cfg.profileDir), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(cfg.cache.dbPath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(cfg.log.file), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(cfg.lockFile), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(cfg.sessionFile), { recursive: true, mode: 0o700 });
}

export function loadDotEnv(file = process.env.ZHILIAN_ENV_FILE ?? path.join(process.cwd(), '.env')): void {
  const target = expandHome(file);
  if (!fs.existsSync(target)) return;
  try {
    const text = fs.readFileSync(target, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* .env is optional */
  }
}
