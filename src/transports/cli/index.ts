/**
 * CLI 入口
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Command } from 'commander';
import { createApp, type App } from '../../app.js';
import { createBackend, type Backend } from '../../backend.js';
import { loadConfig } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { invoke, type InvocationInput, type InvocationResult } from '../../api/dispatch.js';
import { getOperation, OPERATIONS } from '../../api/operations.js';
import { asZhilianError } from '../../errors/catalog.js';
import { failureEnvelope, successEnvelope } from '../../schemas/envelope.js';
import type { LoginSession, VerificationSolveRequest } from '../../domain/login.js';
import type { ZhilianService } from '../../service.js';
import { renderQrTerminal } from './qr.js';

const VERSION = '0.1.0';
let backend: Backend | null = null;

async function getBackend(opts: { local?: boolean; url?: string } = {}): Promise<Backend> {
  if (!backend) {
    backend =
      opts.local === true
        ? await createBackend({ mode: 'local' })
        : await createBackend({ mode: opts.url || process.env.ZHILIAN_CLIENT_URL ? 'remote' : 'auto', ...(opts.url ? { url: opts.url } : {}) });
  }
  return backend;
}

async function closeBackend(): Promise<void> {
  if (backend) {
    await backend.close().catch(() => {});
    backend = null;
  }
}

function rid(): string {
  return `cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function printResult(result: InvocationResult, opts: { table?: boolean; format?: string } = {}): void {
  if (opts.table && opts.format === 'table') {
    printTable(result.data);
    return;
  }
  console.log(
    JSON.stringify(
      successEnvelope(result.data, {
        requestId: rid(),
        tookMs: 0,
        cached: result.cached ?? false,
        ...(result.mode ? { mode: result.mode } : {}),
        ...(result.pagination ? { pagination: result.pagination } : {}),
        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      }),
      null,
      2,
    ),
  );
}

function printError(err: unknown): void {
  const e = asZhilianError(err);
  console.error(JSON.stringify(failureEnvelope(e.toJSON(), { requestId: rid(), tookMs: 0 }), null, 2));
  process.exitCode = 1;
}

function printTable(data: unknown): void {
  const d = data as Record<string, unknown>;
  const jobs = Array.isArray(d.jobs) ? (d.jobs as Array<Record<string, unknown>>) : null;
  if (jobs) {
    for (const j of jobs) {
      console.log([j.title, j.salaryText, j.companyName, j.cityName, j.experience, j.degree].map((x) => String(x ?? '')).join('\t'));
    }
    return;
  }
  const companies = Array.isArray(d.companies) ? (d.companies as Array<Record<string, unknown>>) : null;
  if (companies) {
    for (const c of companies) console.log([c.name, c.jobCount, c.industry, c.size, c.cityName].map((x) => String(x ?? '')).join('\t'));
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

async function run(
  opId: string,
  input: InvocationInput,
  opts: { table?: boolean; format?: string; local?: boolean; url?: string } = {},
): Promise<void> {
  try {
    const b = await getBackend({ ...(opts.local !== undefined ? { local: opts.local } : {}), ...(opts.url ? { url: opts.url } : {}) });
    const result = await invoke(b.service, opId, input);
    printResult(result, { table: opts.table, format: opts.format });
  } catch (err) {
    printError(err);
  } finally {
    await closeBackend();
  }
}

function parsePoints(raw: string): Array<{ x: number; y: number }> {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) throw new Error(`invalid point: ${pair}`);
      return { x, y };
    });
}

/** 把 data URL 二维码落到本机文件（上游为 JPEG，无法用 pngjs 直接终端渲染） */
function saveQrFile(config: { sessionFile: string }, pngBase64: string): string | null {
  try {
    const b64 = pngBase64.includes(',') ? pngBase64.split(',')[1]! : pngBase64;
    const header = pngBase64.startsWith('data:image/png') ? 'png' : 'jpg';
    const dir = path.join(path.dirname(config.sessionFile), 'tmp');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `login-qr-${Date.now()}.${header}`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    return file;
  } catch {
    return null;
  }
}

function showQr(session: LoginSession, config: { sessionFile: string }): void {
  if (!session.qr?.pngBase64) return;
  if (session.qr.pngBase64.startsWith('data:image/png')) {
    try {
      console.log(renderQrTerminal(session.qr.pngBase64));
      return;
    } catch {
      /* fall through to file */
    }
  }
  const file = saveQrFile(config, session.qr.pngBase64);
  if (file) {
    console.log(`二维码已保存到：${file}`);
    console.log('请用「智联招聘 APP → 扫一扫」扫描该图片；或使用 REST 返回的 qr.pngBase64 在前端展示。');
  } else {
    console.log('无法保存二维码，请使用 REST 中继获取 qr.pngBase64。');
  }
}

async function interactiveLogin(service: ZhilianService, config: { sessionFile: string; session: { loginTimeoutSec: number } }, initial: LoginSession): Promise<void> {
  let session = initial;
  let lastState = '';
  const deadline = Date.now() + config.session.loginTimeoutSec * 1000;
  let qrShown = false;
  while (Date.now() < deadline) {
    if (session.state !== lastState) {
      lastState = session.state;
      if (session.state !== 'awaiting_scan' || session.message) {
        console.log(`[login] state=${session.state}${session.message ? ` (${session.message})` : ''}`);
      }
    }
    if (session.state === 'logged_in') {
      console.log('登录成功');
      return;
    }
    if (session.state === 'failed' || session.state === 'expired' || session.state === 'cancelled') {
      throw new Error(`登录失败：${session.state}${session.message ? ` ${session.message}` : ''}`);
    }
    if (session.state === 'awaiting_scan' && session.qr?.pngBase64 && !qrShown) {
      showQr(session, config);
      qrShown = true;
    }
    if (session.state === 'awaiting_captcha') {
      console.log('[login] 需要人机验证：另开终端执行 `zhilian verify status` 查看，或 `zhilian verify solve --kind geetest --points ...`');
    }
    if (session.state === 'awaiting_sms_code') {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const code = (await rl.question('请输入短信验证码：')).trim();
        session = await service.loginSms(session.loginId, code);
        continue;
      } catch (err) {
        const e = asZhilianError(err);
        if (e.code === 'CAPTCHA_REQUIRED' || e.code === 'HUMAN_VERIFICATION_REQUIRED') {
          console.log('[login] 出现人机验证：请在新终端执行 `zhilian verify status` 并按提示 solve。');
        } else {
          console.log(`[login] 失败：${e.message}`);
        }
      } finally {
        rl.close();
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
    session = await service.loginGet(session.loginId);
  }
  throw new Error('登录超时');
}

function buildProgram(): Command {
  const program = new Command();
  program.name('zhilian').version(VERSION).description('智联招聘本地只读客户端（cloak 浏览器 + CLI/REST/MCP）');
  program.option('--format <format>', '输出格式：json | table', 'json');

  const fmt = () => program.opts().format as string;

  program
    .command('health')
    .description('健康检查')
    .action(async () => run('health.get', {}));

  program
    .command('status')
    .description('登录态 / 模式 / 会话 / EdgeOne / 风控 / 缓存')
    .action(async () => run('status.get', {}));

  const login = program.command('login').description('登录（默认智联 APP 扫码；--sms 短信）');
  const loginStartAction = async (opts: { sms?: boolean; qr?: boolean; phone?: string; relay?: boolean }) => {
    try {
      const b = await getBackend();
      const cfg = b.config;
      const mode = opts.qr ? 'app-qr' : opts.sms ? 'sms' : cfg.loginMode;
      const session = await b.service.loginStart({ mode: mode as never, ...(opts.phone ? { phone: opts.phone } : {}) });
      if (opts.relay) {
        printResult({ data: session, mode: b.service.mode() });
        await closeBackend();
        return;
      }
      await interactiveLogin(b.service, cfg, session);
    } catch (err) {
      printError(err);
    } finally {
      await closeBackend();
    }
  };
  login
    .option('--sms', '短信验证码登录')
    .option('--qr', '智联APP扫码登录（默认）')
    .option('--phone <phone>', '手机号（默认 ZHILIAN_PHONE）')
    .option('--relay', '只输出 LoginSession（含二维码 Base64），不等待扫码')
    .action(loginStartAction);

  login
    .command('start')
    .description('开始登录流程')
    .option('--sms', '短信验证码登录')
    .option('--qr', '智联APP扫码登录（默认）')
    .option('--phone <phone>', '手机号')
    .option('--relay', '只输出 LoginSession，不进入交互')
    .action(loginStartAction);

  login
    .command('status')
    .argument('<loginId>')
    .description('查询登录流程状态')
    .action(async (loginId: string) => run('session.login.get', { pathParams: { loginId } }));

  login
    .command('sms')
    .argument('<loginId>')
    .requiredOption('--code <code>', '短信验证码')
    .description('提交短信验证码')
    .action(async (loginId: string, opts: { code: string }) =>
      run('session.login.sms', { pathParams: { loginId }, body: { code: opts.code } }),
    );

  login
    .command('cancel')
    .argument('<loginId>')
    .description('取消登录流程')
    .action(async (loginId: string) => run('session.login.cancel', { pathParams: { loginId } }));

  const verify = program.command('verify').description('人机验证中继（EdgeOne / 极验 / NC）');
  verify
    .command('status')
    .description('查询待处理人机验证')
    .action(async () => run('verification.get', {}));
  verify
    .command('solve')
    .description('提交人机验证答案')
    .option('--kind <kind>', 'edgeone | geetest | nc', 'edgeone')
    .option('--auto', '自动点击 EdgeOne 复选框')
    .option('--points <points>', '归一化点击坐标，空格分隔，如 "0.68,0.62 0.17,0.54"')
    .option('--offset-ratio <ratio>', '极验滑块偏移比例 0-1')
    .option('--offset-px <px>', '极验滑块偏移像素')
    .action(async (opts: { kind: string; auto?: boolean; points?: string; offsetRatio?: string; offsetPx?: string }) => {
      const kind = opts.kind as 'edgeone' | 'geetest' | 'nc';
      const points = opts.points ? parsePoints(opts.points) : undefined;
      const answer = {
        kind,
        ...(kind === 'edgeone' ? { auto: opts.auto === true, ...(points ? { points } : {}) } : {}),
        ...(kind === 'geetest'
          ? {
              ...(points ? { points } : {}),
              ...(opts.offsetRatio ? { offsetRatio: Number(opts.offsetRatio) } : {}),
              ...(opts.offsetPx ? { offsetPx: Number(opts.offsetPx) } : {}),
            }
          : {}),
        ...(kind === 'nc' ? { ...(points ? { points } : {}) } : {}),
      } as VerificationSolveRequest;
      await run('verification.solve', { body: answer });
    });

  program
    .command('search')
    .description('职位搜索（zhilian search jobs ...）')
    .command('jobs')
    .description('职位搜索')
    .requiredOption('--keyword <keyword>', '关键词')
    .option('--city <cityCode>', '城市码（jl），默认配置城市')
    .option('--page <page>', '页码', '1')
    .option('--pages <pages>', '本次抓取页数 1-5', '1')
    .option('--page-size <pageSize>', '每页条数（上游固定 20）', '20')
    .option('--order <order>', '排序（4=最新；默认取配置）')
    .option('--sort-type <sortType>', 'DEFAULT | HR_ACTIVE_TIME | JOB_PUBLISH_TIME')
    .option('--refresh', '绕过缓存')
    .action(async (opts: Record<string, string | boolean | undefined>) =>
      run(
        'search.jobs',
        {
          body: {
            keyword: String(opts.keyword),
            ...(opts.city ? { cityCode: String(opts.city) } : {}),
            page: Number(opts.page ?? 1),
            pages: Number(opts.pages ?? 1),
            ...(opts.order ? { order: Number(opts.order) } : {}),
            ...(opts.sortType ? { sortType: String(opts.sortType) } : {}),
            refresh: opts.refresh === true,
          },
        },
        { table: true, format: fmt() },
      ),
    );

  const jobs = program.command('jobs').description('职位列表 / 职位详情');
  jobs
    .command('list')
    .description('按 queryId 翻页')
    .requiredOption('--query-id <queryId>')
    .option('--page <page>', '页码', '1')
    .option('--page-size <pageSize>')
    .option('--refresh', '绕过缓存')
    .action(async (opts: Record<string, string | boolean | undefined>) =>
      run(
        'jobs.list',
        {
          query: {
            queryId: String(opts.queryId),
            page: Number(opts.page ?? 1),
            ...(opts.pageSize ? { pageSize: Number(opts.pageSize) } : {}),
            refresh: opts.refresh === true,
          },
        },
        { table: true, format: fmt() },
      ),
    );
  jobs
    .command('detail')
    .description('职位详情')
    .requiredOption('--number <positionNumber>', '职位号（CCL…J…）')
    .option('--refresh', '绕过缓存')
    .action(async (opts: { number: string; refresh?: boolean }) =>
      run('jobs.detail', { pathParams: { positionNumber: opts.number }, query: { refresh: opts.refresh === true } }),
    );

  const companies = program.command('companies').description('公司列表 / 详情（含工商信息） / 全部职位');
  companies
    .command('list')
    .description('去重公司列表')
    .requiredOption('--query-id <queryId>')
    .option('--page <page>', '页码', '1')
    .option('--page-size <pageSize>', '每页公司数', '20')
    .option('--fetch-pages <n>', '额外抓取页数 0-5', '0')
    .option('--refresh', '绕过缓存')
    .action(async (opts: Record<string, string | boolean | undefined>) =>
      run(
        'companies.list',
        {
          query: {
            queryId: String(opts.queryId),
            page: Number(opts.page ?? 1),
            pageSize: Number(opts.pageSize ?? 20),
            fetchPages: Number(opts.fetchPages ?? 0),
            refresh: opts.refresh === true,
          },
        },
        { table: true, format: fmt() },
      ),
    );
  companies
    .command('detail')
    .description('公司详情（含工商信息）')
    .requiredOption('--number <companyNumber>', '公司号（CZL…/CZ…/CC…）')
    .option('--refresh', '绕过缓存')
    .action(async (opts: { number: string; refresh?: boolean }) =>
      run('companies.detail', { pathParams: { companyNumber: opts.number }, query: { refresh: opts.refresh === true } }),
    );
  companies
    .command('jobs')
    .description('公司全部在招职位')
    .requiredOption('--number <companyNumber>')
    .option('--page <page>', '页码（上游首屏 20 条）', '1')
    .option('--refresh', '绕过缓存')
    .action(async (opts: { number: string; page?: string; refresh?: boolean }) =>
      run('companies.jobs', {
        pathParams: { companyNumber: opts.number },
        query: { page: Number(opts.page ?? 1), refresh: opts.refresh === true },
      }),
    );

  program
    .command('cities')
    .description('城市注册表（jl 城市码）')
    .command('list')
    .description('城市注册表')
    .option('--refresh', '从上游刷新')
    .option('--level <level>', 'country | province | city | district')
    .action(async (opts: { refresh?: boolean; level?: string }) =>
      run('cities.list', { query: { refresh: opts.refresh === true, ...(opts.level ? { level: opts.level } : {}) } }),
    );

  const cache = program.command('cache').description('缓存管理（统计 / 清理）');
  cache
    .command('stats')
    .description('缓存统计')
    .action(async () => run('cache.stats', {}));
  cache
    .command('clear')
    .description('清缓存')
    .option('--all', '清全部')
    .option('--expired', '只清过期')
    .option('--prefix <prefix>', '按前缀清')
    .action(async (opts: { all?: boolean; expired?: boolean; prefix?: string }) =>
      run('cache.clear', {
        query: { scope: opts.expired ? 'expired' : 'all', ...(opts.prefix ? { prefix: opts.prefix } : {}) },
      }),
    );

  program
    .command('serve')
    .description('启动本地 REST 服务')
    .option('--port <port>', '端口', '8791')
    .option('--host <host>', '监听地址', '127.0.0.1')
    .action(async (opts: { port: string; host: string }) => {
      try {
        const app: App = await createApp();
        const { createRestServer } = await import('../rest/server.js');
        const server = createRestServer(app);
        await new Promise<void>((resolve) => {
          server.listen(Number(opts.port), opts.host, () => {
            console.error(`[rest] zhilian-client listening on http://${opts.host}:${opts.port}`);
            console.error(`[rest] docs: http://${opts.host}:${opts.port}/docs`);
          });
          const shutdown = () => {
            server.close(() => resolve());
            void app.close();
          };
          process.once('SIGINT', shutdown);
          process.once('SIGTERM', shutdown);
        });
      } catch (err) {
        printError(err);
        await closeBackend();
      }
    });

  program
    .command('mcp')
    .description('启动 MCP stdio server（默认代理到常驻 REST 服务，不打开本地浏览器）')
    .option('--local', '强制本地 App（不代理；会独占浏览器 profile，仅开发/无服务时使用）')
    .option('--proxy', '强制代理到 REST 服务（默认行为）')
    .option('--url <url>', 'REST 服务地址，如 http://127.0.0.1:8791')
    .action(async (opts: { local?: boolean; proxy?: boolean; url?: string }) => {
      try {
        const b = await createBackend({ mode: opts.local ? 'local' : 'remote', ...(opts.url ? { url: opts.url } : {}) });
        const { startMcpServer } = await import('../mcp/server.js');
        await startMcpServer(b);
        const shutdown = async () => {
          await b.close().catch(() => {});
          process.exit(0);
        };
        process.once('SIGINT', () => void shutdown());
        process.once('SIGTERM', () => void shutdown());
        await new Promise(() => {});
      } catch (err) {
        printError(err);
      }
    });

  program
    .command('docs')
    .argument('[operationId]')
    .description('操作索引/单操作说明')
    .action(async (operationId?: string) => {
      if (!operationId) {
        for (const o of OPERATIONS) console.log(`${o.id}\t${o.rest.method} ${o.rest.path}\tzhilian ${o.cli.command}\t${o.mcp.name}\t${o.summary}`);
        return;
      }
      try {
        console.log(JSON.stringify(getOperation(operationId), null, 2));
      } catch (err) {
        printError(err);
      }
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
  await closeBackend();
}

export { buildProgram };
